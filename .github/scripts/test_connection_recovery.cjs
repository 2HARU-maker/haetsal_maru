function confirmationHarness(options={}){
  const start=source.indexOf('        if(scopeInstance) scopeInstance.confirmLatest = async function(isCurrent, registerCleanup){'),end=source.indexOf('        dateRolloverTimer = setTimeout',start);assert(start>0&&end>start);
  let now=100000;const scope={status:options.status||'cached',statusSince:now-(options.age??1000)},subs=new Map([['live-order-query',scope]]),slots=[],cleanups=new Set(),calls={read:0,close:0,stop:0,replacement:0,apply:0};
  const proof={ready:scope.status==='healthy',serverSequence:1,error:'',isCurrent:()=>subs.get('live-order-query')===scope};
  const snapshot=(size=0,pending=false)=>({metadata:{fromCache:false,hasPendingWrites:pending},size});
  const ctx={scopeInstance:scope,restoreProof:proof,activeQueryRef:{},snapshotSequence:0,snapshotApplication:Promise.resolve(),CONNECTION_WAIT_TIMEOUT_MS:15000,scopedRealtimeSubscriptions:subs,isScopedRealtimeGuardBlocked:()=>!!options.blocked,markFirestoreQuotaExceeded(){},Date:class extends Date{static now(){return now;}},query:(base,...constraints)=>({base,constraints}),orderBy:field=>({orderBy:field}),documentId:()=>'__name__',startAt:value=>({startAt:value}),liveOrderDocPrefix:'live_order_',publishRestoreSnapshot:(p,ready,error)=>{p.ready=ready;p.error=error||'';},stopScopedRealtimeSubscription:()=>{calls.stop++;subs.delete('live-order-query');},syncScopedRealtimeSubscriptions:()=>subs.set('live-order-query',{confirmLatest:async(owner,register)=>{assert(owner());assert.equal(typeof register,'function');calls.replacement++;return{required:true,ready:true};}})};
  ctx.confirmationCleanups=new Set();
  const register=cleanup=>{cleanups.add(cleanup);return()=>cleanups.delete(cleanup);};
  ctx.applySnapshot=(s,fromConfirmation,receipt)=>{assert.equal(fromConfirmation,true);calls.apply++;ctx.snapshotApplication=Promise.resolve().then(()=>{if(receipt!==ctx.snapshotSequence)return;proof.ready=!s.metadata.hasPendingWrites&&s.size<300;proof.error=s.size>=300?'live-order-list-partial':'';proof.serverSequence++;});return ctx.snapshotApplication;};
  ctx.onSnapshot=(ref,_options,next,error)=>{
    assert.notEqual(ref,ctx.activeQueryRef);assert.equal(ref.base,ctx.activeQueryRef);assert.equal(ref.constraints[1].startAt,'live_order_');calls.read++;
    const slot={next,error,active:true};slots.push(slot);
    if(options.auto!==false)Promise.resolve().then(()=>{if(!slot.active)return;if(options.readError)error({code:options.readError});else{next(snapshot(0,!!options.pending));if(options.pending)for(const cancel of cleanups)cancel();}});
    return()=>{if(slot.active){slot.active=false;calls.close++;}};
  };
  vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
  return{scope,subs,proof,ctx,calls,slots,cleanups,register,snapshot,setTime:value=>{now=value;},cancel:()=>{for(const cleanup of cleanups)cleanup();}};
}

async function confirmationCases(){
  const rows=[];
  for(const options of [{name:'normal cached scope stays intact',age:1000,status:'cached'},{name:'proven stalled scope replaced once',age:16000,status:'cached',replace:true},{name:'healthy scope is not replaced',age:16000,status:'healthy'},{name:'pending writes never trigger restart',age:16000,status:'pending-write',pending:true,error:'auth/session-changed'},{name:'late expired attempt does not restart',age:16000,status:'cached',active:false,error:'auth/session-changed'},{name:'unreachable server does not restart cached scope',age:16000,status:'cached',readError:'unavailable',error:'unavailable'},{name:'quota blocked before query',age:16000,status:'cached',blocked:true,error:'auth/session-changed'}]){
    const h=confirmationHarness(options);let result,error;try{result=await h.scope.confirmLatest(()=>options.active!==false,h.register);}catch(e){error=e.code;}
    assert.equal(error,options.error);assert.equal(h.calls.stop,options.replace?1:0);assert.equal(h.calls.replacement,options.replace?1:0);assert.equal(h.cleanups.size,0);assert.equal(h.slots.filter(s=>s.active).length,0);if(!options.error)assert(result.ready);if(options.blocked)assert.equal(h.calls.read,0);
    rows.push({name:options.name,status:'PASS_CODE_MODEL'});
    if(options.name==='normal cached scope stays intact'){
      assert.equal(h.scope.status,'cached');h.setTime(120000);assert((await h.scope.confirmLatest(()=>true,h.register)).ready);assert.equal(h.calls.stop,1);assert.equal(h.calls.replacement,1);
      rows.push({name:'one-shot at one second leaves stalled live scope replaceable at twenty seconds',status:'PASS_CODE_MODEL'});
    }
  }
  return rows;
}

