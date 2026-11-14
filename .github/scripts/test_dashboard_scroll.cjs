// Exact source-function regression for dashboard lifecycle scroll restoration.
// Synthetic DOM and deterministic event delivery model; this does not establish
// browser momentum, touch responsiveness, device performance, or SDK correctness.
// No product script startup, network, Firebase, or production data access.
// Run: node .github/scripts/test_dashboard_scroll.cjs [path/to/index.html]
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const path=require('node:path');
const sourcePath=path.resolve(process.argv[2] || path.join(__dirname,'../../index.html'));
const source=fs.readFileSync(sourcePath,'utf8');
const extract=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start);assert(start>=0 && end>start,'Source boundaries must exist: '+a);return source.slice(start,end);};
const scroll=extract('    function getDashboardScrollContainer(){','    function captureAdminUsersListScrollPosition(){');
const render=extract('  function render(){','    function networkBar(){');
function setup(options = {}){
let now=0,id=0,timers=new Map(),listeners=new Map(),replacementCount=0,owner,observations=[];
const docOwner={scrollTop:0,scrollHeight:800,clientHeight:800};
const cardTarget={inside:true};const headerTarget={inside:false};
function makeOwner(){const o={scrollTop:0,scrollHeight:6000,clientHeight:600,contains:t=>t.inside===true,closest:()=>({contains:()=>true}),getBoundingClientRect:()=>({top:100,bottom:700})};o.querySelectorAll=()=>Array.from({length:40},(_,i)=>({querySelector:()=>({dataset:{orderId:String(i+1)}}),getBoundingClientRect:()=>({top:100+i*150-o.scrollTop,bottom:250+i*150-o.scrollTop})}));return o;}
owner=makeOwner();const app={contains:()=>true,querySelector:()=>owner};Object.defineProperty(app,'innerHTML',{set(){replacementCount++;owner=makeOwner();}});
const document={scrollingElement:docOwner,documentElement:docOwner,body:{},activeElement:null,addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);}};
const window={innerHeight:800,pageYOffset:0,pageXOffset:0,getComputedStyle:()=>({overflowY:'auto'}),performance:{now:()=>now},setTimeout:(fn,delay)=>{timers.set(++id,{fn,time:now+delay});return id;},clearTimeout:id=>timers.delete(id),scrollTo:(_x,y)=>{docOwner.scrollTop=y;window.pageYOffset=y;}};
const context={console,document,window,app,modalRoot:{contains:()=>true},observations,state:{currentView:'MANAGER_DASHBOARD',dashboardTab:'ORDERS',selectedUserId:'',completedFilterDate:'2026-11-12',archivedCompletedOrdersStatusByDate:{'2026-11-12':'loaded'}},getOrderScrollContainer:()=>null,observeTabletRuntime:(name,data)=>observations.push({t:now,name,...data}),isAdminUserSearchActiveForRemoteRender:()=>false,requestAnimationFrame:fn=>window.setTimeout(fn,16),setTimeout:window.setTimeout};
for(const name of ['restoreOrderRentRecovery','saveOrderRentRecovery','updateAdminUsersSearchResults','setupAutoReturn','restoreAdminUsersListScrollPosition','restoreOrderEditModalScrollPosition','restoreOrderFocusSnapshot'])context[name]=()=>{};
for(const name of ['captureOrderFocusSnapshot','captureAdminUsersListScrollPosition','captureOrderEditModalScrollPosition'])context[name]=()=>null;
context.isOperatorDashboardViewForArchiveAuto=()=>false;context.renderModals=()=>'';context.renderDashboardView=()=>'<synthetic/>';
// This model exercises full-render restoration; native DOM patching is checked in the browser.
context.patchDashboardOrdersView=()=>false;context.dashboardOrdersRenderKey=()=>'';context.renderedDashboardOrdersKey='';
context.prepareDashboardOrderCards=()=>{};context.rememberDashboardOrderCards=()=>{};
vm.createContext(context);
vm.runInContext(`let orderLifecycleScrollSnapshot=null,lastDashboardScrollSnapshot=null,orderScrollRestoreGeneration=0,orderLifecycleRenderQueued=false,orderLifecycleRenderGeneration=0,dashboardTouchInteraction=null,dashboardTouchScrollObserved=false,dashboardTouchRenderDeferred=false,dashboardTouchRenderFlushTimer=null,adminUserSearchRemoteRenderPending=false,preserveOrderScrollOnNextRender=false,preserveOrderEditModalScrollOnNextRender=false,orderEditModalScrollSnapshot=null,deferredOrderSearchRemoteRender=false,adminUserSearchIsComposing=false;\n${options.scrollCode || scroll}\n${render}\nthis.inspect=()=>({top:getDashboardScrollTop(getDashboardScrollOwner()),active:dashboardTouchInteraction,deferred:dashboardTouchRenderDeferred,lifecycle:orderLifecycleScrollSnapshot&&orderLifecycleScrollSnapshot.dashboardTop});`,context);
return {ctx:context,emit(type,target=cardTarget,extra={}){for(const fn of listeners.get(type)||[])fn({type,target,...extra});},touchStart(){this.emit('pointerdown',cardTarget,{pointerType:'touch',pointerId:1});this.emit('touchstart',cardTarget,{touches:[{identifier:1}]});},touchEnd(){this.emit('touchend',cardTarget,{changedTouches:[{identifier:1}]});},scroll(top){owner.scrollTop=top;this.emit('scroll',owner);},advance(delta){const end=now+delta;while(true){let pair=[...timers].filter(([,x])=>x.time<=end).sort((a,b)=>a[1].time-b[1].time)[0];if(!pair)break;now=pair[1].time;timers.delete(pair[0]);pair[1].fn();}now=end;},replacements:()=>replacementCount,owner:()=>owner,setTop:(top)=>{owner.scrollTop=top;},replaceOwner:()=>{owner=makeOwner();},cardTarget,headerTarget};
}

