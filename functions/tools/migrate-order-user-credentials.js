"use strict";

// Offline candidate only. Production execution requires separate explicit approval.
// Passwords and verifier material never appear in CLI output or migration audit.
// Every mode requires --project and --run-id. Emulator modes additionally require
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 and FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099.
// Apply/verify require all five expected-* values returned by the dry-run/preflight.
// verify additionally requires --emulator, or --production --verify plus approval.
// Production preflight requires --preflight --acknowledge-production-read and approval.
// Keep business writes frozen through verification: reruns reject any document
// changed after the atomic APPLIED commit. No plaintext-restoring rollback exists.
const { createHash, randomBytes, scrypt, timingSafeEqual } = require("node:crypto");
const PARAMETERS = Object.freeze({ N:32768, r:8, p:1, keyLength:32, maxmem:64 * 1024 * 1024 });
const BUILD = 202608310648;
const MAX_USERS = 10000;
const SOURCE_PATHS = ["haetsalCombinedApp/shared_people_auth", "haetsalCombinedApp/order_data", "haetsalCombinedApp/tumbler_data"];
const LEGACY_OPERATOR_FIELDS = Object.freeze(["managerPw","adminPw","managerPwUpdatedAt","adminPwUpdatedAt"]);
const LEGACY_OPERATOR_SOURCE_FIELDS = ["auth","sysSettings","settings"];
const VERIFIERS = "haetsalUserCredentialVerifiers";
const AUDITS = "haetsalCredentialMigrationRuns";
const AUDIT_FIELDS = ["runId","migrationType","status","sourceSharedUpdateTime","sourceOrderUpdateTime",
  "sourceTumblerUpdateTime","legacyOperatorCredentialSchemaVersion","legacyOperatorFieldRemovalCount",
  "sourceFingerprint","protectedUserCount","unprotectedUserCount","sharedUserCount","orderUserCount",
  "verifierWriteCount","credentialSchemaVersion","appBuildNumber","writeSchemaVersion","createdAt","completedAt"];

