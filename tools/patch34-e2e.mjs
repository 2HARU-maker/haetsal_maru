import fs from 'fs';
import http from 'http';
import { spawn, execFileSync } from 'child_process';
import os from 'os';
import path from 'path';

const BASE = 'f4865de0886db1b8d35c2ae2c6954d794ba2e2c9';
const candidate = fs.readFileSync('index.html','utf8');
const base = execFileSync('git',['show',`${BASE}:index.html`],{encoding:'utf8',maxBuffer:20*1024*1024});

function assert(cond,msg){ if(!cond) throw new Error(msg); }
function count(h,n){ return h.split(n).length-1; }
const reps = [
[`    const HEARTBEAT_MS = 10000;\n    const SNAPSHOT_COALESCE_MS = 2000;`, `    const HEARTBEAT_MS = 10000;\n    const FIRESTORE_EVENT_WRITE_ENABLED = (() => {\n      try{\n        return new URLSearchParams(window.location.search || '').get('haetsalDiagnostics') === '1';\n      }catch(error){\n        return false;\n      }\n    })();\n    const SNAPSHOT_COALESCE_MS = 2000;`],
[`    function enqueueEvent(type, payload, options){\n      if(!active) return false;`, `    function enqueueEvent(type, payload, options){\n      if(!active || !FIRESTORE_EVENT_WRITE_ENABLED) return false;`],
[`    function ensureHeartbeatTimer(){\n      if(heartbeatTimer) return;\n      heartbeatTimer = window.setInterval(flushHeartbeat, HEARTBEAT_MS);\n    }`, `    function ensureHeartbeatTimer(){\n      if(!FIRESTORE_EVENT_WRITE_ENABLED || heartbeatTimer) return;\n      heartbeatTimer = window.setInterval(flushHeartbeat, HEARTBEAT_MS);\n    }`],
[`          if(quotaBlocked || isOrderGuardVerificationReadBlocked()){\n            chunk.forEach(entry => results.set(entry, { ok:false, error, stopped:true }));\n            continue;\n          }\n          const fallbackResults = await Promise.all(chunk.map(entry => {`, `          if(quotaBlocked || isOrderGuardVerificationReadBlocked()){\n            chunk.forEach(entry => results.set(entry, { ok:false, error, stopped:true }));\n            continue;\n          }\n          if(isOrderGuardVerificationRetryableError(error)){\n            chunk.forEach(entry => results.set(entry, { ok:false, error }));\n            continue;\n          }\n          const fallbackResults = await Promise.all(chunk.map(entry => {`]
];
let reversed=candidate;
for(const [oldS,newS] of reps){ assert(count(base,oldS)===1,'base hunk missing'); assert(count(candidate,newS)===1,'candidate hunk missing'); reversed=reversed.replace(newS,oldS); }
assert(reversed===base,'scope drift detected');
console.log('PASS exact-scope reverse compare');

