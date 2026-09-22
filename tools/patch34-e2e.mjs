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

// Browser smoke: strip only Firebase module and execute candidate-exact non-module app code in headless Chrome.
let smokeHtml=candidate.replace(/<script\s+type=["']module["'][^>]*>[\s\S]*?<\/script>/i,'');
smokeHtml=smokeHtml.replace('<head>','<head><script>window.__patch34Errors=[];window.addEventListener("error",e=>window.__patch34Errors.push(String(e.message||"error")));window.addEventListener("unhandledrejection",e=>window.__patch34Errors.push(String(e.reason&&e.reason.message||e.reason||"rejection")));<\/script>');
const smokeRunner=`<script>(function(){try{window.HaetsalAdminAuth={isVerified:()=>true};window.HaetsalOperatorSession.setRole('ADMIN');const results=[];const capture=(label)=>({label,view:window.OrderModule&&window.OrderModule.state&&window.OrderModule.state.currentView,tab:window.OrderModule&&window.OrderModule.state&&window.OrderModule.state.dashboardTab,html:document.body.innerHTML.length,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth});const boot={order:!!window.OrderModule,tumbler:!!window.TumblerModule,main:!!document.getElementById('main-screen'),orderScreen:!!document.getElementById('order-screen')};if(!boot.order||!boot.tumbler||!boot.main||!boot.orderScreen) throw new Error('boot objects missing');window.OrderModule.openDashboard('ADMIN','ORDERS');results.push(capture('ORDERS'));window.OrderModule.state.dashboardTab='SUMMARY';window.OrderModule.render();results.push(capture('SUMMARY'));window.OrderModule.state.dashboardTab='TUMBLER';window.OrderModule.render();results.push(capture('TUMBLER'));window.OrderModule.state.appRole='GUEST';window.OrderModule.state.currentView='ORDER_MAIN';window.OrderModule.render();results.push(capture('ORDER_MAIN'));const payload={ok:true,boot,results,errors:window.__patch34Errors.slice(),innerWidth:innerWidth,innerHeight:innerHeight};const m=document.createElement('meta');m.id='patch34-smoke-result';m.setAttribute('data-json',encodeURIComponent(JSON.stringify(payload)));document.head.appendChild(m)}catch(error){const m=document.createElement('meta');m.id='patch34-smoke-result';m.setAttribute('data-json',encodeURIComponent(JSON.stringify({ok:false,error:String(error&&error.stack||error),errors:(window.__patch34Errors||[]).slice()})));document.head.appendChild(m)}})();<\/script>`;
const bodyCloseIndex=smokeHtml.lastIndexOf('</body>');assert(bodyCloseIndex>=0,'closing body not found');smokeHtml=smokeHtml.slice(0,bodyCloseIndex)+smokeRunner+smokeHtml.slice(bodyCloseIndex);
assert(!smokeHtml.includes('firebase-app.js'),'Firebase module still present in smoke copy');
assert(smokeHtml.includes('patch34-smoke-result'),'smoke runner injection missing');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'haetsal-smoke-'));fs.writeFileSync(path.join(root,'index.html'),smokeHtml);try{fs.copyFileSync('logo.png',path.join(root,'logo.png'))}catch{}
const chromeCandidates=['google-chrome','google-chrome-stable','chromium','chromium-browser'];let chrome=null;for(const x of chromeCandidates){try{execFileSync('which',[x],{stdio:'pipe'});chrome=x;break}catch{}}assert(chrome,'Chrome not found');
const py=spawn('python3',['-m','http.server','18080','--bind','127.0.0.1','--directory',root],{stdio:'ignore'});let served='';for(let i=0;i<30&&!served;i++){try{const resp=await fetch('http://127.0.0.1:18080/');if(resp.ok)served=await resp.text()}catch{}if(!served)await new Promise(r=>setTimeout(r,100))}assert(served.includes('patch34-smoke-result'),'smoke server did not serve injected HTML');assert(!served.includes('firebase-app.js'),'smoke server served Firebase module');
const smokeResults=[];
try{
  for(const [w,h] of [[390,844],[768,1024],[1024,768],[1366,768]]){
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'haetsal-chrome-'));
    const args=['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check',`--window-size=${w},${h}`,`--user-data-dir=${profile}`,'--dump-dom','http://127.0.0.1:18080/'];
    const dom=execFileSync(chrome,args,{encoding:'utf8',maxBuffer:20*1024*1024,timeout:25000,stdio:['ignore','pipe','pipe']});
    const m=dom.match(/<meta id="patch34-smoke-result" data-json="([^"]*)"/i);if(!m){console.log("SMOKE_DOM_DEBUG_START",dom.slice(0,2500));console.log("SMOKE_DOM_DEBUG_END",dom.slice(-5000));throw new Error(`smoke result missing ${w}x${h}`)}const data=JSON.parse(decodeURIComponent(m[1].replace(/&amp;/g,'&')));assert(data.ok,`browser smoke failed ${w}x${h}: ${data.error||''}`);assert(Array.isArray(data.errors)&&data.errors.length===0,`browser errors ${w}x${h}: ${data.errors}`);assert(data.results.length===4,`view count ${w}x${h}`);for(const row of data.results){assert(row.html>1000,`empty render ${row.label}`);if(row.label!=='ORDER_MAIN') assert(row.view==='ADMIN_DASHBOARD',`admin view failed ${row.label}`);else assert(row.view==='ORDER_MAIN','guest view failed')};smokeResults.push({requested:[w,h],actual:[data.innerWidth,data.innerHeight],views:data.results.map(x=>x.label),maxOverflow:Math.max(...data.results.map(x=>x.scrollWidth-x.clientWidth))});
  }
}finally{py.kill('SIGTERM')}
console.log('PASS browser smoke',JSON.stringify(smokeResults));
console.log('PATCH34_E2E_PASS');