class CutoverError extends Error {
  constructor(reason, count = 1) {
    super(reason);
    this.reason = reason;
    this.count = count;
  }
}
function fail(reason, count) { throw new CutoverError(reason, count); }
function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
function plain(value) {
  return value !== null && typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function validId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    !value.includes("/") && value !== "." && value !== ".." && !/^__.*__$/.test(value);
}
function parseArguments(argv, env) {
  const mode = argv[0];
  if(!["emulator-dry-run","emulator-apply","production-preflight","production-apply","verify"].includes(mode)) fail("INVALID_MODE");
  const flags = new Set(["apply","emulator","production","preflight","acknowledge-production-read","verify"]);
  const values = new Set(["project","run-id","expected-shared-update-time","expected-order-update-time",
    "expected-tumbler-update-time","expected-source-fingerprint","expected-protected-count"]);
  const args = { mode };
  for(let i=1;i<argv.length;i++){
    const key = argv[i].startsWith("--") ? argv[i].slice(2) : "";
    if(own(args,key) || (!flags.has(key) && !values.has(key))) fail("INVALID_ARGUMENTS");
    if(flags.has(key)) args[key] = true;
    else {
      const value = argv[++i];
      if(typeof value !== "string" || !value || value.startsWith("--")) fail("MISSING_ARGUMENT");
      args[key] = value;
    }
  }
  if(!validId(args["run-id"]) || !args.project) fail("MISSING_PROJECT_OR_RUN_ID");
  const emulator = mode.startsWith("emulator-") || (mode === "verify" && args.emulator === true);
  const production = mode.startsWith("production-") || (mode === "verify" && args.production === true);
  if(emulator === production) fail("AMBIGUOUS_ENVIRONMENT");
  if(emulator){
    if(args.project !== "demo-haetsalmaru" || args.production || args.preflight || args["acknowledge-production-read"]) fail("EMULATOR_PROJECT_GUARD");
    if(env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" || env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") fail("EMULATOR_HOST_GUARD");
    for(const key of ["GCLOUD_PROJECT","GOOGLE_CLOUD_PROJECT"]){
      if(env[key] && env[key] !== args.project) fail("EMULATOR_PROJECT_ENV_GUARD");
    }
    if(env.FIREBASE_CONFIG){
      let config;
      try { config = JSON.parse(env.FIREBASE_CONFIG); } catch { fail("EMULATOR_CONFIG_GUARD"); }
      if(config.projectId !== args.project) fail("EMULATOR_CONFIG_GUARD");
    }
  }else{
    // These checks run before importing firebase-admin or creating any SDK client.
    if(args.project !== "haetsal-maru-24b95" || args.emulator) fail("PRODUCTION_PROJECT_GUARD");
    if(Object.keys(env).some(key => /EMULATOR/i.test(key) && env[key])) fail("PRODUCTION_EMULATOR_ENV_GUARD");
    if(Object.entries(env).some(([key,value]) => /HOST|ENDPOINT/i.test(key) && /localhost|127\.0\.0\.1|\[?::1\]?/i.test(value || ""))) fail("PRODUCTION_LOCAL_HOST_GUARD");
    if(env.HAETSAL_PASSWORD_CUTOVER_APPROVED !== "YES") fail("PRODUCTION_APPROVAL_GUARD");
    for(const key of ["GCLOUD_PROJECT","GOOGLE_CLOUD_PROJECT"]){
      if(env[key] && env[key] !== args.project) fail("PRODUCTION_PROJECT_ENV_GUARD");
    }
    if(env.FIREBASE_CONFIG){
      let config;
      try { config = JSON.parse(env.FIREBASE_CONFIG); } catch { fail("PRODUCTION_CONFIG_GUARD"); }
      if(config.projectId !== args.project) fail("PRODUCTION_CONFIG_GUARD");
    }
    if(mode === "production-preflight" && (!args.preflight || !args["acknowledge-production-read"] || args.apply)) fail("PRODUCTION_PREFLIGHT_GUARD");
    if(mode === "verify" && !args.verify) fail("PRODUCTION_VERIFY_GUARD");
  }
  const applying = mode.endsWith("-apply");
  if(applying && !args.apply) fail("APPLY_GUARD");
  if(!applying && args.apply) fail("UNEXPECTED_APPLY");
  if(applying || mode === "verify"){
    if(!/^[a-f0-9]{64}$/.test(args["expected-source-fingerprint"] || "")) fail("FINGERPRINT_GUARD");
    if(!/^\d+:\d{9}$/.test(args["expected-shared-update-time"] || "") ||
       !/^\d+:\d{9}$/.test(args["expected-order-update-time"] || "") ||
       !/^\d+:\d{9}$/.test(args["expected-tumbler-update-time"] || "")) fail("UPDATE_TIME_GUARD");
    if(!/^(0|[1-9]\d*)$/.test(args["expected-protected-count"] || "")) fail("PROTECTED_COUNT_GUARD");
    args.expectedCount = Number(args["expected-protected-count"]);
    if(!Number.isSafeInteger(args.expectedCount) || args.expectedCount + 4 >= 450) fail("WRITE_LIMIT");
  }
  args.isEmulator = emulator;
  args.applying = applying;
  return args;
}
function canonical(value) {
  if(value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if(typeof value === "number"){
    if(Number.isNaN(value)) return '{"$number":"NaN"}';
    if(!Number.isFinite(value)) return JSON.stringify({$number:String(value)});
    return Object.is(value,-0) ? '{"$number":"-0"}' : JSON.stringify(value);
  }
  if(value instanceof Date) return JSON.stringify({$date:value.toISOString()});
  if(value instanceof Uint8Array) return JSON.stringify({$bytes:Buffer.from(value).toString("base64")});
  if(Array.isArray(value)) return "list:["+value.map(canonical).join(",")+"]";
  if(!plain(value) && value && value.constructor && value.constructor.name === "Timestamp" &&
      Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds)){
    return JSON.stringify({$timestamp:[value.seconds,value.nanoseconds]});
  }
  if(!plain(value) && value && value.constructor && value.constructor.name === "GeoPoint"){
    return JSON.stringify({$geopoint:[value.latitude,value.longitude]});
  }
  // References and unexpected types must be explicitly reviewed before cutover.
  if(!plain(value)) fail("UNSUPPORTED_SOURCE_TYPE");
  return "map:{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+canonical(value[key])).join(",")+"}";
}
function fingerprint(documents) { return createHash("sha256").update(canonical(documents)).digest("hex"); }
function updateTime(snapshot) {
  const time = snapshot.updateTime;
  if(!time) fail("MISSING_UPDATE_TIME");
  return String(time.seconds)+":"+String(time.nanoseconds).padStart(9,"0");
}
function checkSize(data) {
  // Conservative headroom for Firestore field-name and document encoding overhead.
  const size = Buffer.byteLength(canonical(data),"utf8");
  if(size > 900 * 1024) fail("DOCUMENT_SIZE_LIMIT");
  return size;
}
function validateUsers(doc) {
  if(!plain(doc) || !plain(doc.data) || !Array.isArray(doc.data.users)) fail("SOURCE_USERS_MISSING");
  if(doc.data.users.length > MAX_USERS) fail("USER_COUNT_LIMIT");
  checkSize(doc);
  const ids = new Map();
  let duplicates=0, invalid=0;
  for(const user of doc.data.users){
    if(!plain(user) || !validId(user.id) || (own(user,"password") && typeof user.password !== "string") ||
        (own(user,"passwordProtected") && typeof user.passwordProtected !== "boolean")) { invalid++; continue; }
    if(ids.has(user.id)) duplicates++;
    ids.set(user.id,user);
  }
  if(invalid) fail("INVALID_PROFILE",invalid);
  if(duplicates) fail("DUPLICATE_USER_ID",duplicates);
  return ids;
}
function sanitizedProfile(source, protectedValue) {
  const result = { ...source };
  delete result.password;
  result.passwordProtected = protectedValue;
  return result;
}