const scripts=[...candidate.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
assert(scripts.length===10,`expected 10 scripts, got ${scripts.length}`);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'haetsal-check-'));
let checked=0;
for(let i=0;i<scripts.length;i++){
  const attrs=scripts[i][1]||''; const code=scripts[i][2]||'';
  const ext=/type\s*=\s*["']module["']/i.test(attrs)?'.mjs':'.js';
  const p=path.join(tmp,`script-${i}${ext}`); fs.writeFileSync(p,code);
  execFileSync(process.execPath,['--check',p],{stdio:'pipe'}); checked++;
}
console.log(`PASS syntax ${checked}/10`);

// PATCH A exact-block execution
const diagStart=candidate.indexOf('// TABLET_RUNTIME_DIAGNOSTICS_START');
const diagEnd=candidate.indexOf('// TABLET_RUNTIME_DIAGNOSTICS_END');
assert(diagStart>=0&&diagEnd>diagStart,'diagnostics block missing');
const diagBlock=candidate.slice(diagStart,diagEnd+'// TABLET_RUNTIME_DIAGNOSTICS_END'.length);
class URLSearchParamsMock{constructor(s){this.m=new Map();String(s||'').replace(/^\?/,'').split('&').filter(Boolean).forEach(p=>{const [k,v='']=p.split('=');this.m.set(k,v)})}get(k){return this.m.has(k)?this.m.get(k):null}}
async function runDiag(search){let writes=0, intervals=0; const ls=new Map(); const w={innerWidth:1024,innerHeight:768,screen:{width:1024,height:768},location:{search},performance:{memory:{}},OrderModule:{state:{appRole:'ADMIN',currentView:'ADMIN_DASHBOARD'},getProductionQueueOrderIds:()=>[]},HaetsalRuntimeGuard:{},localStorage:{getItem:k=>ls.get(k)||null,setItem:(k,v)=>ls.set(k,String(v)),removeItem:k=>ls.delete(k)},addEventListener:()=>{},setInterval:()=>{intervals++;return 1},clearInterval:()=>{}}; const nav={maxTouchPoints:5,userAgent:'Chrome/153',platform:'Android',onLine:true,connection:{}}; const docm={visibilityState:'visible',hidden:false}; const fn=new Function('window','navigator','document','auth','verifiedManagerUid','db','collection','doc','setDoc','serverTimestamp','URLSearchParams',diagBlock+'\nreturn window.HaetsalTabletRuntimeDiagnostics;'); const d=fn(w,nav,docm,{currentUser:{isAnonymous:false,uid:'manager-1'}},'manager-1',{},()=>({}),()=>({}),async()=>{writes++},()=>({}),URLSearchParamsMock); await Promise.resolve();await Promise.resolve(); d.observeCompletion({action:'test',phase:'busy-set',orderId:'o1'});d.flushHeartbeat();await Promise.resolve();await Promise.resolve();return {writes,intervals};}
const off=await runDiag(''); const on=await runDiag('?haetsalDiagnostics=1'); assert(off.writes===0&&off.intervals===0,'diagnostics default-off failed'); assert(on.writes>=2&&on.intervals===1,'diagnostics explicit-on failed'); console.log('PASS PATCH A runtime gate',JSON.stringify({off,on}));

// PATCH B exact-block execution
const helperStart=candidate.indexOf('    function isOrderGuardVerificationRetryableError(error){');
const helperEnd=candidate.indexOf('    async function readOrderGuardDocumentOnce',helperStart);
const readStart=candidate.indexOf('    function splitOrderGuardVerificationEntries(entries){');
const readEnd=candidate.indexOf('    function settleOrderGuardVerificationEntry',readStart);
const helperBlock=candidate.slice(helperStart,helperEnd); const readBlock=candidate.slice(readStart,readEnd);
async function guardCase(code,quotaBlocked=false){let fallback=0;const error={code,message:'sim'};const h=new Function('ORDER_GUARD_QUERY_CHUNK_SIZE','isOrderGuardVerificationEntryCurrent','isOrderGuardVerificationReadBlocked','closedOrderGuardCollectionRef','revivedOrderGuardCollectionRef','makeClosedOrderGuardDocId','makeRevivedOrderGuardDocId','addRealtimeUsageDiagnostic','realtimeUsageDiagnostics','getDocsFromServer','query','where','documentId','normalizeGuardSnapshot','receiveGuardRecords','markFirestoreQuotaExceeded','readOrderGuardDocumentOnce','console',helperBlock+'\n'+readBlock+'\nreturn {readOrderGuardDocumentsBounded,isOrderGuardVerificationRetryableFailure};')(30,()=>true,()=>false,{},{},x=>'c'+x,x=>'r'+x,()=>{}, {},async()=>{throw error},(...a)=>a,(...a)=>a,()=>'',()=>null,()=>{},()=>quotaBlocked,async()=>{fallback++;return {ok:true}},{error:()=>{}});const e={orderId:'o1'};const m=await h.readOrderGuardDocumentsBounded('closed',[e]);const r=m.get(e);return {fallback,r,retryable:h.isOrderGuardVerificationRetryableFailure(r)}}
const gu=await guardCase('unavailable'); const gf=await guardCase('firestore/unavailable'); const gp=await guardCase('failed-precondition'); const gq=await guardCase('resource-exhausted',true); assert(gu.fallback===0&&gu.retryable,'unavailable failed');assert(gf.fallback===0&&gf.retryable,'firestore/unavailable failed');assert(gp.fallback===1&&gp.r.ok,'nonretry fallback changed');assert(gq.fallback===0&&gq.r.stopped,'quota path changed');console.log('PASS PATCH B runtime matrix');

// Browser smoke: remove Firebase module only; all app non-module code is candidate-exact.
let smokeHtml=candidate.replace(/<script\s+type=["']module["'][^>]*>[\s\S]*?<\/script>/i,'');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'haetsal-smoke-')); fs.writeFileSync(path.join(root,'index.html'),smokeHtml); 
const server=http.createServer((req,res)=>{const p=req.url==='/'?'/index.html':req.url;try{const d=fs.readFileSync(path.join(root,p));res.writeHead(200,{'content-type':p.endsWith('.png')?'image/png':'text/html; charset=utf-8'});res.end(d)}catch{res.writeHead(404);res.end('not found')}}); await new Promise(r=>server.listen(18080,'127.0.0.1',r));
const chromeCandidates=['google-chrome','google-chrome-stable','chromium','chromium-browser'];let chrome=null;for(const x of chromeCandidates){try{execFileSync('which',[x],{stdio:'pipe'});chrome=x;break}catch{}}assert(chrome,'Chrome not found');
const chromeProc=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=9222',`--user-data-dir=${path.join(tmp,'chrome')}`,'http://127.0.0.1:18080/'],{stdio:'ignore'});
async function sleep(ms){return new Promise(r=>setTimeout(r,ms))}; let wsurl='';for(let t=0;t<50&&!wsurl;t++){try{const j=await (await fetch('http://127.0.0.1:9222/json/list')).json();wsurl=j.find(x=>x.type==='page')?.webSocketDebuggerUrl||''}catch{}if(!wsurl)await sleep(100)}assert(wsurl,'CDP unavailable');
const ws=new WebSocket(wsurl);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});let seq=0;const pending=new Map();const exceptions=[];ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails?.text||'exception')};function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,m=>m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id,method,params}))})};await cdp('Runtime.enable');await cdp('Page.enable');await sleep(400);
async function evalv(expr){const r=await cdp('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});if(r.exceptionDetails) throw new Error(r.exceptionDetails.text);return r.result.value}
const boot=await evalv(`(()=>({ready:document.readyState,order:!!window.OrderModule,tumbler:!!window.TumblerModule,main:!!document.getElementById('main-screen'),orderScreen:!!document.getElementById('order-screen')}))()`);assert(boot.order&&boot.tumbler&&boot.main&&boot.orderScreen,'boot objects missing');
await evalv(`(()=>{window.HaetsalAdminAuth={isVerified:()=>true};window.HaetsalOperatorSession={isActive:()=>true,getRole:()=> 'ADMIN',setRole:()=>true};return window.OrderModule.openDashboard('ADMIN','ORDERS')})()`);
const views=[];for(const [w,h,tab] of [[390,844,'ORDERS'],[768,1024,'ORDERS'],[1024,768,'SUMMARY'],[1024,768,'TUMBLER']]){await cdp('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:w<600});const v=await evalv(`(()=>{window.OrderModule.state.dashboardTab='${tab}';window.OrderModule.render();return {w:innerWidth,h:innerHeight,view:window.OrderModule.state.currentView,tab:window.OrderModule.state.dashboardTab,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,html:document.body.innerHTML.length}})()`);assert(v.view==='ADMIN_DASHBOARD',`admin view failed ${tab}`);assert(v.html>1000,'render empty');views.push(v)}
await evalv(`(()=>{window.OrderModule.state.appRole='GUEST';window.OrderModule.state.currentView='ORDER_MAIN';window.OrderModule.render();return true})()`);const guest=await evalv(`(()=>({view:window.OrderModule.state.currentView,html:document.body.innerHTML.length}))()`);assert(guest.view==='ORDER_MAIN'&&guest.html>1000,'guest render failed');assert(exceptions.length===0,'browser exceptions: '+exceptions.join('|'));console.log('PASS browser smoke',JSON.stringify({boot,views,guest}));
ws.close();chromeProc.kill('SIGTERM');server.close();
console.log('PATCH34_E2E_PASS');