async function lateConfirmationCases(){
  const h=confirmationHarness({auto:false,age:16000});let current=1;
  const first=h.scope.confirmLatest(()=>current===1,h.register).catch(error=>error);h.cancel();assert.equal((await first).code,'auth/session-changed');assert.equal(h.calls.close,1);current=2;
  const second=h.scope.confirmLatest(()=>current===2,h.register);assert.equal(h.slots.filter(s=>s.active).length,1);
  h.slots[0].next(h.snapshot());assert.equal(h.ctx.snapshotSequence,0);assert.equal(h.calls.stop,0);assert.equal(h.subs.get('live-order-query'),h.scope);
  h.slots[1].next(h.snapshot());assert((await second).ready);assert.equal(h.calls.stop,1);assert.equal(h.calls.replacement,1);assert.equal(h.calls.close,2);assert.equal(h.cleanups.size,0);
  return[{name:'expired confirmation releases its target and late callback cannot replace later listener',status:'PASS_CODE_MODEL'},{name:'current attempt owns recursive replacement with one temporary target and zero after finish',status:'PASS_CODE_MODEL'}];
}

async function receiptOrderCases(){
  const h=confirmationHarness({auto:false,status:'healthy'});h.ctx.snapshotSequence=1;
  const task=h.scope.confirmLatest(()=>true,h.register).catch(error=>error);
  h.proof.ready=true;h.proof.serverSequence++;
  h.slots[0].next(h.snapshot(300));assert.equal((await task).code,'live-order-list-partial');assert.equal(h.proof.ready,false);assert.equal(h.calls.apply,1);
  const newer=confirmationHarness({auto:false,status:'healthy'}),waiting=newer.scope.confirmLatest(()=>true,newer.register).catch(error=>error);let release;
  newer.slots[0].next(newer.snapshot(299));newer.ctx.snapshotSequence++;newer.proof.ready=false;newer.ctx.snapshotApplication=new Promise(resolve=>{release=()=>{newer.proof.error='live-order-list-partial';newer.proof.ready=false;resolve();};});
  await flush();assert.equal(newer.calls.apply,0);release();assert.equal((await waiting).code,'live-order-list-partial');assert.equal(newer.proof.ready,false);
  return[{name:'old 299 verification completion cannot discard newly received partial 300 confirmation',status:'PASS_CODE_MODEL'},{name:'confirmation waits for newer received application instead of stale prior proof',status:'PASS_CODE_MODEL'}];
}

async function scopeStopCases(){
  const h=confirmationHarness({auto:false}),pending=h.scope.confirmLatest(()=>true,h.register).catch(error=>error);
  Object.assign(h.ctx,{stopped:false,queryGeneration:0,dateRolloverTimer:null,unsubscribeCurrentQuery:()=>{h.calls.permanentStop=(h.calls.permanentStop||0)+1;}});
  const start=source.indexOf('      startCurrentDateQuery();\n      return function(){'),body=source.indexOf('function(){',start),end=source.indexOf('\n    }',body);assert(start>0&&end>body);
  vm.runInContext('stopScope='+source.slice(body,end).trim().replace(/;$/,'')+';',h.ctx);h.ctx.stopScope();
  assert.equal((await pending).code,'auth/session-changed');assert.equal(h.calls.close,1);assert.equal(h.calls.permanentStop,1);assert.equal(h.ctx.confirmationCleanups.size,0);assert.equal(h.cleanups.size,0);
  const next=confirmationHarness({auto:false}),changing=next.scope.confirmLatest(()=>true,next.register).catch(error=>error);let unconfirmed=false;
  Object.assign(next.ctx,{stopped:false,window:{HaetsalConnection:{scopeFailed:(key,code)=>{assert.equal(key,'live-order-query');assert.equal(code,'live-order-unconfirmed');unconfirmed=true;}}}});
  const prefixStart=source.indexOf('      const startCurrentDateQuery = function(compatibilityMode=false){'),prefixEnd=source.indexOf('        const currentQueryGeneration',prefixStart);assert(prefixStart>0&&prefixEnd>prefixStart);
  vm.runInContext(source.slice(prefixStart,prefixEnd)+'};startCurrentDateQuery();',next.ctx);
  assert.equal((await changing).code,'auth/session-changed');assert.equal(next.calls.close,1);assert(unconfirmed);
  return[{name:'actual scope stop releases owned confirmation immediately before deadline',status:'PASS_CODE_MODEL'},{name:'query generation change cancels confirmation and retains visible unconfirmed live state',status:'PASS_CODE_MODEL'}];
}

