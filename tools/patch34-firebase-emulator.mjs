import fs from 'fs';
import http from 'http';
import { execFileSync, spawn } from 'child_process';
import os from 'os';
import path from 'path';

function assert(cond,msg){if(!cond) throw new Error(msg)}
const source=fs.readFileSync('index.html','utf8');
let html=source;
html=html.replace(
  'getAuth, signInAnonymously, signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserSessionPersistence, getIdTokenResult',
  'getAuth, connectAuthEmulator, signInAnonymously, signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserSessionPersistence, getIdTokenResult'
);
html=html.replace(
  'getFirestore, doc, collection, onSnapshot, setDoc, getDoc, getDocFromServer, getDocs, getDocsFromServer, query, where, orderBy, limit, documentId, runTransaction, serverTimestamp, writeBatch',
  'getFirestore, connectFirestoreEmulator, doc, collection, onSnapshot, setDoc, getDoc, getDocFromServer, getDocs, getDocsFromServer, query, where, orderBy, limit, documentId, runTransaction, serverTimestamp, writeBatch'
);
const oldConfig=`  const firebaseConfig = {
    apiKey: "AIzaSyBfEwPirSANZ2s7CzRvlUeFDnYNxWITuew",
    authDomain: "haetsal-maru-24b95.firebaseapp.com",
    projectId: "haetsal-maru-24b95",
    storageBucket: "haetsal-maru-24b95.firebasestorage.app",
    messagingSenderId: "891947497659",
    appId: "1:891947497659:web:2724d40f10373d091ed19e"
  };`;
const demoConfig=`  const firebaseConfig = {
    apiKey: "demo-key",
    authDomain: "demo-haetsalmaru.firebaseapp.com",
    projectId: "demo-haetsalmaru",
    storageBucket: "demo-haetsalmaru.appspot.com",
    messagingSenderId: "000000000000",
    appId: "1:000000000000:web:demo"
  };`;
assert(html.includes(oldConfig),'production config anchor missing');
html=html.replace(oldConfig,demoConfig);
const initAnchor=`  const auth = getAuth(app);
  const db = getFirestore(app);`;
const initDemo=`  const auth = getAuth(app);
  const db = getFirestore(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings:true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  window.__patch34EmulatorConnected = true;`;
assert(html.includes(initAnchor),'firebase init anchor missing');
html=html.replace(initAnchor,initDemo);
assert(!html.includes('haetsal-maru-24b95'),'production project literal remains in emulator copy');

html=html.replace('<head>','<head><script>window.__patch34EmulatorErrors=[];window.addEventListener("error",e=>window.__patch34EmulatorErrors.push(String(e.message||"error")));window.addEventListener("unhandledrejection",e=>window.__patch34EmulatorErrors.push(String(e.reason&&e.reason.message||e.reason||"rejection")));<\\/script>');
const runner=`<script type="module">(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));const deadline=Date.now()+12000;while(Date.now()<deadline && !(window.__patch34EmulatorConnected && window.firebaseAuthUser && window.HaetsalRealtimeScope && window.HaetsalRealtimeUsageDiagnostics)){await sleep(100)}const user=window.firebaseAuthUser;const diag=window.HaetsalTabletRuntimeDiagnostics&&window.HaetsalTabletRuntimeDiagnostics.getState?window.HaetsalTabletRuntimeDiagnostics.getState():null;const payload={ok:!!(window.__patch34EmulatorConnected&&user&&user.isAnonymous&&window.HaetsalRealtimeScope&&window.HaetsalRealtimeUsageDiagnostics),connected:window.__patch34EmulatorConnected===true,user:!!user,anonymous:!!(user&&user.isAnonymous),realtimeScope:!!window.HaetsalRealtimeScope,usageDiagnostics:!!window.HaetsalRealtimeUsageDiagnostics,diagState:diag,errors:(window.__patch34EmulatorErrors||[]).slice()};const m=document.createElement('meta');m.id='patch34-emulator-result';m.setAttribute('data-json',encodeURIComponent(JSON.stringify(payload)));document.head.appendChild(m)})().catch(error=>{const m=document.createElement('meta');m.id='patch34-emulator-result';m.setAttribute('data-json',encodeURIComponent(JSON.stringify({ok:false,error:String(error&&error.stack||error),errors:(window.__patch34EmulatorErrors||[]).slice()})));document.head.appendChild(m)});<\\/script>`;
const bi=html.lastIndexOf('</body>'); assert(bi>=0,'body close missing'); html=html.slice(0,bi)+runner+html.slice(bi);

const root=fs.mkdtempSync(path.join(os.tmpdir(),'haetsal-emulator-'));
fs.writeFileSync(path.join(root,'index.html'),html);try{fs.copyFileSync('logo.png',path.join(root,'logo.png'))}catch{}
const py=spawn('python3',['-m','http.server','18081','--bind','127.0.0.1','--directory',root],{stdio:'ignore'});
let served=false;for(let i=0;i<50&&!served;i++){try{const r=await fetch('http://127.0.0.1:18081/');served=r.ok}catch{}if(!served)await new Promise(r=>setTimeout(r,100))}assert(served,'local server failed');
const chromeCandidates=['google-chrome','google-chrome-stable','chromium','chromium-browser'];let chrome=null;for(const x of chromeCandidates){try{execFileSync('which',[x],{stdio:'pipe'});chrome=x;break}catch{}}assert(chrome,'Chrome missing');
let dom='';
try{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'haetsal-emu-chrome-'));
 dom=execFileSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--window-size=1024,768',`--user-data-dir=${profile}`,'--virtual-time-budget=15000','--dump-dom','http://127.0.0.1:18081/'],{encoding:'utf8',maxBuffer:30*1024*1024,timeout:40000,stdio:['ignore','pipe','pipe']});
}finally{py.kill('SIGTERM')}
const match=dom.match(/<meta id="patch34-emulator-result" data-json="([^"]*)"/i);assert(match,'emulator browser result missing');
const result=JSON.parse(decodeURIComponent(match[1].replace(/&amp;/g,'&')));
assert(result.ok,'emulator app startup failed: '+JSON.stringify(result));
assert(result.errors.length===0,'emulator browser errors: '+result.errors.join('|'));
assert(result.diagState && result.diagState.queueLength===0,'diagnostic queue should be empty by default');
const accountsResp=await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-haetsalmaru/accounts');
assert(accountsResp.ok,'auth emulator account inspection failed');
const accounts=await accountsResp.json();
assert(Array.isArray(accounts.users)&&accounts.users.some(u=>u&&u.localId),'anonymous emulator account missing');
const diagResp=await fetch('http://127.0.0.1:8080/v1/projects/demo-haetsalmaru/databases/(default)/documents/haetsalTabletRuntimeDiagnostics?pageSize=5');
assert(diagResp.ok,'firestore emulator diagnostic query failed');
const diagJson=await diagResp.json();
const diagDocs=Array.isArray(diagJson.documents)?diagJson.documents.length:0;
assert(diagDocs===0,'diagnostic docs unexpectedly written in default-off emulator startup');
console.log('PASS Firebase Emulator startup',JSON.stringify({connected:result.connected,anonymous:result.anonymous,realtimeScope:result.realtimeScope,usageDiagnostics:result.usageDiagnostics,authUsers:accounts.users.length,diagnosticDocs:diagDocs}));
console.log('PATCH34_FIREBASE_EMULATOR_PASS');
