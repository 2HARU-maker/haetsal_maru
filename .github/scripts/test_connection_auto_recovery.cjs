const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {setup,flush,confirmationHarness}=require('./test_connection_recovery.cjs');
const source=fs.readFileSync(process.argv[2]||'index.html','utf8').replace(/\r\n/g,'\n');
const between=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert(i>=0&&j>i);return source.slice(i,j);};
const functions=between('    function scheduleScopedRealtimeStallCheck(', '    function setScopedRealtimeSubscription(')+between('    function runScopedRealtimeHealthCheck(', '    function getRealtimeScopeState(');
const rows=[];
function scopeHarness({cached=false,serverError}={}){
  const h=setup(),ctx=h.context,subs=new Map(),retries=new Map(),metrics={starts:0,stops:0,recover:0},confirmations=[];
  let blocked=false,online=true;
  Object.assign(ctx,{scopedRealtimeSubscriptions:subs,scopedRealtimeRetryStates:retries,SCOPED_REALTIME_RETRY_MAX_ATTEMPTS:6,operatorTokenGeneration:1,liveOrderQueryGuardVerificationGeneration:1,
    isScopedRealtimeGuardBlocked:()=>blocked,isScopedRealtimeOnline:()=>online,isScopedRealtimeRecoveryAllowed:()=>!blocked&&online,
    tabletRuntimeDiagnostics:{observeRealtimeState(){}},clearScopedRealtimeRetryState:key=>retries.delete(key),getScopedRealtimeRetryErrorCode:e=>e.code,getScopedRealtimeRetryDelayMs:()=>1000,
    getScopedRealtimeKnownKeys:()=>[...new Set([...subs.keys(),...retries.keys()])],getRealtimeScopeState:()=>({operatorDashboard:true}),retryFailedOrderGuardVerifications(){}});
  vm.runInContext("let lastScopedAuthRecovery='';"+functions,ctx);
  const factory=entry=>{
    metrics.starts++;
    const c=confirmationHarness({auto:true,readError:serverError});confirmations.push(c);
    c.ctx.scopeInstance=entry;c.ctx.scopedRealtimeSubscriptions=subs;c.ctx.scopedRealtimeRetryStates=retries;c.ctx.SCOPED_REALTIME_RETRY_MAX_ATTEMPTS=6;c.ctx.Date=ctx.Date;
    Object.defineProperty(c.ctx,'operatorTokenGeneration',{get:()=>ctx.operatorTokenGeneration});
    c.proof.isCurrent=()=>subs.get('live-order-query')===entry;
    c.ctx.stopScopedRealtimeSubscription=(...a)=>ctx.stopScopedRealtimeSubscription(...a);
    c.ctx.syncScopedRealtimeSubscriptions=()=>ctx.syncScopedRealtimeSubscriptions();
    entry.confirmLatest=c.scope.confirmLatest;
    if(!(cached&&metrics.starts===1))ctx.setTimeout(()=>ctx.markScopedRealtimeSubscriptionHealthy(entry.key,entry,{metadata:{fromCache:false,hasPendingWrites:false}}),0);
    return()=>metrics.stops++;
  };
  ctx.syncScopedRealtimeSubscriptions=()=>ctx.startScopedRealtimeSubscription('live-order-query','live-order-query',factory);
  const api=ctx.window.HaetsalRealtimeScope;
  api.getRecoveryState=vm.runInContext('('+between('      getRecoveryState:() => {','      reconnect:').replace(/^\s*getRecoveryState:/,'').trim().replace(/,$/,'')+')',ctx);
  api.confirmCurrent=(current,cleanup)=>subs.get('live-order-query').confirmLatest(current,cleanup);
  api.recoverySignal=()=>ctx.resumeExhaustedScopedRealtimeSubscriptions();
  api.authRecovered=(...args)=>ctx.resumeAuthenticatedScopedRealtimeSubscriptions(...args);
  ctx.syncScopedRealtimeSubscriptions();
  return Object.assign(h,{subs,retries,metrics,confirmations,setBlocked:v=>blocked=v,setOnline:v=>online=v,reads:()=>confirmations.reduce((n,c)=>n+c.calls.read,0)});
}
let regressionSettled=false;
process.once('beforeExit',()=>{if(!regressionSettled){console.error('Auto recovery regression did not complete');process.exitCode=1;}});
(async()=>{
  {
    const h=setup(null,{writePhase:'unknown'});let unauthenticated=true,releaseToken;const lateToken=new Promise(resolve=>releaseToken=resolve);h.context.window.HaetsalRealtimeScope.getRecoveryState=()=>({required:true,healthy:true,unauthenticated});vm.runInContext("connectionState='ready'",h.context);
    Object.assign(h.context,{observedAuthUser:h.context.auth.currentUser,resolve(){}});const tokenCallback=between('    onIdTokenChanged(auth, user => {','    }, reject);').replace('    onIdTokenChanged(auth, ','');vm.runInContext('tokenCallback='+tokenCallback+'};',h.context);
    h.context.verifyFirebaseOperatorUser=async(_user,force)=>{if(!force)return lateToken;h.context.tokenCallback(h.context.auth.currentUser);unauthenticated=false;h.api.recover('authenticated-scopes',true);return{admin:true,manager:true};};
    await h.api.recover('listener-authentication');await flush();assert.equal(h.calls['save-result'],1);releaseToken({admin:true,manager:true});await flush();assert.equal(h.calls['save-result'],1);assert.equal(h.api.getState().run.id,1);rows.push('a delayed same-token callback after receipt verification does not create a second signal');
  }
  for(const laterSignal of [false,true]){
    const h=setup(laterSignal?'save-result':null,{writePhase:'unknown'});h.context.window.HaetsalRealtimeScope.getRecoveryState=()=>({required:true,healthy:true,unauthenticated:true});vm.runInContext("connectionState='ready'",h.context);let forced=false;
    h.context.verifyFirebaseOperatorUser=async(_u,force)=>{if(force&&!forced){forced=true;h.api.recover('authenticated-scopes',true);}return{admin:true,manager:true};};
    const task=h.api.recover('listener-authentication');await flush();assert.equal(h.calls['save-result'],1);
    if(laterSignal){h.api.recover('foreground',true);h.release(false);}await task;await flush();assert.equal(h.calls['save-result'],laterSignal?2:1);rows.push(laterSignal?'a new signal after receipt verification starts is retained':'the token signal consumed by a limited run cannot verify the same unknown receipt twice');
  }
  {
    const h=setup();h.context.window.HaetsalRealtimeScope.getRecoveryState=()=>({required:true,healthy:true,unauthenticated:true});vm.runInContext("connectionState='ready'",h.context);let forced=0;h.context.verifyFirebaseOperatorUser=async(_u,force)=>{if(force&&++forced===1)throw{code:'auth/network-request-failed'};return{admin:true,manager:true};};
    await h.api.recover('listener-authentication');assert.equal(forced,1);await h.advance(1200);assert.equal(forced,2);await h.advance(60000);assert.equal(forced,2);rows.push('a failed refresh with no new token can retry with existing backoff without a refresh loop');
  }
  {
    const h=setup();h.context.window.HaetsalRealtimeScope.getRecoveryState=()=>({required:true,healthy:true,unauthenticated:true});vm.runInContext("connectionState='ready'",h.context);h.api.scopeFailed('cloud-doc-tumbler','unauthenticated');assert.equal(await h.api.recover('listener-authentication'),true);assert.equal(h.api.getState().state,'ready');assert.equal(h.api.getState().run.limited,true);assert.equal(h.calls.policy,undefined);assert.equal(h.calls.snapshot,undefined);assert.equal(h.calls.backup,undefined);rows.push('auxiliary auth recovery preserves the already confirmed main connection');
  }
  {
    const h=setup(null,{writePhase:'unknown'});h.context.window.HaetsalRealtimeScope.getRecoveryState=()=>({required:true,healthy:true,unauthenticated:false});vm.runInContext("connectionState='ready'",h.context);await h.api.recover('foreground',true);assert.equal(h.calls['save-result'],1);assert.equal(h.calls.policy,undefined);assert.equal(h.calls.snapshot,undefined);for(let i=0;i<20;i++)h.context.notifyOrderStatus();await flush();assert.equal(h.calls['save-result'],1);assert.equal(h.api.getState().state,'ready');rows.push('an original unknown receipt gets one recovery-signal check without status polling');
  }
  {
    const h=setup(null,{writePhase:'unknown'});h.context.window.HaetsalRealtimeScope.getRecoveryState=()=>({required:true,healthy:true,unauthenticated:true});vm.runInContext("connectionState='ready';connectionAuthRefreshGeneration=operatorAuthGeneration",h.context);const first=h.api.recover('listener-authentication');h.api.recover('foreground',true);await first;await flush();assert.equal(h.calls['save-result'],1);assert.equal(h.api.getState().run.id,1);rows.push('signals coalesced before a run starts keep one needed receipt check');
  }
  {
    const h=setup();let ready=false;h.context.window.HaetsalRealtimeScope.getRecoveryState=()=>({required:true,healthy:true});h.context.window.HaetsalRealtimeScope.getLiveOrderSnapshot=()=>({ready});await h.api.reconnect();h.api.scopeFailed('live-order-query','live-order-unconfirmed');h.api.scopeHealthy('live-order-query');assert.equal(vm.runInContext('connectionNotice.hidden',h.context),false);ready=true;h.api.scopeHealthy('live-order-query');assert.equal(vm.runInContext('connectionNotice.hidden',h.context),true);rows.push('listener metadata alone cannot clear an unapplied server-list notice');
  }
  {
    const h=scopeHarness();await h.advance(0);await h.api.recover('initial');await h.advance(60000);
    assert.equal(h.metrics.starts,1);assert.equal(h.reads(),1);const before=h.reads();await h.advance(120000);assert.equal(h.reads(),before);assert.equal(h.metrics.stops,0);
    rows.push('quiet healthy has no periodic reads or restart');
  }
  {
    const h=scopeHarness();h.retries.set('auxiliary',{attempt:6,exhausted:true,ready:false,lastErrorCode:'unavailable'});await h.advance(0);assert.equal(h.retries.get('auxiliary').exhausted,true);assert.equal(h.retries.get('auxiliary').recoveryEpochs,undefined);rows.push('healthy live transition cannot spend an unrelated exhausted scope epoch');
  }
  {
    const h=scopeHarness();h.context.getRealtimeScopeState=()=>({operatorDashboard:false});await h.advance(0);await h.api.recover('initial');
    for(let episode=0;episode<2;episode++){
      vm.runInContext('connectionAuthRefreshGeneration=operatorAuthGeneration',h.context);
      h.retries.set('live-order-query',{lastErrorCode:'unauthenticated',terminal:true,authGeneration:0,tokenGeneration:h.context.operatorTokenGeneration});
      h.context.operatorTokenGeneration++;
      assert.equal(h.context.resumeAuthenticatedScopedRealtimeSubscriptions(h.context.auth.currentUser,0,h.context.operatorTokenGeneration),true);
      const entry=h.subs.get('live-order-query');entry.status='starting';h.context.markScopedRealtimeSubscriptionHealthy(entry.key,entry,{metadata:{fromCache:false,hasPendingWrites:false}});await flush();
      assert.equal(vm.runInContext('connectionAuthRefreshGeneration',h.context),-1);
    }
    rows.push('common scopes end each refresh episode only after actual server healthy');
  }
  {
    const h=scopeHarness({cached:true});await h.advance(1000);await h.api.recover('early');assert.equal(h.subs.get('live-order-query').status,'starting');assert.equal(h.metrics.starts,1);
    const earlyReads=h.reads();for(let i=0;i<20;i++)h.events.online();await flush();assert.equal(h.reads(),earlyReads,'same-token early proof caused repeated confirmation');
    await h.advance(14000);await h.advance(0);assert.equal(h.metrics.starts,2);assert.equal(h.metrics.stops,1);assert.equal(h.subs.get('live-order-query').status,'healthy');assert.equal(h.api.getState().state,'ready');assert.equal(h.calls.backup,undefined);
    const reads=h.reads();await h.advance(120000);assert.equal(h.reads(),reads);rows.push('early one-shot is followed by bounded automatic persistent recovery without another click');
  }
  {
    const h=scopeHarness({cached:true}),e=h.subs.get('live-order-query');h.context.markScopedRealtimeSubscriptionHealthy(e.key,e,{metadata:{fromCache:false,hasPendingWrites:true}});await h.advance(60000);assert.equal(h.metrics.starts,1);assert.equal(h.reads(),0);rows.push('pending writes do not arm cache recovery');
  }
  {
    const h=scopeHarness({cached:true});h.retries.set('live-order-query',{attempt:6,ready:false,exhausted:false});await h.advance(15000);assert.equal(h.retries.get('live-order-query').exhausted,true);assert.equal(h.metrics.starts,1);h.events.offline();h.events.online();await h.advance(1300);await h.advance(0);assert.equal(h.metrics.starts,2);assert.equal(h.subs.get('live-order-query').status,'healthy');rows.push('silent-cache exhaustion remains bounded and a genuine signal grants one replacement');
  }
  {
    const h=scopeHarness({cached:true});h.retries.set('live-order-query',{attempt:6,ready:false,exhausted:true,recoveryEpochs:2});h.context.runScopedRealtimeHealthCheck(true);assert.equal(h.metrics.starts,1);assert.equal(h.retries.get('live-order-query').attempt,0);assert.equal(h.retries.get('live-order-query').exhausted,false);rows.push('explicit manual recovery preserves its reset without stopping an unproven active scope');
  }
  {
    const h=scopeHarness({cached:true,serverError:'unavailable'});await h.advance(15000);assert.equal(h.metrics.starts,1);assert(h.reads()>=1);assert.equal(h.api.getState().state,'failed');rows.push('server failure cannot replace cached scope');
  }
  {
    const h=scopeHarness({cached:true});h.context.stopScopedRealtimeSubscription('live-order-query');await h.advance(60000);assert.equal(h.metrics.starts,1);assert.equal(h.reads(),0);rows.push('released scope cancels its owned stall timer');
  }
  {
    const h=scopeHarness();await h.advance(0);h.context.stopScopedRealtimeSubscription('live-order-query');h.retries.set('live-order-query',{terminal:true,ready:false,lastErrorCode:'unauthenticated',authGeneration:0,tokenGeneration:1});
    assert.equal(h.context.resumeAuthenticatedScopedRealtimeSubscriptions(h.context.auth.currentUser,0,1),false);h.context.operatorTokenGeneration=2;
    assert.equal(h.context.resumeAuthenticatedScopedRealtimeSubscriptions({uid:'other'},0,2),false);assert.equal(h.context.resumeAuthenticatedScopedRealtimeSubscriptions(h.context.auth.currentUser,1,2),false);
    assert.equal(h.context.resumeAuthenticatedScopedRealtimeSubscriptions(h.context.auth.currentUser,0,2),true);assert.equal(h.context.resumeAuthenticatedScopedRealtimeSubscriptions(h.context.auth.currentUser,0,2),false);await h.advance(0);assert.equal(h.subs.size,1);rows.push('only current newer verified token rearms an unauthenticated scope once');
  }
  for(const code of ['permission-denied','resource-exhausted']){
    const h=scopeHarness();await h.advance(0);h.context.stopScopedRealtimeSubscription('live-order-query');h.retries.set('live-order-query',{terminal:true,ready:false,lastErrorCode:code,authGeneration:0,tokenGeneration:0});h.context.operatorTokenGeneration=2;
    assert.equal(h.context.resumeAuthenticatedScopedRealtimeSubscriptions(h.context.auth.currentUser,0,2),false);assert.equal(h.subs.size,0);rows.push(code+' stays terminal');
  }
  {
    const h=scopeHarness(),ctx=h.context,syncLive=ctx.syncScopedRealtimeSubscriptions;
    ctx.syncScopedRealtimeSubscriptions=()=>{syncLive();ctx.startScopedRealtimeSubscription('cloud-doc-shared','cloud-doc-shared',()=>()=>{});return true;};ctx.syncScopedRealtimeSubscriptions();
    const oldAux=h.subs.get('cloud-doc-shared');ctx.markScopedRealtimeSubscriptionFailed('live-order-query',{code:'unauthenticated'},h.subs.get('live-order-query'));
    ctx.operatorTokenGeneration=2;assert(ctx.resumeAuthenticatedScopedRealtimeSubscriptions(ctx.auth.currentUser,0,2));
    ctx.markScopedRealtimeSubscriptionFailed('cloud-doc-shared',{code:'unauthenticated'},oldAux);assert.equal(h.retries.get('cloud-doc-shared').tokenGeneration,1);
    assert(ctx.resumeAuthenticatedScopedRealtimeSubscriptions(ctx.auth.currentUser,0,2));const replacement=h.subs.get('cloud-doc-shared');assert.notEqual(replacement,oldAux);assert.equal(replacement.tokenGeneration,2);
    ctx.markScopedRealtimeSubscriptionFailed('cloud-doc-shared',{code:'unauthenticated'},replacement);assert.equal(ctx.resumeAuthenticatedScopedRealtimeSubscriptions(ctx.auth.currentUser,0,2),false);rows.push('late second-scope auth error uses its subscription generation and rearms once per verified token');
  }
  {
    const h=scopeHarness();await h.advance(31000);h.context.stopScopedRealtimeSubscription('live-order-query');h.retries.set('live-order-query',{attempt:6,generation:1,exhausted:true,ready:false,lastErrorCode:'unavailable',recoveryEpochs:1,recoverySignalAt:1});h.context.operatorTokenGeneration=2;
    h.context.resumeAuthenticatedScopedRealtimeSubscriptions(h.context.auth.currentUser,0,2);assert.equal(h.retries.get('live-order-query').recoveryEpochs,2);assert.equal(h.subs.size,1);
    h.context.markScopedRealtimeSubscriptionFailed('live-order-query',{code:'unauthenticated'},h.subs.get('live-order-query'));assert.equal(h.retries.get('live-order-query').recoveryEpochs,2);rows.push('new verified token signals non-auth exhaustion and terminal errors preserve the episode budget');
  }
  {
    const h=scopeHarness();await h.advance(31000);h.context.stopScopedRealtimeSubscription('live-order-query');h.context.syncScopedRealtimeSubscriptions=()=>true;
    h.retries.set('live-order-query',{attempt:6,generation:1,exhausted:true,ready:false,lastErrorCode:'unavailable'});const retry=()=>h.retries.get('live-order-query');
    h.context.resumeExhaustedScopedRealtimeSubscriptions();assert.equal(retry().attempt,5);assert.equal(retry().recoveryEpochs,1);
    retry().exhausted=true;retry().ready=false;h.context.resumeExhaustedScopedRealtimeSubscriptions();assert.equal(retry().recoveryEpochs,1);
    await h.advance(30000);h.context.resumeExhaustedScopedRealtimeSubscriptions();assert.equal(retry().recoveryEpochs,2);
    retry().exhausted=true;retry().ready=false;await h.advance(30000);h.context.resumeExhaustedScopedRealtimeSubscriptions();assert.equal(retry().recoveryEpochs,2);rows.push('exhaustion gets one attempt per real signal with cooldown and two-epoch limit');
  }
  for(const stage of ['policy','save-result']){
    const h=setup(stage);const first=h.api.reconnect();await h.advance(15000);assert.equal(await first,false);assert.equal(h.api.getState().state,'failed');h.release(stage==='policy'?{checked:true,blocked:false}:false);await flush();assert.equal(h.api.getState().state,'ready');assert.equal(h.calls.backup,undefined);rows.push('late '+stage+' resumes in a fresh automatic run without backup');
  }
  {
    const h=setup();vm.runInContext("connectionState='failed';connectionError='connection/wait-timeout';connectionAttempt=6",h.context);h.api.scopeHealthy('live-order-query',true);await flush();assert.equal(h.api.getState().state,'ready');assert.equal(h.calls.backup,undefined);rows.push('late real healthy signal bridges both scope and global exhaustion');
  }
  {
    const h=setup(null,{anonymous:true});vm.runInContext("connectionState='failed';connectionError='connection/wait-timeout';connectionAttempt=6",h.context);h.api.scopeHealthy('cloud-doc-shared',true);await flush();assert.equal(h.api.getState().state,'failed');assert.equal(h.api.getState().error,'permission-denied');assert.equal(h.calls.backup,undefined);rows.push('common-scope late proof wakes a bounded current run without granting operator rights');
  }
  {
    const h=setup();await h.api.reconnect();const id=h.api.getState().run.id;for(let i=0;i<20;i++)h.events.online();await flush();assert.equal(h.api.getState().run.id,id);rows.push('online event bursts on healthy connection add no confirmation');
  }
  for(const option of ['stopped','quota']){
    const h=scopeHarness({cached:true});h.setBlocked(true);if(option==='stopped')h.context.window.HaetsalRuntimeGuard.isStopped=()=>true;else h.context.window.HaetsalFirestoreQuotaGuard.isBlocked=()=>true;
    await h.advance(15000);assert.equal(h.reads(),0);assert.equal(h.metrics.starts,1);rows.push(option+' blocks automatic recovery');
  }
  regressionSettled=true;console.log(JSON.stringify({status:'PASS_CODE_MODEL',scope:'actual connection and scope functions; controlled clocks/auth/SDK only',n:rows.length,rows,SDK:false}));
})().catch(e=>{regressionSettled=true;console.error(e);process.exitCode=1;});