function listenerHealthCases(){
  const start=source.indexOf('          const snapshotIsHealthy = fromConfirmation'),end=source.indexOf('          const verifiedRowsOnly',start);assert(start>0&&end>start);
  for(const [confirmation,cache,pending,expected,marked]of [[true,false,false,true,0],[true,true,false,false,0],[true,false,true,false,0],[false,false,false,true,1]]){
    const ctx={fromConfirmation:confirmation,snapshot:{metadata:{fromCache:cache,hasPendingWrites:pending}},scopeInstance:{status:'cached'},calls:0,markScopedRealtimeSubscriptionHealthy:()=>{ctx.calls++;ctx.scopeInstance.status='healthy';return true;}};vm.createContext(ctx);vm.runInContext(source.slice(start,end)+'result=snapshotIsHealthy;',ctx);assert.equal(ctx.result,expected);assert.equal(ctx.calls,marked);assert.equal(ctx.scopeInstance.status,marked?'healthy':'cached');
  }
  return [{name:'actual receiver health expression separates one-shot and listener metadata',status:'PASS_CODE_MODEL'}];
}

const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const path=require('node:path');
const input=process.argv[2]||path.resolve(__dirname,'../../index.html');
const source=fs.readFileSync(input,'utf8').replace(/\r\n/g,'\n');
const sha=crypto.createHash('sha256').update(source).digest('hex');
const start=source.indexOf('  const connectionFailures = new Map();');
const end=source.indexOf('  window.firebaseApp = app;',start);
assert(start>0&&end>start);
const block=source.slice(start,end);
const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
function setup(pending,options={}){
  let time=1000,next=0;const timers=new Map(),calls={},events={};
  const count=n=>{calls[n]=(calls[n]||0)+1;};
  let resolveHeld,rejectHeld;
  const held=new Promise((r,j)=>{resolveHeld=r;rejectHeld=j;});
  const step=(name,value)=>{count(name);return name===pending?held:Promise.resolve(value);};
  const element=()=>({style:{},hidden:false,disabled:false,textContent:'',setAttribute(){},append(){},addEventListener(){}});
  const user={uid:'synthetic-operator',isAnonymous:options.anonymous===true};
  const window={addEventListener:(n,f)=>{events[n]=f;},HaetsalRuntimeGuard:{isStopped:()=>options.stopped===true},HaetsalFirestoreQuotaGuard:{isBlocked:()=>false},HaetsalViewRestore:{onConnectionReady:()=>count('restore')},HaetsalRealtimeScope:{reconnect:()=>{count('reconnectScopes');return true;},confirmCurrent:()=>options.confirmError?Promise.reject({code:options.confirmError}):step('snapshot',{required:true,ready:true}),getLiveOrderSnapshot:()=>({ready:true,scope:{},uid:user.uid,role:'ADMIN',businessDate:'2026-11-14'})},HaetsalAdminAuth:{isVerified:()=>true},HaetsalManagerAuth:{isVerified:()=>false},OrderModule:{state:{appRole:'ADMIN',currentView:'ADMIN_DASHBOARD',dashboardTab:'ORDERS'},resumeDeferredFullBackupAfterReconnect:()=>count('backup')},HaetsalCloudStore:{reconcileOrderSave:()=>step('save-result',false),getSyncStatus:()=>({phase:options.writePhase||(pending==='save-result'?'unknown':'received')}),markAllConnectionErrors:()=>count('connectionErrors')}};
  const context={window,document:{createElement:element,body:{prepend(){}},addEventListener:(n,f)=>{events[n]=f;}},console:{error:()=>count('error'),warn(){}},auth:{currentUser:user},browserSessionPersistence:{},authStateReady:step('auth-state',user),operatorAuthGeneration:0,requireAuthSessionStorage:()=>count('storage'),setPersistence:()=>step('persistence'),ensureAnonymousLogin:()=>step('login',user),verifyFirebaseOperatorUser:(_u,force)=>step(force?'permission':'permission-recheck',options.claims||{admin:true,manager:true}),loadRuntimePolicyOnce:()=>step('policy',{checked:true,blocked:false}),resolveFirebaseReady:()=>count('firebaseReady'),resolveRuntimePolicyReady:()=>count('policyReady'),setTimeout:(f,ms)=>{const id=++next;timers.set(id,{at:time+ms,f});return id;},clearTimeout:id=>timers.delete(id),setInterval:(f,ms)=>{const id=++next;timers.set(id,{at:time+ms,f,ms});return id;},clearInterval:id=>timers.delete(id),Date:class extends Date{static now(){return time;}},Promise,Map,Set,Math};
  let orderStatusListener;
  window.HaetsalCloudStore.subscribeSyncStatus=(key,listener)=>{assert.equal(key,'order');orderStatusListener=listener;};
  context.notifyOrderStatus=()=>orderStatusListener();
  vm.createContext(context);vm.runInContext(block,context);
  async function advance(ms){const limit=time+ms;await flush();for(;;){const row=[...timers].filter(([,x])=>x.at<=limit).sort((a,b)=>a[1].at-b[1].at)[0];if(!row)break;const[id,t]=row;time=t.at;timers.delete(id);if(t.ms)timers.set(id,{...t,at:time+t.ms});t.f();await flush();}time=limit;await flush();}
  return {api:window.HaetsalConnection,context,calls,advance,events,release:resolveHeld,reject:rejectHeld,button:()=>vm.runInContext('reconnectButton',context),text:()=>vm.runInContext('connectionText.textContent',context)};
}