function sanitizeLegacyOperatorMap(source) {
  const result={};
  for(const key of Object.keys(source)){
    if(!LEGACY_OPERATOR_FIELDS.includes(key)){
      Object.defineProperty(result,key,{value:source[key],enumerable:true,writable:true,configurable:true});
    }
  }
  return result;
}
function inspectLegacyOperatorSources(docs) {
  if(docs.length!==3) fail("SOURCE_DOCUMENT_MISSING");
  const counts=[0,0,0];
  let unexpected=0;
  docs.forEach((doc,index)=>{
    if(!plain(doc) || !plain(doc.data)) fail("SOURCE_DATA_MAP_MISSING");
    const target=LEGACY_OPERATOR_SOURCE_FIELDS[index];
    if(own(doc.data,target) && !plain(doc.data[target])) fail("INVALID_LEGACY_OPERATOR_MAP");
    checkSize(doc);
    function scan(value,parts) {
      if(Array.isArray(value)){value.forEach((item,i)=>scan(item,[...parts,String(i)]));return;}
      if(!plain(value)) return;
      for(const key of Object.keys(value)){
        if(LEGACY_OPERATOR_FIELDS.includes(key)){
          if(parts.length===2 && parts[0]==="data" && parts[1]===target) counts[index]++;
          else unexpected++;
        }
        scan(value[key],[...parts,key]);
      }
    }
    scan(doc,[]);
  });
  if(unexpected) fail("UNEXPECTED_LEGACY_OPERATOR_FIELD_LOCATION",unexpected);
  return {legacyOperatorFieldCounts:{sharedAuth:counts[0],orderSettings:counts[1],tumblerSettings:counts[2]},
    legacyOperatorFieldRemovalCount:counts.reduce((a,b)=>a+b,0)};
}