const results=[];
function check(name,fn){fn();results.push({name,result:'PASS_CODE_MODEL'});}
check('touch render defers until release and restores latest scroll',()=>{
 const h=setup();h.scroll(600);h.touchStart();h.ctx.render();assert.equal(h.replacements(),0);h.scroll(900);h.touchEnd();h.advance(119);assert.equal(h.replacements(),0);h.advance(1);assert.equal(h.replacements(),1);assert.equal(h.ctx.inspect().top,900);
});
check('continued scrolling postpones the 120 ms deferred flush',()=>{
 const h=setup();h.touchStart();h.scroll(600);h.ctx.render();h.touchEnd();h.advance(60);h.scroll(700);h.advance(60);h.scroll(800);h.advance(119);assert.equal(h.replacements(),0);h.advance(1);assert.equal(h.ctx.inspect().top,800);
});
for(const [name,initial,next,restoreFirst] of [
 ['restored owner user scroll down',500,900,true],
 ['restored owner user scroll up',900,400,true],
 ['restored owner user reaches top',900,0,true],
 ['restored snapshot was at zero',0,900,true],
 ['initial snapshot before first render',500,900,false],
 ['initial snapshot was at zero',0,900,false]
])check(name,()=>{
 const h=setup();h.scroll(initial);h.ctx.beginOrderLifecycleScrollPreservation('synthetic');if(restoreFirst)h.ctx.render();h.setTop(next);h.ctx.render();assert.equal(h.ctx.inspect().top,next);h.emit('scroll',h.owner());assert.equal(h.ctx.getActiveOrderLifecycleScrollSnapshot(),null);
});
check('different owner retains legitimate lifecycle restoration',()=>{
 const h=setup();h.scroll(500);h.ctx.beginOrderLifecycleScrollPreservation('synthetic');h.ctx.render();h.replaceOwner();h.ctx.render();assert.equal(h.ctx.inspect().top,500);
});
check('earlier delivered scroll event clears stale snapshot',()=>{
 const h=setup();h.scroll(500);h.ctx.beginOrderLifecycleScrollPreservation('synthetic');h.ctx.render();h.scroll(900);h.ctx.render();assert.equal(h.ctx.inspect().top,900);
});
check('fallback from replaced owner still restores intended position',()=>{
 const h=setup();h.scroll(500);h.replaceOwner();h.ctx.beginOrderLifecycleScrollPreservation('remote-fallback',h.ctx.getRemoteLifecycleScrollFallback());h.ctx.render();assert.equal(h.ctx.inspect().top,500);
});
check('user movement after fallback capture replaces old restoration goal',()=>{
 const h=setup();h.scroll(500);h.replaceOwner();h.ctx.beginOrderLifecycleScrollPreservation('remote-fallback',h.ctx.getRemoteLifecycleScrollFallback());h.setTop(250);h.ctx.render();assert.equal(h.ctx.inspect().top,250);
});
const completionGuard=extract('    function handleCompletionGuardClick(event){','    function startCompletionPointerGesture(event){');
for(const [name,detail,retargeted,otherOrder,expectedBlocked] of [
 ['keyboard after drag remains usable',0,false,false,false],
 ['pointer click after drag remains blocked',1,false,false,true],
 ['retargeted pointer cannot complete another order',1,true,true,true]
])check(name,()=>{
 const button={dataset:{action:'complete-order',orderId:'synthetic-a'}};
 const target=otherOrder?{dataset:{action:'complete-order',orderId:'synthetic-b'}}:button;
 const context={completionBlockedClick:{button,action:'complete-order',orderId:'synthetic-a',retargeted,until:Date.now()+900},getCompletionScrollGuardButton:target=>target};
 vm.createContext(context);vm.runInContext(completionGuard,context);
 let blocked=false;
 context.handleCompletionGuardClick({target,detail,preventDefault:()=>{blocked=true;},stopImmediatePropagation:()=>{}});
 assert.equal(blocked,expectedBlocked);
});
check('today is reused only within the current dashboard render',()=>{
 let reads=0;
 const context={dashboardRenderToday:'',getDateString:()=>String(++reads)};
 vm.createContext(context);vm.runInContext(extract('    function todayYmd(){','    function isStaff(){'),context);
 assert.equal(context.todayYmd(),'1');assert.equal(context.todayYmd(),'2');
 context.dashboardRenderToday='synthetic-date';
 assert.equal(context.todayYmd(),'synthetic-date');assert.equal(reads,2);
 context.dashboardRenderToday='';assert.equal(context.todayYmd(),'3');
});
check('disabled automatic archive skips diagnostics but preserves check state',()=>{
 let checks=0;
 const context={orderArchiveAutoTimer:null,ORDER_ARCHIVE_AUTO_ENABLED:false,orderArchiveAutoInFlight:false,getCurrentOrderArchiveDiagnostics:()=>{throw Error('Disabled diagnostics ran');},setOrderArchiveAutoState:()=>{checks++;}};
 vm.createContext(context);
 vm.runInContext(extract('    function shouldRunAutomaticOrderArchive(diagnostics){','    async function runAutomaticOrderArchiveIfNeeded(reason){'),context);
 assert.equal(context.scheduleAutomaticOrderArchive('synthetic'),false);assert.equal(checks,1);
});
console.log(JSON.stringify({scope:'Source-function synthetic model, not native browser/device verification',source:sourcePath,tests:results.length,results},null,2));