function scopeCases(){
  const rows=[];
  const extract=(a,b)=>{const start=source.indexOf('    function '+a+'('),end=source.indexOf('    function '+b+'(',start);assert(start>0&&end>start);return source.slice(start,end);};
  const code=extract('markScopedRealtimeSubscriptionHealthy','scheduleScopedRealtimeSubscriptionRetry')+extract('startScopedRealtimeSubscription','stopAllScopedRealtimeSubscriptions')+extract('runScopedRealtimeHealthCheck','getRealtimeScopeState');
  function create({status='cached',age=16000,online=true,authorized=true,retry}={}){
    const user={uid:'synthetic-scope-operator',isAnonymous:false},subs=new Map(),retries=new Map(),counts={starts:0,stops:0,healthy:0,syncs:0};
    const ctx={auth:{currentUser:user},CONNECTION_WAIT_TIMEOUT_MS:15000,scopedRealtimeSubscriptions:subs,scopedRealtimeRetryStates:retries,liveOrderQueryGuardVerificationGeneration:1,isScopedRealtimeRecoveryAllowed:()=>online,isScopedRealtimeGuardBlocked:()=>false,getOrderStatisticsScope:()=>({user:authorized?user:null}),clearScopedRealtimeRetryState:key=>retries.delete(key),window:{HaetsalConnection:{scopeHealthy:()=>counts.healthy++,scopeFailed(){},scopeReleased(){}},HaetsalRuntimeGuard:{registerRealtimeUnsubscribe:fn=>fn}},tabletRuntimeDiagnostics:{observeRealtimeState(){}},Date:class extends Date{static now(){return 100000;}},console:{error(){}},setTimeout,clearTimeout};
    vm.createContext(ctx);vm.runInContext(code,ctx);
    ctx.syncScopedRealtimeSubscriptions=()=>{counts.syncs++;if(!subs.has('live-order-query'))ctx.startScopedRealtimeSubscription('live-order-query','live-order-query',()=>{counts.starts++;return()=>counts.stops++;});return true;};
    ctx.retryFailedOrderGuardVerifications=()=>{};
    ctx.startScopedRealtimeSubscription('live-order-query','live-order-query',()=>{counts.starts++;return()=>counts.stops++;});
    const original=subs.get('live-order-query');original.status=status;original.statusSince=100000-age;
    if(retry){ctx.stopScopedRealtimeSubscription('live-order-query');retries.set('live-order-query',retry);}
    return {ctx,subs,retries,counts,original};
  }
  for(const [status,age,online,authorized,replace]of [['cached',16000,true,true,false],['starting',16000,true,true,false],['cached',1000,true,true,false],['healthy',16000,true,true,false],['pending-write',16000,true,true,false],['cached',16000,false,true,false],['cached',16000,true,false,false]]){
    const h=create({status,age,online,authorized});h.ctx.runScopedRealtimeHealthCheck(true);
    assert.equal(h.subs.get('live-order-query')!==h.original,replace);assert.equal(h.subs.size,1);assert.equal(h.counts.stops,replace?1:0);
    if(replace){assert.equal(h.ctx.markScopedRealtimeSubscriptionHealthy('live-order-query',h.original,{metadata:{fromCache:false,hasPendingWrites:false}}),false);assert.equal(h.counts.healthy,0);}
    rows.push({name:'scope '+[status,age,online,authorized].join('/'),status:'PASS_CODE_MODEL'});
  }
  {
    const h=create({status:'healthy'});let unconfirmed=0;h.ctx.window.HaetsalConnection.scopeFailed=(key,code)=>{assert.equal(key,'live-order-query');assert.equal(code,'live-order-unconfirmed');unconfirmed++;};
    for(let i=0;i<2;i++)assert.equal(h.ctx.markScopedRealtimeSubscriptionHealthy('live-order-query',h.original,{metadata:{fromCache:true,hasPendingWrites:false}}),false);
    assert.equal(unconfirmed,1);assert.equal(h.counts.starts,1);assert.equal(h.ctx.markScopedRealtimeSubscriptionHealthy('live-order-query',h.original,{metadata:{fromCache:false,hasPendingWrites:false}}),true);assert.equal(h.counts.healthy,1);
    rows.push({name:'live cache transition marks unconfirmed once without resubscription until server callback',status:'PASS_CODE_MODEL'});
  }
  for(const [code,manual,restart]of [['permission-denied',true,false],['unauthenticated',true,true],['unavailable',false,false],['unavailable',true,true]]){
    const h=create({retry:{terminal:code!=='unavailable',exhausted:code==='unavailable',attempt:6,generation:1,ready:false,lastErrorCode:code}});h.ctx.runScopedRealtimeHealthCheck(manual);
    assert.equal(h.subs.has('live-order-query'),restart);
    rows.push({name:'terminal/exhausted '+code+'/'+manual,status:'PASS_CODE_MODEL'});
  }
  return rows;
}