function inspectSources(snapshots) {
  if(snapshots.length !== 3 || snapshots.some(snapshot=>!snapshot.exists)) fail("SOURCE_DOCUMENT_MISSING");
  const docs=snapshots.map(snapshot=>snapshot.data());
  const legacy=inspectLegacyOperatorSources(docs);
  const shared=validateUsers(docs[0]),order=validateUsers(docs[1]);
  let mismatches=0;
  for(const [id,user] of order){
    if(own(user,"password") && user.password !== "" &&
       (!shared.has(id) || shared.get(id).password !== user.password)) mismatches++;
  }
  if(mismatches) fail("SOURCE_PASSWORD_MISMATCH",mismatches);
  const protectedUsers=[...shared.values()].filter(user=>own(user,"password") && user.password !== "");
  // protected + three source documents + audit must stay below 450: maximum 445.
  if(protectedUsers.length + 4 >= 450) fail("WRITE_LIMIT");
  const protectedIds=new Set(protectedUsers.map(user=>user.id));
  const sanitized=docs.map((doc,index)=>{
    const data={...doc.data};
    if(index < 2){
      data.users=[...(index === 0 ? shared : order).values()].map(user=>sanitizedProfile(user,protectedIds.has(user.id)));
      data.orderUserCredentialSchemaVersion=1;
    }
    const field=LEGACY_OPERATOR_SOURCE_FIELDS[index];
    if(own(data,field)) data[field]=sanitizeLegacyOperatorMap(data[field]);
    return {...doc,data};
  });
  const sizes=sanitized.map(checkSize);
  if(sizes.reduce((a,b)=>a+b,0) + protectedUsers.length * 2048 > 8 * 1024 * 1024) fail("TRANSACTION_SIZE_LIMIT");
  return {
    docs,sanitized,protectedUsers,...legacy,
    sharedUserCount:shared.size,orderUserCount:order.size,
    protectedUserCount:protectedUsers.length,unprotectedUserCount:shared.size-protectedUsers.length,
    sourceSharedUpdateTime:updateTime(snapshots[0]),sourceOrderUpdateTime:updateTime(snapshots[1]),
    sourceTumblerUpdateTime:updateTime(snapshots[2]),sourceFingerprint:fingerprint(docs)
  };
}
function matchExpected(info,args) {
  if(info.sourceSharedUpdateTime !== args["expected-shared-update-time"] ||
     info.sourceOrderUpdateTime !== args["expected-order-update-time"] ||
     info.sourceTumblerUpdateTime !== args["expected-tumbler-update-time"]) fail("SOURCE_UPDATE_TIME_CHANGED");
  if(info.sourceFingerprint !== args["expected-source-fingerprint"]) fail("SOURCE_FINGERPRINT_CHANGED");
  if(info.protectedUserCount !== args.expectedCount) fail("PROTECTED_COUNT_CHANGED");
}
function summary(info,status,writeCount=0) {
  return {status,sourceSharedUpdateTime:info.sourceSharedUpdateTime,sourceOrderUpdateTime:info.sourceOrderUpdateTime,
    sourceTumblerUpdateTime:info.sourceTumblerUpdateTime,sourceFingerprint:info.sourceFingerprint,
    legacyOperatorCredentialSchemaVersion:1,legacyOperatorFieldRemovalCount:info.legacyOperatorFieldRemovalCount,
    legacyOperatorFieldCounts:info.legacyOperatorFieldCounts,unexpectedLegacyOperatorFieldCount:0,
    protectedUserCount:info.protectedUserCount,unprotectedUserCount:info.unprotectedUserCount,sharedUserCount:info.sharedUserCount,
    orderUserCount:info.orderUserCount,expectedWriteCount:info.protectedUserCount+4,writeCount};
}
function fixedBase64(value,size) {
  if(typeof value !== "string" || value.length !== 4 * Math.ceil(size/3)) return false;
  const bytes=Buffer.from(value,"base64");
  return bytes.length === size && bytes.toString("base64") === value;
}
function validVerifier(data,id) {
  return plain(data) && data.userId===id && data.algorithm==="scrypt-v1" && data.verifierVersion===1 &&
    data.schemaVersion===1 && data.disabled===false && plain(data.parameters) &&
    Object.keys(data.parameters).length===Object.keys(PARAMETERS).length &&
    Object.keys(PARAMETERS).every(key=>data.parameters[key]===PARAMETERS[key]) &&
    fixedBase64(data.salt,16) && fixedBase64(data.passwordVerifier,32) &&
    Object.keys(data).sort().join(",") === ["userId","algorithm","verifierVersion","schemaVersion","disabled","parameters","salt","passwordVerifier"].sort().join(",");
}
async function prepareVerifiers(users) {
  const verifiers=new Map();
  for(const user of users){
    const salt=randomBytes(16);
    const derived=await new Promise((resolve,reject)=>scrypt(user.password,salt,32,PARAMETERS,(error,key)=>error?reject(error):resolve(key)));
    verifiers.set(user.id,{userId:user.id,algorithm:"scrypt-v1",parameters:{...PARAMETERS},
      salt:salt.toString("base64"),passwordVerifier:derived.toString("base64"),
      verifierVersion:1,schemaVersion:1,disabled:false});
    derived.fill(0);
  }
  return verifiers;
}
function validateAudit(snapshot,args) {
  const audit=snapshot.data();
  if(!snapshot.exists || !plain(audit) || Object.keys(audit).sort().join(",")!==AUDIT_FIELDS.slice().sort().join(",") ||
     audit.runId!==args["run-id"] || audit.status!=="APPLIED" || audit.migrationType!=="ORDER_USER_AND_LEGACY_OPERATOR_CREDENTIAL_CUTOVER" ||
     audit.credentialSchemaVersion!==1 || audit.appBuildNumber!==BUILD || audit.writeSchemaVersion!==6 ||
     audit.legacyOperatorCredentialSchemaVersion!==1 || !Number.isInteger(audit.legacyOperatorFieldRemovalCount) ||
     audit.legacyOperatorFieldRemovalCount<0 || audit.legacyOperatorFieldRemovalCount>12) fail("INVALID_APPLIED_AUDIT");
  if(audit.sourceFingerprint!==args["expected-source-fingerprint"] ||
     audit.sourceSharedUpdateTime!==args["expected-shared-update-time"] ||
     audit.sourceOrderUpdateTime!==args["expected-order-update-time"] ||
     audit.sourceTumblerUpdateTime!==args["expected-tumbler-update-time"] ||
     audit.protectedUserCount!==args.expectedCount) fail("RUN_ID_SOURCE_CONFLICT");
  return audit;
}
async function verifyApplied(db,args,prepared) {
  const sources=SOURCE_PATHS.map(p=>db.doc(p)),auditRef=db.collection(AUDITS).doc(args["run-id"]);
  return db.runTransaction(async transaction=>{
    const [sharedSnap,orderSnap,tumblerSnap,auditSnap]=await transaction.getAll(...sources,auditRef);
    const audit=validateAudit(auditSnap,args);
    const rows=await transaction.get(db.collection(VERIFIERS).limit(MAX_USERS+1));
    const sourceSnaps=[sharedSnap,orderSnap,tumblerSnap];
    if(sourceSnaps.some(s=>!s.exists)) fail("SOURCE_DOCUMENT_MISSING");
    const docs=sourceSnaps.map(s=>s.data());
    const legacy=inspectLegacyOperatorSources(docs);
    if(legacy.legacyOperatorFieldRemovalCount!==0) fail("APPLIED_LEGACY_OPERATOR_CREDENTIAL");
    const maps=docs.slice(0,2).map(validateUsers);
    const commitTime=updateTime(auditSnap);
    // A byte-identical source set can keep its original updateTime (notably tumbler).
    // Accept only the atomic commit time or that exact guarded original version.
    const originalTimes=[audit.sourceSharedUpdateTime,audit.sourceOrderUpdateTime,audit.sourceTumblerUpdateTime];
    if(sourceSnaps.some((s,i)=>updateTime(s)!==commitTime && updateTime(s)!==originalTimes[i]) ||
       rows.docs.some(s=>updateTime(s)!==commitTime)) fail("APPLIED_STATE_CHANGED");
    if(maps[0].size!==audit.sharedUserCount || maps[1].size!==audit.orderUserCount ||
       docs.slice(0,2).some(doc=>doc.data.orderUserCredentialSchemaVersion!==1)) fail("APPLIED_PROFILE_COUNT_OR_SCHEMA");
    const protectedIds=new Set();
    for(const user of maps[0].values()){
      if(own(user,"password") || typeof user.passwordProtected!=="boolean") fail("APPLIED_PROFILE_CREDENTIAL");
      if(user.passwordProtected) protectedIds.add(user.id);
    }
    for(const user of maps[1].values()){
      if(own(user,"password") || typeof user.passwordProtected!=="boolean" ||
         user.passwordProtected!==protectedIds.has(user.id)) fail("APPLIED_ORDER_CREDENTIAL");
    }
    if(protectedIds.size!==audit.protectedUserCount || rows.size!==protectedIds.size ||
       audit.verifierWriteCount!==protectedIds.size || audit.unprotectedUserCount!==maps[0].size-protectedIds.size) fail("APPLIED_VERIFIER_COUNT");
    for(const row of rows.docs){
      if(!protectedIds.has(row.id) || !validVerifier(row.data(),row.id)) fail("APPLIED_VERIFIER_INVALID");
      if(prepared){
        const expected=prepared.verifiers.get(row.id);
        const actual=row.data();
        if(!expected || !timingSafeEqual(Buffer.from(actual.passwordVerifier,"base64"),Buffer.from(expected.passwordVerifier,"base64")) ||
          actual.salt!==expected.salt) fail("APPLIED_VERIFIER_MISMATCH");
      }
    }
    if(prepared && fingerprint(docs)!==fingerprint(prepared.sanitized)) fail("APPLIED_SOURCE_MISMATCH");
    return summary(audit,prepared?"APPLIED_VERIFIED":"APPLIED_VERIFIED_NO_OP",prepared?protectedIds.size+4:0);
  });
}
async function execute(args) {
  // No SDK is imported until parseArguments has validated every environment/approval guard.
  const { initializeApp,deleteApp }=require("firebase-admin/app");
  const { getFirestore,FieldValue }=require("firebase-admin/firestore");
  const app=initializeApp({projectId:args.project},"order-credential-cutover");
  const db=getFirestore(app);
  try{
    if(args.mode==="verify") return await verifyApplied(db,args);
    const sourceRefs=SOURCE_PATHS.map(p=>db.doc(p)),auditRef=db.collection(AUDITS).doc(args["run-id"]);
    if(args.applying){
      const prior=await auditRef.get();
      if(prior.exists){
        validateAudit(prior,args);
        return await verifyApplied(db,args);
      }
    }
    const snapshots=await db.getAll(...sourceRefs);
    const info=inspectSources(snapshots);
    if(args.applying) matchExpected(info,args);
    const existing=await db.collection(VERIFIERS).limit(1).get();
    if(!existing.empty) fail("EXISTING_VERIFIER_STATE");
    if(!args.applying) return summary(info,"PREFLIGHT_OK",0);
    const verifiers=await prepareVerifiers(info.protectedUsers);
    await db.runTransaction(async transaction=>{
      const current=await transaction.getAll(...sourceRefs,auditRef);
      if(current[3].exists) fail("RUN_ID_ALREADY_EXISTS");
      const fresh=inspectSources(current.slice(0,3));
      matchExpected(fresh,args);
      if(fresh.sourceFingerprint!==info.sourceFingerprint) fail("SOURCE_CHANGED_DURING_PREPARATION");
      const prior=await transaction.get(db.collection(VERIFIERS).limit(1));
      if(!prior.empty) fail("EXISTING_VERIFIER_STATE");
      for(const [id,value] of verifiers) transaction.create(db.collection(VERIFIERS).doc(id),value);
      transaction.set(sourceRefs[0],info.sanitized[0]);
      transaction.set(sourceRefs[1],info.sanitized[1]);
      transaction.set(sourceRefs[2],info.sanitized[2]);
      transaction.create(auditRef,{
        runId:args["run-id"],migrationType:"ORDER_USER_AND_LEGACY_OPERATOR_CREDENTIAL_CUTOVER",status:"APPLIED",
        sourceSharedUpdateTime:info.sourceSharedUpdateTime,sourceOrderUpdateTime:info.sourceOrderUpdateTime,
        sourceTumblerUpdateTime:info.sourceTumblerUpdateTime,legacyOperatorCredentialSchemaVersion:1,
        legacyOperatorFieldRemovalCount:info.legacyOperatorFieldRemovalCount,
        sourceFingerprint:info.sourceFingerprint,protectedUserCount:info.protectedUserCount,
        unprotectedUserCount:info.unprotectedUserCount,sharedUserCount:info.sharedUserCount,orderUserCount:info.orderUserCount,
        verifierWriteCount:verifiers.size,credentialSchemaVersion:1,appBuildNumber:BUILD,writeSchemaVersion:6,
        createdAt:FieldValue.serverTimestamp(),completedAt:FieldValue.serverTimestamp()
      });
    });
    return await verifyApplied(db,args,{sanitized:info.sanitized,verifiers});
  }finally{
    await db.terminate().catch(()=>{});
    await deleteApp(app).catch(()=>{});
  }
}
async function main(argv=process.argv.slice(2),env=process.env) {
  try{
    const args=parseArguments(argv,env);
    const result=await execute(args);
    process.stdout.write(JSON.stringify(result)+"\n");
    return 0;
  }catch(error){
    const reason=error instanceof CutoverError ? error.reason : "SDK_OR_TRANSACTION_FAILURE";
    const count=error instanceof CutoverError ? error.count : 1;
    process.stdout.write(JSON.stringify({status:"FAILED",reason,count})+"\n");
    return 1;
  }
}
// Test runners can inspect pure validation functions without creating an SDK client.
// execute is intentionally private; production paths must go through CLI guards.
module.exports={parseArguments,canonical,inspectSources,inspectLegacyOperatorSources,validVerifier,PARAMETERS};
if(require.main===module) main().then(code=>{process.exitCode=code;},()=>{process.exitCode=1;});