let regressionSettled=false;
process.once('beforeExit',()=>{if(!regressionSettled){console.error('Connection regression did not complete');process.exitCode=1;}});
(async()=>{
  const rows=[];
  for(const phase of ['auth-state','persistence','login','permission','policy','permission-recheck','snapshot','save-result']){
    const h=setup(phase),first=h.api.reconnect();assert.equal(h.api.reconnect(),first);await flush();
    await h.advance(14999);assert.equal(h.button().disabled,true);
    await h.advance(1);assert.equal(await first,false);assert.equal(h.button().disabled,false);
    assert.equal(h.api.getState().error,'connection/wait-timeout');
    const second=h.api.reconnect();await flush();assert.equal(h.calls[phase],phase==='snapshot'?2:1,'pending login/write must stay shared; list confirmation belongs to the new attempt');
    const value=phase==='login'||phase==='auth-state'?h.context.auth.currentUser:phase==='policy'?{checked:true,blocked:false}:phase==='snapshot'?{required:true,ready:true}:phase==='permission'||phase==='permission-recheck'?{admin:true,manager:true}:undefined;
    h.release(value);assert.equal(await second,true);assert.equal(h.api.getState().run.id,2);assert.equal(h.api.getState().state,'ready');
    assert.equal(h.calls.backup,phase==='save-result'?undefined:1,'late attempt issued an extra backup');
    rows.push({phase,status:'PASS_CODE_MODEL',timeoutMs:15000,pendingPhaseCalls:h.calls[phase],backups:h.calls.backup||0});
  }
  for(const code of ['permission-denied','live-order-list-partial','live-order-list-unconfirmed']){
    const h=setup(null,{confirmError:code});assert.equal(await h.api.reconnect(),false);assert.equal(h.api.getState().error,code);assert.equal(h.calls['save-result'],1);assert.equal(h.calls.backup,undefined);rows.push({name:code,status:'PASS_CODE_MODEL'});
  }
  for(const pendingRetry of [false,true]){
    const h=setup(),ctx=h.context;
    const retryStart=source.indexOf('  function retryWorkQueueRestore(){'),retryEnd=source.indexOf('  function openRestoreLogin(){',retryStart);
    const readyStart=source.indexOf('  window.HaetsalViewRestore.onConnectionReady = function(){'),readyEnd=source.indexOf('  restoreLastViewSnapshot();',readyStart);
    const confirmStart=source.indexOf('      confirmCurrent:async function(isCurrent, registerCleanup){'),confirmEnd=source.indexOf('      stopAll:',confirmStart);
    assert(retryStart>0&&readyStart>0&&confirmStart>0);
    ctx.window.HaetsalViewRestore.pending=true;
    ctx.getRealtimeScopeState=()=>({operatorDashboard:ctx.opened});ctx.getOrderStatisticsScope=()=>({user:ctx.auth.currentUser});ctx.isScopedRealtimeGuardBlocked=()=>false;
    ctx.scopedRealtimeSubscriptions=new Map([['live-order-query',{confirmLatest:async()=>({required:true,ready:true})}]]);
    ctx.scopedRealtimeRetryStates=new Map();ctx.opened=false;ctx.restoreCalls=0;ctx.skipFirst=pendingRetry;
    vm.runInContext('let restoringWorkQueue=false,workQueueRestoreRetry=null;function cancelWorkQueueRestore(){};function restoreWorkQueue(){restoreCalls++;if(skipFirst){skipFirst=false;return;}opened=true;window.HaetsalViewRestore.pending=false;}'+source.slice(retryStart,retryEnd)+source.slice(readyStart,readyEnd)+'window.HaetsalRealtimeScope.confirmCurrent=('+source.slice(confirmStart,confirmEnd).trim().replace(/^confirmCurrent:/,'').replace(/,$/,'')+');',ctx);
    let first;if(pendingRetry){first=h.api.reconnect();await h.advance(100);assert.equal(h.api.getState().run.stage,'snapshot');}
    const retry=ctx.retryWorkQueueRestore();await h.advance(100);await retry;if(first)assert.equal(await first,true);
    assert.equal(h.api.getState().state,'ready');assert.equal(ctx.restoreCalls,pendingRetry?2:1);
    rows.push({name:pendingRetry?'restore retry wakes validated pending connection':'restore retry opens dashboard during its own connection',status:'PASS_CODE_MODEL'});
  }
  {
    const h=setup('save-result',{confirmError:'live-order-list-partial',writePhase:'unknown'}),first=h.api.reconnect();await flush();
    assert.equal(h.calls['save-result'],1);await h.advance(15000);assert.equal(await first,false);
    const second=h.api.reconnect();await flush();assert.equal(h.calls['save-result'],1);h.release(false);
    assert.equal(await second,false);assert.equal(h.api.getState().error,'live-order-list-partial');assert.equal(h.calls.backup,undefined);
    rows.push({name:'partial list independently reconciles one pending original receipt across timeout',status:'PASS_CODE_MODEL'});
  }
  {
    const h=setup('snapshot'),first=h.api.reconnect();await h.advance(15000);assert.equal(await first,false);
    h.context.window.HaetsalRealtimeScope.confirmCurrent=async()=>({required:true,ready:true});
    const second=h.api.reconnect();assert.equal(await second,true);const id=h.api.getState().run.id;
    h.release({required:true,ready:true});await flush();assert.equal(h.api.getState().run.id,id);assert.equal(h.api.getState().state,'ready');
    rows.push({name:'new attempt confirms replacement scope without waiting for obsolete query',status:'PASS_CODE_MODEL'});
  }
  {
    const h=setup('save-result',{writePhase:'unknown'}),first=h.api.reconnect();await h.advance(15000);assert.equal(await first,false);
    assert(h.text().includes('원래 저장 결과는 미확정'));
    h.context.window.HaetsalCloudStore.getSyncStatus=()=>({phase:'synced'});h.context.notifyOrderStatus();
    assert(!h.text().includes('원래 저장 결과는 미확정'));assert.equal(h.api.getState().run.id,1);assert.equal(h.calls.backup,undefined);
    h.release(true);await flush();rows.push({name:'late original save status refreshes notice without reconnect or reissue',status:'PASS_CODE_MODEL'});
  }
  {
    const h=setup('policy');const first=h.api.reconnect();await flush();h.context.auth.currentUser={uid:'synthetic-next',isAnonymous:false};h.context.operatorAuthGeneration++;
    h.release({checked:true,blocked:false});assert.equal(await first,false);assert.equal(h.calls.reconnectScopes,undefined);assert.equal(h.calls.backup,undefined);rows.push({name:'account changed during policy wait',status:'PASS_CODE_MODEL'});
  }
  {
    const h=setup('permission');const first=h.api.reconnect();await flush();h.events['haetsal:runtime-stopped']();assert.equal(await first,false);h.release({});await flush();assert.equal(h.api.getState().state,'failed');assert.equal(h.calls.policyReady,undefined);rows.push({name:'runtime stop and late permission result',status:'PASS_CODE_MODEL'});
  }
  { const h=setup(null,{claims:{admin:false,manager:false}});assert.equal(await h.api.reconnect(),false);assert.equal(h.api.getState().error,'permission-denied');assert.equal(h.calls.policy,undefined);rows.push({name:'revoked operator role cannot report recovery success',status:'PASS_CODE_MODEL'}); }
  { const h=setup('policy',{writePhase:'unknown'}),task=h.api.reconnect();await flush();h.reject({code:'unavailable'});assert.equal(await task,false);assert.equal(h.calls.connectionErrors,undefined);rows.push({name:'connection failure preserves unknown original write status',status:'PASS_CODE_MODEL'}); }
  {const h=setup(null,{anonymous:true});assert.equal(await h.api.reconnect(),false);assert.equal(h.api.getState().error,'permission-denied');assert.equal(h.calls.policy,undefined);rows.push({name:'anonymous session cannot recover operator view',status:'PASS_CODE_MODEL'});}
  {const a=source.indexOf('  async function ensureAnonymousLogin() {'),b=source.indexOf('  async function verifyFirebaseOperatorUser(',a),user={uid:'synthetic-anonymous',isAnonymous:true};let calls=0,resolve;const held=new Promise(r=>resolve=r),ctx={auth:{currentUser:null},signInAnonymously:()=>{calls++;return held;}};vm.createContext(ctx);vm.runInContext('let anonymousLoginTask=null;'+source.slice(a,b),ctx);const one=ctx.ensureAnonymousLogin(),two=ctx.ensureAnonymousLogin();assert.equal(calls,1);ctx.auth.currentUser=user;resolve({user});assert.equal(await one,user);assert.equal(await two,user);rows.push({name:'logout and reconnect share pending anonymous SDK login',status:'PASS_CODE_MODEL'});}
  for(const phase of ['auth-state','persistence','login','permission','policy','permission-recheck','snapshot','save-result']){const h=setup(phase),task=h.api.reconnect();await flush();h.reject({code:'unavailable'});assert.equal(await task,false);assert.equal(h.button().disabled,false);assert.equal(h.calls.backup,undefined);rows.push({name:'rejected '+phase+' releases UI without backup',status:'PASS_CODE_MODEL'});}
  {
    const h=setup();h.api.scopeFailed('live-order-query','live-order-unconfirmed');assert.equal(await h.api.reconnect(),true);assert.equal(vm.runInContext('connectionNotice.hidden',h.context),false);h.api.scopeHealthy('live-order-query');assert.equal(vm.runInContext('connectionNotice.hidden',h.context),true);rows.push({name:'ready list retains notice until actual live scope becomes healthy',status:'PASS_CODE_MODEL'});
  }
  rows.push(...scopeCases());
  rows.push(...await confirmationCases());
  rows.push(...await lateConfirmationCases());
  rows.push(...await receiptOrderCases());
  rows.push(...await scopeStopCases());
  rows.push(...listenerHealthCases());
  const report={status:'PASS_CODE_MODEL',scope:'Actual connection block with stubbed auth/SDK; no native or SDK pass claim',sourceLFSHA256:sha,n:rows.length,rows};
regressionSettled=true;console.log(JSON.stringify(report));
})().catch(e=>{regressionSettled=true;console.error(e);process.exitCode=1;});
