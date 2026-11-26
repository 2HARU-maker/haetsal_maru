'use strict';
// Standard Node only. Install under .github/scripts; ../../index.html remains the default.
// Actual product date/writer/reader/bridge bodies run in VM fixtures. No SDK RPC/UI/Rules runtime.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const repo=path.resolve(__dirname,'../..'),sourceFile=path.resolve(process.argv[2]||path.join(repo,'index.html'));
const bytes=fs.readFileSync(sourceFile),source=bytes.toString('utf8').replace(/\r\n/g,'\n');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),sourceSHA256=sha(bytes);
if(process.argv[3])assert.equal(sourceSHA256,process.argv[3],'Pinned product source changed');
class Timestamp {
 constructor(seconds,nanoseconds=0){this._seconds=seconds;this._nanoseconds=nanoseconds;}
 static fromDate(date){const ms=date.getTime(),seconds=Math.floor(ms/1000);return new Timestamp(seconds,Math.round((ms-seconds*1000)*1e6));}
 get seconds(){return this._seconds;} get nanoseconds(){return this._nanoseconds;}
 toDate(){return new Date(this._seconds*1000+this._nanoseconds/1e6);}
 toJSON(){return {_seconds:this._seconds,_nanoseconds:this._nanoseconds};}
}

const webSDKStringContract={
  "cachedAssetSHA256": "fa89fbc7070a4fabc473a292b840a8ae37e731b38b60b46128a354d121ce3e9f",
  "actualToStringMethodSHA256": "d8dbf871d96f475fbdb69e905e2f6e5438316d67ef6781d4af80b6cb8b0f8d16",
  "method": "toString(){return\"Timestamp(seconds=\"+this.seconds+\", nanoseconds=\"+this.nanoseconds+\")\"}",
  "fixtureScope": "Actual cached Web SDK toString method; protocol Timestamp container. No Web SDK client created."
};
const webTimestampToString=vm.runInNewContext("({"+webSDKStringContract.method+"}).toString");
function makeWebTimestamp(seconds,nanoseconds){return {seconds,nanoseconds,toDate(){return new Date(seconds*1000+nanoseconds/1e6);},toString:webTimestampToString};}
const clock=Date.parse('2026-11-26T02:03:04.000Z');
function FrozenDate(...args){if(!new.target)return new Date(clock).toString();return Reflect.construct(Date,args.length?args:[clock]);}
FrozenDate.prototype=Date.prototype;Object.setPrototypeOf(FrozenDate,Date);FrozenDate.now=()=>clock;
function skipString(s,i,quote){for(i++;i<s.length;i++){if(s[i]==='\\'){i++;continue;}if(s[i]===quote)return i+1;}throw Error('Unclosed string');}
function skipTemplate(s,i){for(i++;i<s.length;i++){if(s[i]==='\\'){i++;continue;}if(s[i]==='`')return i+1;if(s[i]==='$'&&s[i+1]==='{')i=balanced(s,i+1)-1;}throw Error('Unclosed template');}
function balanced(s,start){const open=s[start],close={'{':'}','(':')','[':']'}[open];assert(close);for(let i=start+1;i<s.length;i++){const ch=s[i];if(ch==='"'||ch==="'"){i=skipString(s,i,ch)-1;continue;}if(ch==='`'){i=skipTemplate(s,i)-1;continue;}if(ch==='/'&&s[i+1]==='/'){i=s.indexOf('\n',i+2);if(i<0)throw Error('comment');continue;}if(ch==='/'&&s[i+1]==='*'){i=s.indexOf('*/',i+2)+1;continue;}if(ch==='/'&&(/[([=:,!&|?{};+*%~<>-]/.test(s[i-1])||/(?:return|throw)\s*$/.test(s.slice(Math.max(start,i-20),i)))){let inClass=false;for(i++;i<s.length;i++){if(s[i]==='\\'){i++;continue;}if(s[i]==='[')inClass=true;if(s[i]===']')inClass=false;if(s[i]==='/'&&!inClass)break;}continue;}if(ch===open){i=balanced(s,i)-1;continue;}if(ch===close)return i+1;}throw Error('Unclosed '+open);}

function extract(s,name){const re=new RegExp('(?:^|\\n)([ \\t]*)(?:async )?function '+name+'\\s*\\('),m=re.exec(s);assert(m,'Missing actual function '+name);const start=m.index+(s[m.index]==='\n'?1:0),body=s.indexOf('{',start),end=balanced(s,body);const text=s.slice(start,end);new vm.Script(text);return text;}
function declaration(name){const start=source.indexOf('const '+name+' =');assert(start>=0,'Missing actual constant '+name);return source.slice(start,source.indexOf(';',start)+1);}

const baselineReference={
  "commit": "2efe96c0be5208f4a9a273a493f1ff725d22cb76",
  "sourceSHA256": "98ce33779aba5e8d28432adf01efc47745e75d53c6fe9d26b7d45f243effd1ad",
  "lineEnding": "Function bodies extracted from LF-normalized baseline"
};
const baselineBodies={
  "normalizeEmergencyCompactOrderRecord": "    function normalizeEmergencyCompactOrderRecord(raw){\n      const source = raw && typeof raw === 'object' ? raw : {};\n      const id = trimCompactOrderText(source.id || source.orderId || '', 120);\n      if(!id) return null;\n      const deliveryType = decodeCompactDeliveryType(source.d || source.deliveryType);\n      const status = decodeCompactOrderStatus(source.s || source.status, deliveryType);\n      const processedAt = trimCompactOrderText(source.p || source.processedAt || source.completedAt || source.statusUpdatedAt || source.timestamp || '', 40);\n      const timestamp = trimCompactOrderText(source.t || source.timestamp || source.createdAt || processedAt || '', 40);\n      const totalQty = Math.max(0, Math.floor(Number(source.q || source.totalCups || source.quantity || 0)) || 0);\n      const rawCupSummary = Array.isArray(source.c) ? source.c : (Array.isArray(source.cupSummary) ? source.cupSummary : []);\n      const cupSummary = rawCupSummary.map(item => {\n        if(Array.isArray(item)){\n          const code = encodeCompactCupType(decodeCompactCupType(item[0]));\n          const qty = Math.max(0, Math.floor(Number(item[1] || 0)) || 0);\n          return qty ? [code, qty] : null;\n        }\n        if(item && typeof item === 'object'){\n          const code = encodeCompactCupType(item.cupType || item.type || item.code);\n          const qty = Math.max(0, Math.floor(Number(item.quantity || item.qty || item.count || 0)) || 0);\n          return qty ? [code, qty] : null;\n        }\n        return null;\n      }).filter(Boolean);\n      const rawItems = Array.isArray(source.i) ? source.i : (Array.isArray(source.items) ? source.items : []);\n      const items = rawItems.map(item => {\n        if(Array.isArray(item)){\n          const tempCode = String(item[0] || 'I').toUpperCase();\n          return [\n            tempCode === 'H' ? 'H' : 'I',\n            trimCompactOrderText(item[1] || '', 80),\n            encodeCompactCupType(decodeCompactCupType(item[2])),\n            Math.max(1, Math.floor(Number(item[3] || 1)) || 1),\n            item[4] ? 1 : 0,\n            normalizeShotCount(item[5], item[6]),\n            normalizeShotCount(item[6], 0)\n          ];\n        }\n        const cupType = encodeCompactCupType(item && item.cupType);\n        return [\n          String((item && item.temp) || 'ICE').toUpperCase() === 'HOT' ? 'H' : 'I',\n          trimCompactOrderText(item && item.menuName || '', 80),\n          cupType,\n          Math.max(1, Math.floor(Number(item && item.quantity || 1)) || 1),\n          item && item.whippedCreamAdded === true ? 1 : 0,\n          normalizeShotCount(item && item.shotCount, item && item.defaultShotCount),\n          normalizeShotCount(item && item.defaultShotCount, 0)\n        ];\n      }).filter(item => item && item[1]);\n      return {\n        v: 1,\n        id,\n        n: trimCompactOrderText(source.n || source.orderNumber || '', 40),\n        sq: trimCompactOrderText(source.sq || source.seq || source.orderNumber || '', 40),\n        u: trimCompactOrderText(source.u || source.userId || '', 120),\n        un: trimCompactOrderText(source.un || source.userName || source.userNameDisplay || '', 80),\n        ud: trimCompactOrderText(source.ud || source.userDept || source.dept || '', 80),\n        t: timestamp,\n        p: processedAt || timestamp,\n        s: encodeCompactOrderStatus(status),\n        d: encodeCompactDeliveryType(deliveryType),\n        q: totalQty,\n        r: Number.isFinite(Number(source.r != null ? source.r : source.remainingCoupons)) ? Number(source.r != null ? source.r : source.remainingCoupons) : null,\n        c: cupSummary,\n        i: items\n      };\n    }",
  "createEmergencyCompactOrderRecord": "    function createEmergencyCompactOrderRecord(order){\n      if(!order || typeof order !== 'object' || !String(order.id || '').trim()) return null;\n      const cupCountMap = new Map();\n      getOrderItemsForDisplay(order).forEach(item => {\n        const code = encodeCompactCupType(item && item.cupType);\n        const qty = Math.max(1, Math.floor(Number(item && item.quantity || 1)) || 1);\n        cupCountMap.set(code, Number(cupCountMap.get(code) || 0) + qty);\n      });\n      const cupSummary = Array.from(cupCountMap.entries()).map(([code, qty]) => [code, qty]).filter(item => Number(item[1] || 0) > 0);\n      return normalizeEmergencyCompactOrderRecord({\n        id: order.id,\n        orderNumber: order.orderNumber || '',\n        seq: order.seq || order.orderNumber || '',\n        userId: order.userId || '',\n        userName: order.userNameDisplay || order.userName || '',\n        userDept: order.userDept || order.dept || '',\n        timestamp: order.timestamp || order.createdAt || '',\n        processedAt: getEmergencyOrderCleanupTimestamp(order),\n        status: getNormalizedOrderStatus(order),\n        deliveryType: order.deliveryType || 'PICKUP',\n        quantity: getOrderTotalQuantity(order),\n        remainingCoupons: order.remainingCoupons,\n        cupSummary,\n        items: []\n      });\n    }",
  "createCompletedOrderDocumentPayload": "    function createCompletedOrderDocumentPayload(order, reason='auto'){\n      if(!order || typeof order !== 'object' || !String(order.id || '').trim()) return null;\n      const status = getNormalizedOrderStatus(order);\n      if(!isOrderClosedStatus(order)) return null;\n      const completedAt = order.statusUpdatedAt || order.processedAt || order.completedAt || order.cancelledAt || order.timestamp || new Date().toISOString();\n      const createdAt = order.createdAt || order.timestamp || '';\n      const businessAt = order.businessAt || createdAt || completedAt || '';\n      const businessDate = getOrderBusinessDateKey(order) || (businessAt ? getDateString(businessAt) : '');\n      const sourceItems = Array.isArray(order.items) ? order.items : [];\n      const items = getOrderItemsForDisplay(order).map((item, index) => compactCompletedOrderItemForStorage(item, sourceItems[index]));\n      const totalCups = getOrderTotalQuantity(order);\n      const orderLite = copyStoredCouponCostSnapshotFields({\n        id: String(order.id || ''),\n        orderNumber: String(order.orderNumber || order.seq || ''),\n        seq: order.seq || '',\n        status,\n        createdAt: String(createdAt || ''),\n        createdAtServerIso: String(order.createdAtServerIso || ''),\n        businessAtServerIso: String(order.businessAtServerIso || order.createdAtServerIso || ''),\n        timestamp: String(order.timestamp || createdAt || ''),\n        businessAt: String(businessAt || ''),\n        businessDate: String(businessDate || ''),\n        completedAt: String(completedAt || ''),\n        completedAtServerIso: String(order.completedAtServerIso || order.processedAtServerIso || ''),\n        statusUpdatedAt: String(order.statusUpdatedAt || completedAt || ''),\n        statusUpdatedAtServerIso: String(order.statusUpdatedAtServerIso || order.processedAtServerIso || order.cancelledAtServerIso || ''),\n        updatedAtServerIso: String(order.updatedAtServerIso || order.statusUpdatedAtServerIso || ''),\n        processedAt: String(order.processedAt || ''),\n        processedAtServerIso: String(order.processedAtServerIso || ''),\n        processedBy: String(order.processedBy || ''),\n        cancelledAt: String(order.cancelledAt || ''),\n        cancelledAtServerIso: String(order.cancelledAtServerIso || ''),\n        cancelledBy: String(order.cancelledBy || order.processedBy || ''),\n        cancelledClientSessionId: String(order.cancelledClientSessionId || ''),\n        cancelReason: trimCompletedOrderText(order.cancelReason || '', 500),\n        refundQuantity: Number(order.refundQuantity || 0),\n        refundBeforeCoupons: order.refundBeforeCoupons == null || order.refundBeforeCoupons === '' ? null : (Number.isFinite(Number(order.refundBeforeCoupons)) ? Number(order.refundBeforeCoupons) : null),\n        refundAfterCoupons: order.refundAfterCoupons == null || order.refundAfterCoupons === '' ? null : (Number.isFinite(Number(order.refundAfterCoupons)) ? Number(order.refundAfterCoupons) : null),\n        refundHistoryId: String(order.refundHistoryId || ''),\n        refundHistoryType: String(order.refundHistoryType || ''),\n        refundHistorySource: String(order.refundHistorySource || ''),\n        productionCycle: normalizeOrderProductionCycle(order.productionCycle),\n        statusRevision: normalizeOrderStatusRevision(order.statusRevision),\n        completionCommitted: order.completionCommitted === true,\n        completionEventId: String(order.completionEventId || ''),\n        userId: String(order.userId || ''),\n        userName: trimCompletedOrderText(order.userName || order.userNameDisplay || order.userNameReal || '', 80),\n        userDept: trimCompletedOrderText(order.userDept || order.department || order.dept || '', 80),\n        deliveryType: String(order.deliveryType || 'PICKUP'),\n        deliveryLocation: trimCompletedOrderText(order.deliveryLocation || order.deliveryPlace || '', 160),\n        quantity: Number(totalCups || order.quantity || 0),\n        totalCups: Number(totalCups || order.quantity || 0),\n        cupType: String(order.cupType || ''),\n        tumblerInfo: trimCompletedOrderText(order.tumblerInfo || '', 200),\n        memo: trimCompletedOrderText(order.memo || order.requestMemo || '', 500),\n        remainingCoupons: Number(order.remainingCoupons || 0),\n        isGroupOrder: order.isGroupOrder === true,\n        items\n      }, order, ['couponPolicyVersion', 'couponCostTotal']);\n      return {\n        version: 2,\n        appVersion: ORDER_APP_VERSION,\n        storageMode: 'completed-order-light-doc',\n        reason: String(reason || 'auto'),\n        orderId: orderLite.id,\n        orderNumber: orderLite.orderNumber,\n        status,\n        productionCycle: orderLite.productionCycle,\n        statusRevision: orderLite.statusRevision,\n        completionCommitted: orderLite.completionCommitted,\n        completionEventId: orderLite.completionEventId,\n        createdAt: orderLite.createdAt,\n        businessAt: orderLite.businessAt,\n        businessDate: orderLite.businessDate,\n        completedAt: orderLite.completedAt,\n        orderCreatedAtServer: order.createdAtServer || null,\n        orderCreatedAtServerIso: String(order.createdAtServerIso || ''),\n        orderProcessedAtServer: order.processedAtServer || null,\n        orderProcessedAtServerIso: String(order.processedAtServerIso || ''),\n        orderCompletedAtServer: order.completedAtServer || null,\n        orderCompletedAtServerIso: String(order.completedAtServerIso || order.processedAtServerIso || ''),\n        orderCancelledAtServer: order.cancelledAtServer || null,\n        orderCancelledAtServerIso: String(order.cancelledAtServerIso || ''),\n        orderStatusUpdatedAtServer: order.statusUpdatedAtServer || null,\n        orderStatusUpdatedAtServerIso: String(order.statusUpdatedAtServerIso || order.processedAtServerIso || order.cancelledAtServerIso || ''),\n        orderUpdatedAtServer: order.updatedAtServer || null,\n        orderUpdatedAtServerIso: String(order.updatedAtServerIso || order.statusUpdatedAtServerIso || ''),\n        savedAt: new Date().toISOString(),\n        payloadKind: 'lightweight-completed-order',\n        orderLite\n      };\n    }",
  "buildCompletedPayloadFromLiveOrder": "  function buildCompletedPayloadFromLiveOrder(order, docId, targetDate){\n    if(!order || typeof order !== 'object') return null;\n    const orderId = String(order.id || '').trim();\n    if(!orderId) return null;\n    const status = normalizeLiveOrderStatus(order.status, order.deliveryType);\n    if(!isLiveOrderDoneStatus(status)) return null;\n    const businessDate = getCompletedLiveOrderDateKey(order, targetDate);\n    if(businessDate !== targetDate) return null;\n    const completedAt = String(order.statusUpdatedAt || order.processedAt || order.completedAt || order.updatedAt || order.timestamp || order.createdAt || '');\n    const createdAt = String(order.createdAt || order.timestamp || completedAt || '');\n    const businessAt = String(order.businessAt || createdAt || completedAt || '');\n    const items = Array.isArray(order.items) ? order.items : [];\n    const totalCups = items.reduce((sum, item) => sum + Math.max(0, Number(item && item.quantity || 0)), 0) || Number(order.totalCups || order.quantity || 0);\n    const orderLite = {\n      id:orderId,\n      ...(Object.prototype.hasOwnProperty.call(order, 'couponPolicyVersion') ? { couponPolicyVersion:order.couponPolicyVersion } : {}),\n      ...(Object.prototype.hasOwnProperty.call(order, 'couponCostTotal') ? { couponCostTotal:order.couponCostTotal } : {}),\n      orderNumber:String(order.orderNumber || order.seq || ''),\n      seq:order.seq || '',\n      status,\n      createdAt,\n      timestamp:String(order.timestamp || createdAt || ''),\n      businessAt,\n      businessDate,\n      completedAt,\n      statusUpdatedAt:String(order.statusUpdatedAt || completedAt || ''),\n      processedAt:String(order.processedAt || ''),\n      processedBy:String(order.processedBy || ''),\n      productionCycle:normalizeLifecycleCycle(order.productionCycle),\n      statusRevision:normalizeLifecycleRevision(order.statusRevision),\n      completionCommitted:order.completionCommitted === true,\n      completionEventId:String(order.completionEventId || ''),\n      userId:String(order.userId || ''),\n      userName:String(order.userName || order.userNameDisplay || order.userNameReal || ''),\n      userDept:String(order.userDept || order.department || order.dept || ''),\n      deliveryType:String(order.deliveryType || 'PICKUP'),\n      deliveryLocation:String(order.deliveryLocation || order.deliveryPlace || ''),\n      quantity:Number(totalCups || order.quantity || 0),\n      totalCups:Number(totalCups || order.quantity || 0),\n      cupType:String(order.cupType || ''),\n      tumblerInfo:String(order.tumblerInfo || ''),\n      memo:String(order.memo || order.requestMemo || ''),\n      remainingCoupons:Number(order.remainingCoupons || 0),\n      isGroupOrder:order.isGroupOrder === true,\n      items\n    };\n    return {\n      version:2,\n      appVersion:String(window.OrderModule && window.OrderModule.state && window.OrderModule.state.orderAppVersion || ''),\n      storageMode:'completed-order-live-recovery-read',\n      reason:'completed-live-order-read-recovery',\n      orderId,\n      orderNumber:orderLite.orderNumber,\n      status,\n      productionCycle:orderLite.productionCycle,\n      statusRevision:orderLite.statusRevision,\n      completionCommitted:orderLite.completionCommitted,\n      completionEventId:orderLite.completionEventId,\n      createdAt,\n      businessAt,\n      businessDate,\n      completedAt,\n      payloadKind:'lightweight-completed-order',\n      docId:String(docId || makeLiveOrderDocId(orderId)),\n      storageLocation:'haetsalCombinedApp/live_order-readonly',\n      orderLite\n    };\n  }",
  "expandEmergencyCompactOrderRecord": "    function expandEmergencyCompactOrderRecord(record){\n      const normalized = normalizeEmergencyCompactOrderRecord(record);\n      if(!normalized) return null;\n      const deliveryType = decodeCompactDeliveryType(normalized.d);\n      const status = decodeCompactOrderStatus(normalized.s, deliveryType);\n      const seqNum = Number(normalized.sq || normalized.n || 0);\n      return {\n        id: normalized.id,\n        orderNumber: normalized.n || normalized.sq || '',\n        seq: Number.isFinite(seqNum) && seqNum > 0 ? seqNum : (normalized.sq || normalized.n || ''),\n        userId: normalized.u,\n        userName: normalized.un,\n        userNameDisplay: normalized.un,\n        userDept: normalized.ud,\n        timestamp: normalized.t || normalized.p || '',\n        createdAt: normalized.t || normalized.p || '',\n        processedAt: normalized.p || normalized.t || '',\n        completedAt: normalized.p || normalized.t || '',\n        statusUpdatedAt: normalized.p || normalized.t || '',\n        status,\n        deliveryType,\n        deliveryLocation: '',\n        quantity: Number(normalized.q || 0),\n        totalCups: Number(normalized.q || 0),\n        remainingCoupons: normalized.r == null ? null : Number(normalized.r),\n        items: ((Array.isArray(normalized.i) && normalized.i.length) ? normalized.i.map(item => ({\n          temp: String(item[0] || 'I').toUpperCase() === 'H' ? 'HOT' : 'ICE',\n          menuName: String(item[1] || '보존 기록'),\n          cupType: decodeCompactCupType(item[2]),\n          quantity: Math.max(1, Number(item[3] || 1)),\n          whippedCreamAdded: !!item[4],\n          shotCount: normalizeShotCount(item[5], item[6]),\n          defaultShotCount: normalizeShotCount(item[6], 0),\n          shotMenuName: String(item[1] || ''),\n          itemMemo: '',\n          assignedTumblerLabel: '',\n          assignedTumblerKind: '',\n          assignedTumblerNumber: ''\n        })) : (Array.isArray(normalized.c) ? normalized.c : []).map(item => ({\n          temp: 'ICE',\n          menuName: '보존 기록',\n          cupType: decodeCompactCupType(item && item[0]),\n          quantity: Math.max(1, Number(item && item[1] || 1)),\n          whippedCreamAdded: false,\n          shotCount: 0,\n          defaultShotCount: 0,\n          shotMenuName: '',\n          itemMemo: '',\n          assignedTumblerLabel: '',\n          assignedTumblerKind: '',\n          assignedTumblerNumber: ''\n        }))),\n        isArchivedCompletedView: true,\n        isEmergencyCompactOrder: true,\n        archivedSourceLabel: '긴급 정리 보존 기록'\n      };\n    }"
};
const baselineBodyHashes={
  "normalizeEmergencyCompactOrderRecord": "66de9f180fc8345f31a1fa11bbf5efd99fae4509355a352466da710d27fbf26c",
  "createEmergencyCompactOrderRecord": "011dffaff354084e5a6144f82da9475046b67ff05afcb7ae43384203f964dc4f",
  "createCompletedOrderDocumentPayload": "5ea2680f10f693d1188a0811525a12efe5cbb03f44dab965c76a08fe9c70bc8e",
  "buildCompletedPayloadFromLiveOrder": "543edc9f876d80746d6360d70add1c4a5ccfd2258d646354cbe692bbb70c86de",
  "expandEmergencyCompactOrderRecord": "7f11bff1d9d800f4cbe6de53310f16f1db92d276ba2e5c4193d8316a686a998c"
};
const requiredFunctions=[
  "toOrderDate",
  "getOrderSeoulDateTimeParts",
  "getDateString",
  "getFirstOrderTimeValue",
  "getOrderBusinessTimestamp",
  "getOrderBusinessDateKey",
  "getOrderStatusTimestamp",
  "getOrderProcessedTimestamp",
  "getNormalizedOrderStatus",
  "isOrderClosedStatus",
  "normalizeOrderProductionCycle",
  "normalizeOrderStatusRevision",
  "trimCompletedOrderText",
  "normalizeShotCount",
  "trimCompactOrderText",
  "encodeCompactCupType",
  "decodeCompactCupType",
  "encodeCompactDeliveryType",
  "decodeCompactDeliveryType",
  "encodeCompactOrderStatus",
  "decodeCompactOrderStatus",
  "normalizeHistoryDateOnly",
  "isHistoryTimestampString",
  "getHistoryTimeInfo",
  "getOrderHistoryTimeInfo",
  "normalizeEmergencyCompactOrderRecord",
  "normalizeEmergencyOrderCompactArchive",
  "getEmergencyOrderCleanupTimestamp",
  "createEmergencyCompactOrderRecord",
  "mergeEmergencyCompactArchiveWithOrders",
  "expandEmergencyCompactOrderRecord",
  "createCompletedOrderDocumentPayload",
  "normalizeArchivedCompletedPayloadToOrder",
  "getKoreaBusinessDateUtcRange",
  "normalizeLiveOrderStatus",
  "isLiveOrderDoneStatus",
  "normalizeLifecycleCycle",
  "normalizeLifecycleRevision",
  "getCompletedLiveOrderDateKey",
  "buildCompletedPayloadFromLiveOrder",
  "formatAMPM",
  "formatMonthDay",
  "formatDateTime",
  "getCouponHistorySortTime",
  "formatCouponLedgerTimestamp",
  "formatUserCouponLedgerTimestamp",
  "formatHistoryTime",
  "getCombinedHistoryItemTime",
  "compareCombinedHistoryItemsByTimeDesc",
  "getUserCouponLedgerDisplayRecords",
  "mergeOrdersByIdForCouponHistory",
  "getEmergencyOrderCompactArchive",
  "getEmergencyCompactOrdersForDisplay",
  "getOrdersForStatsAndHistory",
  "getEmergencyCompactCompletedOrdersForDate",
  "expandEmergencyCompactHistoryOrderRecord",
  "getEmergencyCompactHistoryOrdersForDisplay",
  "getUserCouponArchivedOrders",
  "getCouponHistoryOrdersForUser"
];

const crossTimezoneProcessingFixture={
  "producerSourceSHA256": "f8dc73868df494609752c78336ee9762728391a911b42def6ca6f954315a286a",
  "writerBodySHA256": "5ea2680f10f693d1188a0811525a12efe5cbb03f44dab965c76a08fe9c70bc8e",
  "UTCpayload": {
    "version": 2,
    "appVersion": "2026.07.17-0103-completed-recovery-legacy-scan-v1",
    "storageMode": "completed-order-light-doc",
    "reason": "auto",
    "orderId": "roundtrip-order",
    "orderNumber": "synthetic-17",
    "status": "PICKUP_DONE",
    "productionCycle": 3,
    "statusRevision": 4,
    "completionCommitted": false,
    "completionEventId": "",
    "createdAt": "",
    "businessAt": "2026-11-27T10:00:00+09:00",
    "businessDate": "2026-11-27",
    "completedAt": "2026-11-27T10:00:00+09:00",
    "orderCreatedAtServer": null,
    "orderCreatedAtServerIso": "",
    "orderProcessedAtServer": null,
    "orderProcessedAtServerIso": "",
    "orderCompletedAtServer": null,
    "orderCompletedAtServerIso": "",
    "orderCancelledAtServer": null,
    "orderCancelledAtServerIso": "",
    "orderStatusUpdatedAtServer": null,
    "orderStatusUpdatedAtServerIso": "",
    "orderUpdatedAtServer": null,
    "orderUpdatedAtServerIso": "",
    "savedAt": "2026-11-26T02:03:04.000Z",
    "payloadKind": "lightweight-completed-order",
    "orderLite": {
      "id": "roundtrip-order",
      "orderNumber": "synthetic-17",
      "seq": 17,
      "status": "PICKUP_DONE",
      "createdAt": "",
      "createdAtServerIso": "",
      "businessAtServerIso": "",
      "timestamp": "",
      "businessAt": "2026-11-27T10:00:00+09:00",
      "businessDate": "2026-11-27",
      "completedAt": "2026-11-27T10:00:00+09:00",
      "completedAtServerIso": "",
      "statusUpdatedAt": "2026-11-27T10:00:00+09:00",
      "statusUpdatedAtServerIso": "",
      "updatedAtServerIso": "",
      "processedAt": "2026-11-26T23:30:00",
      "processedAtServerIso": "",
      "processedBy": "",
      "cancelledAt": "",
      "cancelledAtServerIso": "",
      "cancelledBy": "",
      "cancelledClientSessionId": "",
      "cancelReason": "",
      "refundQuantity": 0,
      "refundBeforeCoupons": null,
      "refundAfterCoupons": null,
      "refundHistoryId": "",
      "refundHistoryType": "",
      "refundHistorySource": "",
      "productionCycle": 3,
      "statusRevision": 4,
      "completionCommitted": false,
      "completionEventId": "",
      "userId": "synthetic-only",
      "userName": "",
      "userDept": "",
      "deliveryType": "PICKUP",
      "deliveryLocation": "",
      "quantity": 2,
      "totalCups": 2,
      "cupType": "",
      "tumblerInfo": "",
      "memo": "날짜 보존",
      "remainingCoupons": 17,
      "isGroupOrder": false,
      "items": []
    }
  },
  "UTCpayloadSHA256": "4464c795e61f7a03b771298ee7049539083c9de3cf02c56f53056c9146797545",
  "KSTbusinessDate": "2026-11-26",
  "KSTpayloadSHA256": "799bb0ee015395fc4e117f4ba2d5bfba84a0159aefe7517a13424f79e73427fb"
};
const processingClockCase49Fixtures=[
  {
    "mode": "lower",
    "producerTimezone": "UTC",
    "processedAt": "2026-11-26t23:30:00",
    "businessDate": "2026-11-27",
    "payloadSHA256": "be00eec6e1b6436c02db366b160119d973ed3d8262c89a711d9253ed494c5fbb"
  },
  {
    "mode": "lower",
    "producerTimezone": "Asia/Seoul",
    "processedAt": "2026-11-26t23:30:00",
    "businessDate": "2026-11-26",
    "payloadSHA256": "6b818591df646a44af9c2eff55de9add63969afa2937f5391850a3421d7fec68"
  },
  {
    "mode": "lower",
    "producerTimezone": "Pacific/Kiritimati",
    "processedAt": "2026-11-26t23:30:00",
    "businessDate": "2026-11-26",
    "payloadSHA256": "6b818591df646a44af9c2eff55de9add63969afa2937f5391850a3421d7fec68"
  },
  {
    "mode": "lower",
    "producerTimezone": "Etc/GMT+12",
    "processedAt": "2026-11-26t23:30:00",
    "businessDate": "2026-11-27",
    "payloadSHA256": "be00eec6e1b6436c02db366b160119d973ed3d8262c89a711d9253ed494c5fbb"
  },
  {
    "mode": "rollover",
    "producerTimezone": "UTC",
    "processedAt": "2026-11-26T24:00:00",
    "businessDate": "2026-11-27",
    "payloadSHA256": "61edd566b3767c56f0def500954a9ab05a37f6d7b4f2c34ae98dda3b8e23a05b"
  },
  {
    "mode": "rollover",
    "producerTimezone": "Asia/Seoul",
    "processedAt": "2026-11-26T24:00:00",
    "businessDate": "2026-11-27",
    "payloadSHA256": "61edd566b3767c56f0def500954a9ab05a37f6d7b4f2c34ae98dda3b8e23a05b"
  },
  {
    "mode": "rollover",
    "producerTimezone": "Pacific/Kiritimati",
    "processedAt": "2026-11-26T24:00:00",
    "businessDate": "2026-11-26",
    "payloadSHA256": "3b5d11780a691d4d9dbc8f22cc31744fdb516ade8b365d322e247347748458e8"
  },
  {
    "mode": "rollover",
    "producerTimezone": "Etc/GMT+12",
    "processedAt": "2026-11-26T24:00:00",
    "businessDate": "2026-11-27",
    "payloadSHA256": "61edd566b3767c56f0def500954a9ab05a37f6d7b4f2c34ae98dda3b8e23a05b"
  }
];
const rows=[],limits=[],extracted={};
const plain=value=>JSON.parse(JSON.stringify(value)),same=(a,b,message)=>assert.deepEqual(plain(a),plain(b),message);
const order=extra=>({id:'roundtrip-order',orderNumber:'synthetic-17',seq:17,status:'PICKUP_DONE',deliveryType:'PICKUP',quantity:2,remainingCoupons:17,productionCycle:3,statusRevision:4,userId:'synthetic-only',items:[],memo:'날짜 보존',refundQuantity:0,processedAt:'2026-11-26T01:00:00+09:00',...extra});
function context(useBaseline){
 const state={orders:[],sysSettings:{}};
 const ctx=vm.createContext({Date:FrozenDate,Intl,Map,Set,Number,String,Object,Array,Math,console,window:{},state,couponRows:[],getOrderItemsForDisplay:()=>[],getOrderTotalQuantity:o=>Number(o.quantity||o.totalCups||0),copyStoredCouponCostSnapshotFields:value=>value,compactCompletedOrderItemForStorage:value=>value,getEmergencyCompactOrdersForDisplay:()=>[],getCouponHistoryLogsForUser:()=>[],getLatestCouponRecalcTimelineResult:()=>null,getCombinedOrderHistorySummary:()=>null,normalizeHistoryRemainingCoupons:v=>v});
 vm.runInContext('function buildCouponLedgerDisplayRecords(){return couponRows;}',ctx);
 for(const n of ['ORDER_TIME_ZONE','ORDER_SEOUL_DATE_TIME_FORMATTER','ORDER_EMERGENCY_CLEANUP_MIN_DATE','ORDER_APP_VERSION'])vm.runInContext(declaration(n),ctx);
 for(const n of requiredFunctions){const text=extract(source,n);extracted[n]=sha(text);vm.runInContext(text,ctx);}
 const binding=/getHistoryTimeInfoForOrder\s*:\s*getOrderHistoryTimeInfo/.exec(source);
 assert(binding,'Actual live bridge getter export is required');
 vm.runInContext('window.OrderModule={'+binding[0]+'};',ctx);
 assert.equal(ctx.window.OrderModule.getHistoryTimeInfoForOrder,ctx.getOrderHistoryTimeInfo);
 if(useBaseline)for(const[n,text]of Object.entries(baselineBodies)){assert.equal(sha(text),baselineBodyHashes[n]);vm.runInContext(text,ctx);}
 return ctx;
}
const actual=context(false),baseline=context(true);
const view=(ctx,payload,json=true)=>{const stored=json?plain(payload):payload,read=ctx.normalizeArchivedCompletedPayloadToOrder(stored);return {stored,read,info:ctx.getOrderHistoryTimeInfo(read)};};
function test(name,fn){try{const details=fn();rows.push({name,status:'PASS',...details});}catch(error){rows.push({name,status:'FAIL',message:error.message,actual:error.actual,expected:error.expected,stack:error.stack});}}
function persisted(actualValue,baselineValue,label){same(actualValue,baselineValue,label+' enumerable/JSON fields changed');}
function balances(payload){assert.equal(payload.orderLite.quantity,2);assert.equal(payload.orderLite.remainingCoupons,17);assert.equal(payload.orderLite.status,'PICKUP_DONE');assert.equal(payload.orderLite.productionCycle,3);assert.equal(payload.orderLite.statusRevision,4);}
function assertInstant(info,millis){assert(info.timestamp,'Expected an available original receipt instant');assert.equal(info.timestamp.getTime(),millis);}
const first='2026-11-25T14:59:59.000Z',later='2026-11-25T15:00:01.000Z',laterMS=Date.parse(later),server=Timestamp.fromDate(new Date(later));
const representations={protocolTimestamp:server,serializedTimestamp:plain(server),publicTimestamp:{seconds:server.seconds,nanoseconds:server.nanoseconds},Date:new Date(later)};
for(const[name,raw]of Object.entries(representations)){
 const input=order({timestamp:first,createdAt:first,createdAtServer:raw,createdAtServerIso:first,sequenceDate:'20261125'});
 test(name+' writer JSON keeps all baseline persisted/fiscal fields and reader chooses actual server',()=>{
  const before=JSON.stringify(input),payload=actual.createCompletedOrderDocumentPayload(input),old=baseline.createCompletedOrderDocumentPayload(input);persisted(payload,old,'writer');balances(payload);
  assertInstant(actual.getOrderHistoryTimeInfo(input),laterMS);assertInstant(view(actual,payload).info,laterMS);assert.equal(payload.businessDate,'2026-11-25');assert.equal(JSON.stringify(input),before);
 });
 test(name+' actual readonly adapter preserves baseline JSON and uses actual getter for view',()=>{
  const before=JSON.stringify(input),payload=actual.buildCompletedPayloadFromLiveOrder(input,'live_order_roundtrip-order','2026-11-25'),old=baseline.buildCompletedPayloadFromLiveOrder(input,'live_order_roundtrip-order','2026-11-25');
  assert(payload&&old);persisted(payload,old,'readonly bridge');balances(payload);assertInstant(view(actual,payload,false).info,laterMS);limits.push({name:name+' readonly bridge JSON metadata lifetime',status:'UNVERIFIED',reason:'The baseline readonly adapter has no persistent raw-server slot. Its nonenumerable original-time metadata is valid for the actual direct view, and is lost if an external consumer JSON-serializes that readonly view payload.',afterJSONTimestamp:view(actual,payload,true).info.timestamp?.toISOString()||null});assert.equal(JSON.stringify(input),before);
 });
 test(name+' compact creator preserves client reporting time and every baseline stored field',()=>{
  const compact=actual.createEmergencyCompactOrderRecord(input),old=baseline.createEmergencyCompactOrderRecord(input);persisted(compact,old,'compact creator');assert.equal(compact.t,first);assert.equal(compact.q,2);assert.equal(compact.r,17);
  const expanded=actual.expandEmergencyCompactOrderRecord(compact);assert.equal(actual.getOrderBusinessDateKey(expanded),baseline.getOrderBusinessDateKey({timestamp:old.t,createdAt:old.t}));
 });
}
for(const[name,value]of [['ISO',first],['Date',new Date(first)],['Timestamp',Timestamp.fromDate(new Date(first))],['serialized Timestamp',plain(Timestamp.fromDate(new Date(first)))],['date-only','2026-11-25'],['compact date-only','20261125'],['none',undefined]])test(name+' completed writer and live adapter retain every existing serialized field',()=>{
 const input=order(value===undefined?{}:{createdAt:value}),before=JSON.stringify(input),written=actual.createCompletedOrderDocumentPayload(input),old=baseline.createCompletedOrderDocumentPayload(input);persisted(written,old,'writer');balances(written);
 const bridgeInput={...input,businessDate:'2026-11-25'},bridge=actual.buildCompletedPayloadFromLiveOrder(bridgeInput,'live_order_roundtrip-order','2026-11-25'),oldBridge=baseline.buildCompletedPayloadFromLiveOrder(bridgeInput,'live_order_roundtrip-order','2026-11-25');persisted(bridge,oldBridge,'readonly bridge');assert.equal(JSON.stringify(input),before);
 if(name==='ISO')assertInstant(view(actual,written).info,Date.parse(first));
 if(name==='date-only'||name==='compact date-only'){assert.equal(view(actual,written).info.timestamp,null);assert.equal(view(actual,written).info.historyDateOnly,'2026-11-25');}
 if(name==='none'){assert.equal(view(actual,written).info.timestamp,null);assert.equal(view(actual,written).info.historyDateOnly,'');}
 if(['Date','Timestamp','serialized Timestamp'].includes(name))limits.push({name:name+' original typed serialization',status:'UNVERIFIED',reason:'Baseline writers may fully lose typed original values. Preserved fiscal/ISO fields cannot prove an original instant; no reconstruction or schema change is claimed.',observedReceipt:written.orderLite.createdAt,viewTimestamp:view(actual,written).info.timestamp?.toISOString()||null,viewDateOnly:view(actual,written).info.historyDateOnly});
});
test('compact normalizer is baseline-exact and ambiguous t=p stays unknown through JSON reload',()=>{
 assert.equal(extracted.normalizeEmergencyCompactOrderRecord,baselineBodyHashes.normalizeEmergencyCompactOrderRecord,'Normalizer body must remain LF-byte-exact');
 const raw={id:'compact-p',p:'2026-11-26T01:00:00+09:00',s:'C',q:2,r:17,c:[],i:[]},before=JSON.stringify(raw),compact=actual.normalizeEmergencyCompactOrderRecord(raw),old=baseline.normalizeEmergencyCompactOrderRecord(raw);
 persisted(compact,old,'compact normalizer');assert.equal(JSON.stringify(raw),before);assert.equal(Object.hasOwn(compact,'historyOriginalTimeInfo'),false);
 for(const value of [compact,plain(compact),actual.normalizeEmergencyCompactOrderRecord(compact),actual.normalizeEmergencyCompactOrderRecord(plain(compact))]){
  persisted(value,old,'compact repeated/JSON normalization');const expanded=actual.expandEmergencyCompactHistoryOrderRecord(value),info=actual.getOrderHistoryTimeInfo(expanded),reloadedView=actual.getOrderHistoryTimeInfo(plain(expanded));
  assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,'');assert.equal(reloadedView.timestamp,null);assert.equal(reloadedView.historyDateOnly,'');
 }
 limits.push({name:'compact t=p original truth',status:'UNVERIFIED',reason:'Stored baseline t=p cannot distinguish an original simultaneous receipt from processing fallback. Both display unknown before/after reload; raw stored values and reporting dates are preserved.',storedT:compact.t,storedP:compact.p});
});
test('explicit stored compact t=p also stays unknown without independent original evidence',()=>{
 const raw={id:'explicit',t:first,p:first,s:'C',q:2,r:17,c:[],i:[]},compact=actual.normalizeEmergencyCompactOrderRecord(raw);persisted(compact,baseline.normalizeEmergencyCompactOrderRecord(raw),'explicit compact');
 for(const value of [compact,plain(compact)]){const info=actual.getOrderHistoryTimeInfo(actual.expandEmergencyCompactHistoryOrderRecord(value));assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,'');}
});
test('distinct valid compact t keeps its original view without changing baseline JSON/reporting',()=>{
 for(const t of [first,'20261125','invalid-receipt']){
  const raw={id:'distinct',t,p:'2026-11-26T01:00:00+09:00',s:'C',q:2,r:17,c:[],i:[]},compact=actual.normalizeEmergencyCompactOrderRecord(raw);persisted(compact,baseline.normalizeEmergencyCompactOrderRecord(raw),'distinct compact');
  for(const value of [compact,plain(compact)]){const info=actual.getOrderHistoryTimeInfo(actual.expandEmergencyCompactHistoryOrderRecord(value));if(t===first)assertInstant(info,Date.parse(first));else{assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,t==='20261125'?'2026-11-25':'');}}
 }
});
test('independent same-user full receipt restores ambiguous compact view while stored fields remain intact',()=>{
 const raw={id:'roundtrip-order',u:'synthetic-only',t:first,p:first,s:'C',q:2,r:17,c:[],i:[]},compact=actual.normalizeEmergencyCompactOrderRecord(raw),expanded=actual.expandEmergencyCompactHistoryOrderRecord(plain(compact)),full=order({createdAt:first});
 const before=plain(expanded),merged=actual.mergeOrdersByIdForCouponHistory([full],[expanded])[0];assertInstant(actual.getOrderHistoryTimeInfo(merged),Date.parse(first));
 for(const key of Object.keys(before).filter(key=>!key.startsWith('historyOriginal')))same(merged[key],before[key],'Strong view evidence changed compact field '+key);
 const crossUser=actual.mergeOrdersByIdForCouponHistory([{...full,userId:'other-synthetic-user'}],[expanded])[0];assert.equal(actual.getOrderHistoryTimeInfo(crossUser).timestamp,null);
 persisted(compact,baseline.normalizeEmergencyCompactOrderRecord(raw),'independent-view compact storage');
});
test('compact creator+merge JSON preserve all baseline stored fields',()=>{
 const inputs=[order({timestamp:first}),order({id:'no-origin'})];persisted(actual.mergeEmergencyCompactArchiveWithOrders({records:[]},inputs,{}),baseline.mergeEmergencyCompactArchiveWithOrders({records:[]},inputs,{}),'compact archive');
});
test('no-origin processing over Korean midnight is unknown while fiscal JSON is baseline-identical',()=>{
 const input=order({processedAt:'2026-11-25T23:59:59+09:00',processedAtServer:server}),payload=actual.createCompletedOrderDocumentPayload(input);persisted(payload,baseline.createCompletedOrderDocumentPayload(input),'midnight writer');const info=view(actual,payload).info;assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,'');
});
test('direct raw declared original equal processing is preserved',()=>{const input=order({businessAt:'2026-11-26T01:00:00+09:00'});assertInstant(actual.getOrderHistoryTimeInfo(actual.normalizeArchivedCompletedPayloadToOrder(input)),Date.parse(input.businessAt));});
test('order references use date-only/unknown original while independent coupon events retain event time',()=>{
 const reference={id:'reference',orderId:'roundtrip-order',userId:'synthetic-only',source:'order-record',timestamp:'2026-11-30T09:00:00Z'},dated=order({sequenceDate:'20261125'}),unknown=order({});
 assert.equal(actual.formatUserCouponLedgerTimestamp(reference,dated),'2026.11.25');assert.equal(actual.formatUserCouponLedgerTimestamp(reference,unknown),'일시 확인 필요');
 const event={...reference,source:'coupon-history',timestamp:'2026-11-26T00:05:00Z'};assert.equal(actual.formatUserCouponLedgerTimestamp(event,dated),'2026.11.26 오전 09:05');
});
test('coupon cutoff occurs after actual reference-date sorting and changes no ledger fields',()=>{
 const sourceOrders=[order({timestamp:'2026-11-20T00:00:00Z'})],records=[{id:'old-reference',orderId:'roundtrip-order',userId:'synthetic-only',source:'order-record',type:'COUPON_ORDER_USE',timestamp:'2026-11-30T00:00:00Z',amount:1,delta:-1},...[25,24,23,22,21].map(day=>({id:'charge-'+day,userId:'synthetic-only',source:'coupon-history',type:'COUPON_CHARGE',timestamp:'2026-11-'+day+'T00:00:00Z',amount:1,delta:1}))];
 const before=JSON.stringify(records);actual.couponRows=records;const result=actual.getUserCouponLedgerDisplayRecords('synthetic-only',5,false,sourceOrders);same(Array.from(result,row=>row.id),['charge-25','charge-24','charge-23','charge-22','charge-21']);assert.equal(JSON.stringify(records),before);
});
test('later weak archive keeps stronger server view while fiscal/status fields stay later',()=>{
 const live=order({timestamp:first,createdAt:first,createdAtServer:server,createdAtServerIso:first}),archived=view(actual,actual.createCompletedOrderDocumentPayload(order({createdAt:first,statusRevision:9}))).read;
 const before=plain(archived),merged=actual.mergeOrdersByIdForCouponHistory([live],[archived])[0];assertInstant(actual.getOrderHistoryTimeInfo(merged),laterMS);assert.equal(merged.statusRevision,9);
 for(const key of Object.keys(before).filter(key=>!key.startsWith('historyOriginal')))same(merged[key],before[key],'View merge changed existing field '+key);
 const crossUser=actual.mergeOrdersByIdForCouponHistory([{...live,userId:'other-synthetic-user'}],[archived])[0];assertInstant(actual.getOrderHistoryTimeInfo(crossUser),Date.parse(first));
});
test('actual server has priority over stale server ISO alias and preserves fiscal date',()=>{
 const input=order({timestamp:first,createdAtServer:server,businessAtServerIso:first,sequenceDate:'20261125'});assertInstant(actual.getOrderHistoryTimeInfo(input),laterMS);assert.equal(actual.getOrderHistoryTimeInfo(input).evidenceRank,3);assert.equal(actual.getOrderBusinessDateKey(input),baseline.getOrderBusinessDateKey(input));
});
test('actual Web SDK lossless Timestamp string survives writer JSON reader while all stored fields stay baseline',()=>{
 const instant='2026-11-25T14:59:59.123Z',ms=Date.parse(instant),seconds=Math.floor(ms/1000),nanoseconds=123000000,typed=makeWebTimestamp(seconds,nanoseconds),raw=typed.toString();
 assert.equal(raw,'Timestamp(seconds='+seconds+', nanoseconds='+nanoseconds+')');
 for(const value of [typed,raw]){
  const input=order({createdAt:value}),before=JSON.stringify(input),written=actual.createCompletedOrderDocumentPayload(input),old=baseline.createCompletedOrderDocumentPayload(input);persisted(written,old,'WebSDK writer');balances(written);assert.equal(written.orderLite.createdAt,raw);assertInstant(view(actual,written).info,ms);assert.equal(JSON.stringify(input),before);
  const bridgeInput={...input,businessDate:'2026-11-25'},bridge=actual.buildCompletedPayloadFromLiveOrder(bridgeInput,'live_order_roundtrip-order','2026-11-25'),oldBridge=baseline.buildCompletedPayloadFromLiveOrder(bridgeInput,'live_order_roundtrip-order','2026-11-25');persisted(bridge,oldBridge,'WebSDK readonly bridge');assertInstant(view(actual,bridge,false).info,ms);assertInstant(view(actual,bridge,true).info,ms);
 }
 return {actualWebSDKMethod:true,rawString:raw,instant,container:'protocol fixture; actual Cloud SDK constructor is separately covered'};
});
test('invalid original clock cannot erase an independently valid original business date equal processing day',()=>{
 const input=order({businessAt:'not-a-valid-clock',businessDate:'2026-11-26'}),written=actual.createCompletedOrderDocumentPayload(input);persisted(written,baseline.createCompletedOrderDocumentPayload(input),'invalid-clock writer');balances(written);
 const info=view(actual,written).info;assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,'2026-11-26');assert.equal(written.orderLite.businessAt,'not-a-valid-clock');assert.equal(written.businessDate,'2026-11-26');
});
test('only provable fallback alternatives are excluded while independently recorded completion-day dates survive',()=>{
 const server25={seconds:Date.parse('2026-11-25T14:59:59Z')/1000,nanoseconds:0},server26={seconds:Date.parse('2026-11-25T15:00:01Z')/1000,nanoseconds:0};
 for(const extra of [{processedAt:'2026-11-26T01:00:00+09:00',completedAtServer:server25},{processedAt:'2026-11-25T23:59:59+09:00',processedAtServer:server26}]){
  const independent=order({...extra,businessDate:'2026-11-25'}),withoutDate=order(extra),declared=actual.createCompletedOrderDocumentPayload(independent),derived=actual.createCompletedOrderDocumentPayload(withoutDate);
  assert.equal(actual.getOrderBusinessDateKey(withoutDate),'2026-11-26');persisted(declared,baseline.createCompletedOrderDocumentPayload(independent),'independent-day writer');persisted(derived,baseline.createCompletedOrderDocumentPayload(withoutDate),'derived-day writer');balances(declared);balances(derived);
  const declaredInfo=view(actual,declared).info,derivedInfo=view(actual,derived).info;assert.equal(declaredInfo.timestamp,null);assert.equal(declaredInfo.historyDateOnly,extra.processedAtServer?'':'2026-11-25');assert.equal(derivedInfo.timestamp,null);assert.equal(derivedInfo.historyDateOnly,'');if(extra.processedAtServer){const lost=order({...extra,businessAtServer:0}),lostPayload=actual.createCompletedOrderDocumentPayload(lost);persisted(lostPayload,baseline.createCompletedOrderDocumentPayload(lost),'case33 lost-falsy writer');same(declared,lostPayload,'Preserved server26 plus client25 cannot distinguish explicit25 from erased-first fallback25');assert.equal(view(actual,lostPayload).info.historyDateOnly,'');}
 }
});
test('lossless processing raw text cannot prove an independently stored same-day receipt after typed serialization',()=>{
 const millis=Date.parse('2026-11-26T01:00:00+09:00'),raw=makeWebTimestamp(Math.floor(millis/1000),0).toString(),independent=order({processedAt:raw,businessDate:'2026-11-26'}),withoutDate=order({processedAt:raw});
 const declared=actual.createCompletedOrderDocumentPayload(independent),derived=actual.createCompletedOrderDocumentPayload(withoutDate);persisted(declared,baseline.createCompletedOrderDocumentPayload(independent),'lossless-processing declared writer');persisted(derived,baseline.createCompletedOrderDocumentPayload(withoutDate),'lossless-processing no-date writer');balances(declared);balances(derived);
 assert.equal(actual.getDateString(raw),'');assert.equal(derived.businessDate,'');assert.equal(actual.getHistoryTimeInfo([raw]).timestamp.getTime(),millis);
 const info=view(actual,declared).info;assert.equal(info.timestamp,null);// Oracle revised: a typed SDK processing value and an explicit raw string can produce identical stored JSON.
 assert.equal(info.historyDateOnly,'');
});
test('date-only processing copied by the old writer is never promoted to an original receipt day',()=>{
 for(const raw of ['2026-11-25','20261125']){const input=order({processedAt:raw}),payload=actual.createCompletedOrderDocumentPayload(input);persisted(payload,baseline.createCompletedOrderDocumentPayload(input),'date-only processing writer');balances(payload);const info=view(actual,payload).info;assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,'');}
});
test('independent original business time is preserved when only an older processing field or equivalent differently written instant matches it',()=>{
 const cases=[{businessAt:'2026-11-25T23:00:00+09:00',processedAt:'2026-11-25T23:00:00+09:00',statusUpdatedAt:'2026-11-26T00:01:00+09:00'},{businessAt:'2026-11-25T14:00:00Z',processedAt:'2026-11-25T23:00:00+09:00',statusUpdatedAt:'2026-11-25T23:00:00+09:00'}];
 for(const fields of cases){const input=order(fields),payload=actual.createCompletedOrderDocumentPayload(input);persisted(payload,baseline.createCompletedOrderDocumentPayload(input),'independent original business time writer');assert.notEqual(payload.orderLite.businessAt,payload.orderLite.completedAt);assertInstant(view(actual,payload).info,Date.parse(fields.businessAt));balances(payload);}
});
test('offsetless ISO cannot prove an exact receipt but independent days and later explicit-zone evidence remain usable',()=>{
 const raw='2026-11-26T00:00:00',exact='2026-11-25T15:00:00Z',millis=Date.parse(exact),unknown=actual.getHistoryTimeInfo([raw]);assert.equal(unknown.timestamp,null);assert.equal(unknown.historyDateOnly,'');assertInstant(actual.getHistoryTimeInfo([raw,exact]),millis);
 const dated=actual.getOrderHistoryTimeInfo(order({createdAt:raw,businessDate:'2026-11-26'}));assert.equal(dated.timestamp,null);assert.equal(dated.historyDateOnly,'2026-11-26');
 for(const known of [exact,'2026-11-26T00:00:00+09:00',new Date(exact),new Date(exact).toUTCString()])assertInstant(actual.getHistoryTimeInfo([known]),millis);
 const input=order({createdAt:raw}),payload=actual.createCompletedOrderDocumentPayload(input);persisted(payload,baseline.createCompletedOrderDocumentPayload(input),'offsetless original writer');assert.equal(view(actual,payload).info.timestamp,null);
});
test('nonempty raw client receipt prevents treating an explicit valid business clock as a completion fallback',()=>{
 const valid='2026-11-26T00:01:00+09:00';for(const raw of ['2026-11-26T00:01:00','invalid-original-clock']){const input=order({createdAt:raw,businessAt:valid,processedAt:valid,statusUpdatedAt:valid}),payload=actual.createCompletedOrderDocumentPayload(input);persisted(payload,baseline.createCompletedOrderDocumentPayload(input),'raw client presence writer');assert(payload.orderLite.createdAt&&payload.orderLite.timestamp);assert.equal(payload.orderLite.businessAt,payload.orderLite.completedAt);assertInstant(view(actual,payload).info,Date.parse(valid));balances(payload);}
});
test('indistinguishable explicit and overwritten-processing date payloads both stay unknown unless retained precedence evidence proves independence',()=>{
 const server25={seconds:Date.parse('2026-11-25T14:59:59Z')/1000,nanoseconds:0},server26={seconds:Date.parse('2026-11-25T15:00:01Z')/1000,nanoseconds:0},recent='2026-11-26T00:01:00+09:00';
 const independent=order({businessDate:'2026-11-25',statusUpdatedAt:recent,completedAtServer:server25}),derived=order({completedAt:'2026-11-25T23:59:59+09:00',statusUpdatedAt:recent,completedAtServer:server25});delete independent.processedAt;delete derived.processedAt;
 const explicitPayload=actual.createCompletedOrderDocumentPayload(independent),derivedPayload=actual.createCompletedOrderDocumentPayload(derived);same(explicitPayload,derivedPayload,'Actual legacy writer erases the distinction');
 for(const[input,payload]of [[independent,explicitPayload],[derived,derivedPayload]]){persisted(payload,baseline.createCompletedOrderDocumentPayload(input),'ambiguous unchanged writer');const info=view(actual,payload).info;assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,'');balances(payload);}
 for(const retained of [{processedAtServer:server26},{processedAtServer:'invalid-preserved-processing-server'},{createdAtServer:'invalid-preserved-created-server'},{createdAtServerIso:'invalid-preserved-created-server-iso'}]){const withEvidence={...derived,businessDate:'2026-11-25',...retained},serverPayload=actual.createCompletedOrderDocumentPayload(withEvidence),noDeclaredDay=actual.createCompletedOrderDocumentPayload({...withEvidence,businessDate:''});persisted(serverPayload,baseline.createCompletedOrderDocumentPayload(withEvidence),'retained precedence writer');assert.equal(noDeclaredDay.businessDate,'2026-11-26');assert.equal(view(actual,serverPayload).info.historyDateOnly,'2026-11-25');}
 limits.push({name:'legacy overwritten completedAt versus explicit businessDate',status:'UNVERIFIED',reason:'The two source inputs produce identical persisted JSON. Both display unknown unless retained earlier-priority processing evidence proves the declared date is independent; stored reporting data is preserved.'});
});
test('compact Date.toString timezone-label truncation keeps baseline storage and restores the complete offset-bearing clock',()=>{
 const instant='2026-11-25T14:59:59.000Z',date=new Date(instant),input=order({timestamp:date,processedAt:'2026-11-26T01:00:00+09:00'}),compact=actual.createEmergencyCompactOrderRecord(input),old=baseline.createEmergencyCompactOrderRecord(input);
 persisted(compact,old,'Date compact creator');assert.equal(compact.t,date.toString().slice(0,40));assert.equal(compact.t.length,40);assert(compact.t.includes('GMT')&&compact.t.includes('(')&&!compact.t.endsWith(')'),'Fixture must end inside timezone label');same(Object.keys(compact).sort(),Object.keys(old).sort());
 const normalized=actual.normalizeEmergencyCompactOrderRecord(compact);persisted(normalized,baseline.normalizeEmergencyCompactOrderRecord(old),'Date compact normalizer');
 for(const value of [normalized,plain(normalized)]){const expanded=actual.expandEmergencyCompactHistoryOrderRecord(value);assertInstant(actual.getOrderHistoryTimeInfo(expanded),Date.parse(instant));assert.equal(actual.getOrderBusinessDateKey(expanded),baseline.getOrderBusinessDateKey({timestamp:old.t,createdAt:old.t}));}
 return {wholeSecondDateOnly:true,millisecondPrecisionClaim:false,storedKeys:Object.keys(plain(compact)).length,rawStoredStringUnchanged:true};
});
test('partial canonical Web SDK compact Timestamp proves only its Seoul day without inventing fractional time',()=>{
 const cases=[{seconds:Math.floor(Date.parse('2026-11-25T14:59:59Z')/1000),nanoseconds:123456789,day:'2026-11-25'},{seconds:0,nanoseconds:123456789,day:'1970-01-01'}];
 for(const c of cases){const raw=makeWebTimestamp(c.seconds,c.nanoseconds),input=order({timestamp:raw,processedAt:'2026-11-26T01:00:00+09:00'}),compact=actual.createEmergencyCompactOrderRecord(input),old=baseline.createEmergencyCompactOrderRecord(input);persisted(compact,old,'partial SDK compact creator');assert.equal(compact.t,raw.toString().slice(0,40));assert.equal(compact.t.length,40);assert.equal(Object.keys(plain(compact)).length,15);assert.notEqual(compact.t,compact.p);
  for(const value of [compact,plain(compact)]){const normalized=actual.normalizeEmergencyCompactOrderRecord(value);persisted(normalized,baseline.normalizeEmergencyCompactOrderRecord(value),'partial SDK normalizer');const expanded=actual.expandEmergencyCompactHistoryOrderRecord(normalized),info=actual.getOrderHistoryTimeInfo(expanded);assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,c.day);assert.equal(actual.getOrderBusinessDateKey(expanded),baseline.getOrderBusinessDateKey({timestamp:old.t,createdAt:old.t}));}
  const same=actual.normalizeEmergencyCompactOrderRecord({id:'same-partial',t:compact.t,p:compact.t,s:'C',q:2,r:17,c:[],i:[]}),unknown=actual.getOrderHistoryTimeInfo(actual.expandEmergencyCompactHistoryOrderRecord(plain(same)));assert.equal(unknown.timestamp,null);assert.equal(unknown.historyDateOnly,'');
 }
 const invalid=[makeWebTimestamp(9007199254740992,123456789).toString().slice(0,40),makeWebTimestamp(253402300800,123456789).toString().slice(0,40),makeWebTimestamp(8640000000001,123456789).toString().slice(0,40),('Timestamp(seconds='+'1'.repeat(22)),makeWebTimestamp(0,-123456789).toString().slice(0,40),makeWebTimestamp(0,123456789).toString().replace(', ','; ').slice(0,40)];
 for(const t of invalid){assert.equal(t.length,40);const compact=actual.normalizeEmergencyCompactOrderRecord({id:'invalid-partial',t,p:'2026-11-26T01:00:00+09:00',s:'C',q:2,r:17,c:[],i:[]}),info=actual.getOrderHistoryTimeInfo(actual.expandEmergencyCompactHistoryOrderRecord(plain(compact)));assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,'');persisted(compact,baseline.normalizeEmergencyCompactOrderRecord(compact),'invalid partial storage');}
 return {fractionalPrecision:'UNVERIFIED_NOT_RECONSTRUCTED',timestampAlwaysNull:true,dayOnly:true,storedKeys:15};
});
test('typed Web SDK processing and explicit raw-string dates serialize identically and both remain unknown',()=>{
 const millis=Date.parse('2026-11-25T14:59:59.123Z'),typed=makeWebTimestamp(Math.floor(millis/1000),123000000),raw=typed.toString(),typedInput=order({processedAt:typed}),explicitInput=order({processedAt:raw,businessDate:'2026-11-25'}),a=actual.createCompletedOrderDocumentPayload(typedInput),b=actual.createCompletedOrderDocumentPayload(explicitInput);
 same(a,b,'Typed-derived and raw-explicit inputs become identical JSON');for(const[input,payload]of [[typedInput,a],[explicitInput,b]]){persisted(payload,baseline.createCompletedOrderDocumentPayload(input),'typed processing writer');const info=view(actual,payload).info;assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,'');balances(payload);}
 const independent=actual.createCompletedOrderDocumentPayload(order({processedAt:raw,businessDate:'2026-11-27'}));assert.equal(view(actual,independent).info.historyDateOnly,'2026-11-27');
 const blocked=order({processedAt:raw,processedAtServer:'invalid-first-preserved-value',statusUpdatedAt:'2026-11-26T00:01:00+09:00',businessDate:'2026-11-25'}),p=actual.createCompletedOrderDocumentPayload(blocked);persisted(p,baseline.createCompletedOrderDocumentPayload(blocked),'invalid first precedence writer');assert.equal(view(actual,p).info.historyDateOnly,'2026-11-25');
 limits.push({name:'typed processing versus explicit raw-string origin',status:'UNVERIFIED',reason:'Both inputs have identical persisted JSON; same possible derived days stay unknown without changing stored fields. This evidence supersedes the old case34 same-day preservation oracle.'});
});
test('lowercase RFC3339 original receipt survives writer JSON reader without changing stored text',()=>{
 const instant=Date.parse('2026-11-25T14:59:59.123Z');for(const raw of ['2026-11-25t14:59:59.123z','2026-11-25t23:59:59.123+09:00']){const input=order({createdAt:raw}),payload=actual.createCompletedOrderDocumentPayload(input);persisted(payload,baseline.createCompletedOrderDocumentPayload(input),'lowercase original writer');assert.equal(payload.orderLite.createdAt,raw);assertInstant(view(actual,payload).info,instant);balances(payload);}
});
test('readonly live recovery cannot manufacture an original receipt through JSON clone and bulk archive writing',()=>{
 const time='2026-11-26T01:00:00+09:00',missing=order({processedAt:time}),genuine=order({timestamp:time,createdAt:time,businessAt:time,businessDate:'2026-11-26',processedAt:time});
 const outputs=[];for(const[input,label]of [[missing,'missing'],[genuine,'genuine']]){const payload=actual.buildCompletedPayloadFromLiveOrder(input,'live_order_roundtrip-order','2026-11-26');assert(payload);persisted(payload,baseline.buildCompletedPayloadFromLiveOrder(input,'live_order_roundtrip-order','2026-11-26'),'readonly recovery '+label);
  const normalized=actual.normalizeArchivedCompletedPayloadToOrder(payload),before=actual.getOrderHistoryTimeInfo(normalized);if(label==='missing'){assert.equal(before.timestamp,null);assert.equal(before.historyDateOnly,'');}else assertInstant(before,Date.parse(time));
  const cloned=plain(normalized),archive=actual.createCompletedOrderDocumentPayload(cloned,'order-completed-bulk-recovery');persisted(archive,baseline.createCompletedOrderDocumentPayload(cloned,'order-completed-bulk-recovery'),'bulk recovery '+label);balances(archive);outputs.push(archive);const after=view(actual,archive).info;assert.equal(after.timestamp,null);assert.equal(after.historyDateOnly,'');
 }
 same(outputs[0],outputs[1],'Genuine coincident clocks and generated fallback have identical legacy bulk-recovery JSON');
 limits.push({name:'bulk recovery generated receipt versus genuine equal clocks',status:'UNVERIFIED',reason:'Identical persisted JSON cannot prove the original client clock. Both display unknown without changing the bulk recovery writer or accounting fields; stronger independent live/server evidence can restore the view.'});
});
test('offsetless processing excludes only civil-zone possible derived days and preserves independent days',()=>{
 const cases=[{raw:'2026-11-26T01:00:00',possible:['2026-11-25','2026-11-26']},{raw:'2026-11-26T04:00:00',possible:['2026-11-25','2026-11-26','2026-11-27']},{raw:'2026-11-26T23:30:00',possible:['2026-11-26','2026-11-27']}],evidence=[];
 for(const c of cases){const withoutDay=order({processedAt:c.raw}),derived=actual.createCompletedOrderDocumentPayload(withoutDay);persisted(derived,baseline.createCompletedOrderDocumentPayload(withoutDay),'offsetless derived processing writer');balances(derived);assert(c.possible.includes(derived.businessDate),'Actual unchanged writer timezone output is within the independently bounded days');const info=view(actual,derived).info;assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,'');
  for(const day of ['2026-11-25','2026-11-26','2026-11-27','2026-11-20']){const input=order({processedAt:c.raw,businessDate:day}),payload=actual.createCompletedOrderDocumentPayload(input);persisted(payload,baseline.createCompletedOrderDocumentPayload(input),'offsetless declared processing writer');const candidate=view(actual,payload).info;assert.equal(candidate.timestamp,null);assert.equal(candidate.historyDateOnly,c.possible.includes(day)?'':day);}
  evidence.push({rawClock:c.raw,actualWriterDerivedDay:derived.businessDate,possibleDays:c.possible});
 }
 return {actualWriterZoneEvidence:evidence,known2026CivilOffsetBoundsMinutes:[-720,840],SeoulRelativeHourBounds:[-5,21],clockDisplayInvented:false};
});
test('global compact financial and closed consumers stay baseline-exact without history parsing',()=>{
 assert.equal(extracted.expandEmergencyCompactOrderRecord,baselineBodyHashes.expandEmergencyCompactOrderRecord,'Global expander body remains LF-byte-exact');
 const raw={id:'history-only-compact',u:'synthetic-only',p:'2026-11-26T01:00:00+09:00',s:'C',q:2,r:17,c:[],i:[]},settings={emergencyOrderCompactArchive:{records:[raw]}},savedActual={orders:actual.state.orders,settings:actual.state.sysSettings,archived:actual.state.userCouponArchivedOrdersByUserId},savedBaseline={orders:baseline.state.orders,settings:baseline.state.sysSettings,archived:baseline.state.userCouponArchivedOrdersByUserId},originalTime=actual.getHistoryTimeInfo,originalWrapper=actual.expandEmergencyCompactHistoryOrderRecord;let parses=0,wrappers=0;
 try{actual.state.orders=[];baseline.state.orders=[];actual.state.sysSettings=plain(settings);baseline.state.sysSettings=plain(settings);actual.state.userCouponArchivedOrdersByUserId={};baseline.state.userCouponArchivedOrdersByUserId={};actual.getHistoryTimeInfo=(...args)=>{parses++;return originalTime(...args);};actual.expandEmergencyCompactHistoryOrderRecord=(...args)=>{wrappers++;return originalWrapper(...args);};
  same(actual.expandEmergencyCompactOrderRecord(raw),baseline.expandEmergencyCompactOrderRecord(raw),'Global expanded fields');same(actual.getOrdersForStatsAndHistory(),baseline.getOrdersForStatsAndHistory(),'Global statistics compact values');same(actual.getEmergencyCompactCompletedOrdersForDate('2026-11-26'),baseline.getEmergencyCompactCompletedOrdersForDate('2026-11-26'),'Closed/archive compact values');assert.equal(parses,0,'Global consumers introduced display date parsing');assert.equal(wrappers,0,'Global consumers invoked history-only wrapper');
  const history=actual.getCouponHistoryOrdersForUser('synthetic-only');assert(wrappers>0,'History loader must invoke the actual history wrapper');assert.equal(history.length,1);const info=actual.getOrderHistoryTimeInfo(history[0]);assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,'');
 }finally{actual.getHistoryTimeInfo=originalTime;actual.expandEmergencyCompactHistoryOrderRecord=originalWrapper;actual.state.orders=savedActual.orders;actual.state.sysSettings=savedActual.settings;actual.state.userCouponArchivedOrdersByUserId=savedActual.archived;baseline.state.orders=savedBaseline.orders;baseline.state.sysSettings=savedBaseline.settings;baseline.state.userCouponArchivedOrdersByUserId=savedBaseline.archived;}
 return {globalDisplayParses:0,globalHistoryWrapperCalls:0,actualHistoryLoaderUsesWrapper:true};
});
test('UTC and Seoul produced offsetless processing archives remain unknown in every reader timezone',()=>{
 const utc=plain(crossTimezoneProcessingFixture.UTCpayload),seoul=plain(utc);seoul.businessDate=crossTimezoneProcessingFixture.KSTbusinessDate;seoul.orderLite.businessDate=crossTimezoneProcessingFixture.KSTbusinessDate;assert.equal(sha(JSON.stringify(utc)),crossTimezoneProcessingFixture.UTCpayloadSHA256);assert.equal(sha(JSON.stringify(seoul)),crossTimezoneProcessingFixture.KSTpayloadSHA256);
 for(const payload of [utc,seoul]){const before=JSON.stringify(payload),info=view(actual,payload).info;assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,'');assert.equal(JSON.stringify(payload),before);balances(payload);}
 const input=order({processedAt:'2026-11-26T23:30:00',completedAt:'2026-11-27T10:00:00+09:00',statusUpdatedAt:'2026-11-27T10:00:00+09:00'});persisted(actual.createCompletedOrderDocumentPayload(input),baseline.createCompletedOrderDocumentPayload(input),'current-zone unchanged processing writer');
 const blocked={...input,processedAtServer:'invalid-first-preserved-value',businessDate:'2026-11-26'},payload=actual.createCompletedOrderDocumentPayload(blocked),withoutDay=actual.createCompletedOrderDocumentPayload({...blocked,businessDate:''});persisted(payload,baseline.createCompletedOrderDocumentPayload(blocked),'invalid first blocks later offsetless writer');assert.equal(withoutDay.businessDate,'2026-11-27');const info=view(actual,payload).info;assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,'2026-11-26');
 return {UTCproducerAndSeoulProducerFixed:true,readerZoneIndependent:true,onlyFirstLegacyPrecedenceSelected:true,laterProcessingNotCollected:true};
});
test('history compact parsing filters unrelated users before the history wrapper',()=>{
 const unrelated=Array.from({length:8},(_,i)=>({id:'unrelated-compact-'+i,u:'other-synthetic-user',t:first,p:'2026-11-26T01:00:00+09:00',s:'C',q:2,r:17,c:[],i:[]})),saved={orders:actual.state.orders,settings:actual.state.sysSettings,archived:actual.state.userCouponArchivedOrdersByUserId},realTime=actual.getHistoryTimeInfo,realWrapper=actual.expandEmergencyCompactHistoryOrderRecord;let parses=0,wrappers=0;
 try{actual.state.orders=[];actual.state.sysSettings={emergencyOrderCompactArchive:{records:unrelated}};actual.state.userCouponArchivedOrdersByUserId={};actual.getHistoryTimeInfo=(...a)=>{parses++;return realTime(...a);};actual.expandEmergencyCompactHistoryOrderRecord=(...a)=>{wrappers++;return realWrapper(...a);};assert.equal(actual.getCouponHistoryOrdersForUser('synthetic-only').length,0);assert.equal(wrappers,0,'Unrelated compact records reached history wrapper');assert.equal(parses,0,'Unrelated compact records reached display parser');
  actual.state.sysSettings.emergencyOrderCompactArchive.records.push({id:'matching-compact',u:'synthetic-only',t:first,p:'2026-11-26T01:00:00+09:00',s:'C',q:2,r:17,c:[],i:[]});const rows=actual.getCouponHistoryOrdersForUser('synthetic-only');assert.equal(rows.length,1);assert.equal(wrappers,1,'Only one matching compact record is expanded for history');assertInstant(actual.getOrderHistoryTimeInfo(rows[0]),Date.parse(first));
 }finally{actual.getHistoryTimeInfo=realTime;actual.expandEmergencyCompactHistoryOrderRecord=realWrapper;actual.state.orders=saved.orders;actual.state.sysSettings=saved.settings;actual.state.userCouponArchivedOrdersByUserId=saved.archived;}
 return {unrelatedFixtures:8,unrelatedHistoryWrappers:0,unrelatedDisplayParses:0,matchingHistoryWrappers:1};
});
test('lowercase and 24-hour rollover processing retain cross-producer uncertainty while valid original rollover clocks remain exact',()=>{
 for(const f of processingClockCase49Fixtures){const payload=plain(crossTimezoneProcessingFixture.UTCpayload);payload.businessDate=f.businessDate;payload.orderLite.businessDate=f.businessDate;payload.orderLite.processedAt=f.processedAt;assert.equal(sha(JSON.stringify(payload)),f.payloadSHA256);const info=view(actual,payload).info;assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,'');balances(payload);}
 for(const[raw,expected]of [['2026-11-26T24:00:00Z','2026-11-27T00:00:00.000Z'],['2026-11-26t24:00:00.000+09:00','2026-11-26T15:00:00.000Z']]){const input=order({createdAt:raw}),payload=actual.createCompletedOrderDocumentPayload(input);persisted(payload,baseline.createCompletedOrderDocumentPayload(input),'original zero rollover writer');assert.equal(payload.orderLite.createdAt,raw);assertInstant(view(actual,payload).info,Date.parse(expected));}
 for(const raw of ['2026-11-26T24:00:00.001Z','2026-11-26T24:00:01Z','2026-11-26T24:01:00+09:00','2026-11-26T24:00:00.000000001Z']){const info=actual.getHistoryTimeInfo([raw]);assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,'');}
 return {actualProducerFixtures:processingClockCase49Fixtures.length,producerTimezones:4,storedClockAndDaysUnchanged:true};
});
test('mixed raw processing and typed SDK completion fallback cannot manufacture an independent receipt day',()=>{
 const firstTyped=makeWebTimestamp(Math.floor(Date.parse('2026-11-25T14:59:59Z')/1000),123000000),fallbackTyped=makeWebTimestamp(Math.floor(Date.parse('2026-11-27T01:00:00Z')/1000),456000000),firstRaw=firstTyped.toString(),fallbackRaw=fallbackTyped.toString(),mixed=order({processedAt:firstRaw,statusUpdatedAt:fallbackTyped}),explicit=order({processedAt:firstRaw,statusUpdatedAt:fallbackRaw,businessDate:'2026-11-27'}),a=actual.createCompletedOrderDocumentPayload(mixed),b=actual.createCompletedOrderDocumentPayload(explicit);
 same(a,b,'Mixed typed-fallback derived date and literal explicit date have identical persisted JSON');assert.equal(a.businessDate,'2026-11-27');for(const[input,payload]of [[mixed,a],[explicit,b]]){persisted(payload,baseline.createCompletedOrderDocumentPayload(input),'mixed fallback writer');const info=view(actual,payload).info;assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,'');balances(payload);}
 const selectedTyped=order({processedAt:firstTyped,statusUpdatedAt:fallbackTyped}),selectedPayload=actual.createCompletedOrderDocumentPayload(selectedTyped);assert.equal(selectedPayload.businessDate,'2026-11-25');assert.equal(view(actual,selectedPayload).info.historyDateOnly,'');
 const independent=order({processedAt:firstRaw,statusUpdatedAt:fallbackRaw,businessDate:'2026-11-26'}),p=actual.createCompletedOrderDocumentPayload(independent);persisted(p,baseline.createCompletedOrderDocumentPayload(independent),'mixed independent date writer');assert.equal(view(actual,p).info.historyDateOnly,'2026-11-26');
 const blocked=order({processedAt:firstRaw,processedAtServer:'invalid-first-preserved-value',statusUpdatedAt:fallbackTyped,businessDate:'2026-11-25'}),q=actual.createCompletedOrderDocumentPayload(blocked);persisted(q,baseline.createCompletedOrderDocumentPayload(blocked),'mixed invalid first writer');assert.equal(view(actual,q).info.historyDateOnly,'2026-11-25');
 return {independentRawRestoredFallbackInterpretations:true,onlyFirstPrecedenceSelected:true,independentMiddleDayRetained:true};
});

const family51ProducerFixtures=[{"mode":"comment","producerTimezone":"Asia/Seoul","processedAt":"11/26/2026 23:30:00 (GMT)","businessDate":"2026-11-26","payloadSHA256":"1bf7caa926112824b366ffb7b9b60cee793ce6f318cecd1bbe4552ae0cbc015e"},{"mode":"comment","producerTimezone":"Etc/GMT+12","processedAt":"11/26/2026 23:30:00 (GMT)","businessDate":"2026-11-27","payloadSHA256":"618ff85d2f065d9c568a6da11a1d0b3b2d30a50d5ad4af6271639df289547e63"},{"mode":"comment","producerTimezone":"Pacific/Kiritimati","processedAt":"11/26/2026 23:30:00 (GMT)","businessDate":"2026-11-26","payloadSHA256":"1bf7caa926112824b366ffb7b9b60cee793ce6f318cecd1bbe4552ae0cbc015e"},{"mode":"comment","producerTimezone":"UTC","processedAt":"11/26/2026 23:30:00 (GMT)","businessDate":"2026-11-27","payloadSHA256":"618ff85d2f065d9c568a6da11a1d0b3b2d30a50d5ad4af6271639df289547e63"},{"mode":"mdy","producerTimezone":"Asia/Seoul","processedAt":"11/26/2026 23:30:00","businessDate":"2026-11-26","payloadSHA256":"5d71951a3aa5795180cecf8002b9d6ea06dd875d16fea97a841678e2f46d46dc"},{"mode":"mdy","producerTimezone":"Etc/GMT+12","processedAt":"11/26/2026 23:30:00","businessDate":"2026-11-27","payloadSHA256":"83b57134a752d88e442ecead8a03d02fc600d94e109398d176609048e898d42e"},{"mode":"mdy","producerTimezone":"Pacific/Kiritimati","processedAt":"11/26/2026 23:30:00","businessDate":"2026-11-26","payloadSHA256":"5d71951a3aa5795180cecf8002b9d6ea06dd875d16fea97a841678e2f46d46dc"},{"mode":"mdy","producerTimezone":"UTC","processedAt":"11/26/2026 23:30:00","businessDate":"2026-11-27","payloadSHA256":"83b57134a752d88e442ecead8a03d02fc600d94e109398d176609048e898d42e"},{"mode":"month","producerTimezone":"Asia/Seoul","processedAt":"November 26, 2026 23:30:00","businessDate":"2026-11-26","payloadSHA256":"32f13f7b9f6031824d35aa29fff2e2eb00aa55b65aa4dbeb8f167210fc84685e"},{"mode":"month","producerTimezone":"Etc/GMT+12","processedAt":"November 26, 2026 23:30:00","businessDate":"2026-11-27","payloadSHA256":"b30a3d2c4266ca2d7c441b7b7ea151ecf9db499b1a10b9dfad23c24a9bcbcd14"},{"mode":"month","producerTimezone":"Pacific/Kiritimati","processedAt":"November 26, 2026 23:30:00","businessDate":"2026-11-26","payloadSHA256":"32f13f7b9f6031824d35aa29fff2e2eb00aa55b65aa4dbeb8f167210fc84685e"},{"mode":"month","producerTimezone":"UTC","processedAt":"November 26, 2026 23:30:00","businessDate":"2026-11-27","payloadSHA256":"b30a3d2c4266ca2d7c441b7b7ea151ecf9db499b1a10b9dfad23c24a9bcbcd14"}];
test('processing local MDY month and comment clocks use bounded civil days without changing JSON',()=>{
 for(const f of family51ProducerFixtures){const p=plain(crossTimezoneProcessingFixture.UTCpayload);p.businessDate=f.businessDate;p.orderLite.businessDate=f.businessDate;p.orderLite.processedAt=f.processedAt;assert.equal(sha(JSON.stringify(p)),f.payloadSHA256,'Actual baseline producer fixture changed');const i=view(actual,p).info;assert.equal(i.timestamp,null);assert.equal(i.historyDateOnly,'');balances(p);}
 const zones=[['11/26/2026 23:30:00 GMT','2026-11-27','2026-11-26'],['November 26, 2026 23:30:00 UTC','2026-11-27','2026-11-26'],['Nov 26 2026 23:30:00 UT','2026-11-27','2026-11-26'],['2026-11-26T23:30:00Z','2026-11-27','2026-11-26'],['Nov 26 2026 23:30:00 PST','2026-11-27','2026-11-26'],['11/26/2026 23:30:00 -1200','2026-11-27','2026-11-26'],['11/26/2026 23:30:00 +1400','2026-11-26','2026-11-25'],['November 26, 2026 23:30:00 gmt','2026-11-27','2026-11-26']];
 for(const[raw,derived,independent]of zones){assert.equal(actual.getDateString(raw),derived);const o=order({processedAt:raw,statusUpdatedAt:'2026-11-27T10:00:00+09:00',businessDate:independent}),p=actual.createCompletedOrderDocumentPayload(o);persisted(p,baseline.createCompletedOrderDocumentPayload(o),'explicit-zone processing writer');assert.equal(view(actual,p).info.historyDateOnly,independent);}
 for(const day of ['2026-11-20','2026-11-25','2026-11-26','2026-11-27']){const o=order({processedAt:'2026-11-26',statusUpdatedAt:'2026-11-27T10:00:00+09:00',businessDate:day}),p=actual.createCompletedOrderDocumentPayload(o);persisted(p,baseline.createCompletedOrderDocumentPayload(o),'ISO date-only processing writer');assert.equal(view(actual,p).info.historyDateOnly,['2026-11-26','2026-11-27'].includes(day)?'':day);}
 const explicitFallback=order({processedAt:'11/26/2026 23:30:00 +1400',statusUpdatedAt:'2026-11-27T10:00:00+09:00',businessDate:'2026-11-27'}),erasedFirst=order({processedAt:'11/26/2026 23:30:00 +1400',statusUpdatedAt:'2026-11-27T10:00:00+09:00',businessAtServer:0}),explicitPayload=actual.createCompletedOrderDocumentPayload(explicitFallback),erasedPayload=actual.createCompletedOrderDocumentPayload(erasedFirst);same(explicitPayload,erasedPayload,'Explicit-zone selected26 plus fallback27 cannot distinguish explicit27 from erased-first fallback27');for(const[o,p]of [[explicitFallback,explicitPayload],[erasedFirst,erasedPayload]]){persisted(p,baseline.createCompletedOrderDocumentPayload(o),'case51 lost-falsy writer');assert.equal(view(actual,p).info.historyDateOnly,'');}
 const receipt=order({createdAt:'Thu, 26 Nov 2026 23:30:00 gmt'}),p=actual.createCompletedOrderDocumentPayload(receipt);persisted(p,baseline.createCompletedOrderDocumentPayload(receipt),'lowercase GMT original receipt writer');assertInstant(view(actual,p).info,Date.parse('2026-11-26T23:30:00Z'));
 return {actualProducerFixtures:family51ProducerFixtures.length,producerTimezones:4,explicitZones:zones.length,ISODateOnlyGuard:true,storedFieldsUnchanged:true};
});
test('canonical typed millisecond and true origins cannot become original days after JSON',()=>{
 const ms=Date.parse('2026-11-25T14:59:59.123Z');
 for(const[typed,raw,day]of [[ms,String(ms),'2026-11-25'],[true,'true','1970-01-01']]){const a=order({processedAt:typed}),b=order({processedAt:raw,businessDate:day}),pa=actual.createCompletedOrderDocumentPayload(a),pb=actual.createCompletedOrderDocumentPayload(b);same(pa,pb,'Typed and literal processing produce indistinguishable persisted JSON');assert.equal(pa.businessDate,day);for(const[o,p]of [[a,pa],[b,pb]]){persisted(p,baseline.createCompletedOrderDocumentPayload(o),'canonical typed-origin writer');const i=view(actual,p).info;assert.equal(i.timestamp,null);assert.equal(i.historyDateOnly,'');balances(p);}const far=order({processedAt:raw,businessDate:'2026-11-20'}),p=actual.createCompletedOrderDocumentPayload(far);persisted(p,baseline.createCompletedOrderDocumentPayload(far),'independent far-day numeric writer');assert.equal(view(actual,p).info.historyDateOnly,'2026-11-20');}
 return {numericAndTrueIdenticalJSONPairs:2,noFalseOrZeroTypedHypothesis:true,independentFarDayRetained:true};
});
test('opaque serialized supported timestamp maps cannot confirm declared processing days',()=>{
 const ms=Date.parse('2026-11-25T14:59:59.123Z'),map={seconds:Math.floor(ms/1000),nanoseconds:123000000},laterMap={seconds:Math.floor(Date.parse('2026-11-27T01:00:00Z')/1000),nanoseconds:0};
 const pairs=[[order({processedAt:map}),order({processedAt:'[object Object]',businessDate:'2026-11-25'}),'2026-11-25'],[order({processedAt:'invalid-first',statusUpdatedAt:laterMap}),order({processedAt:'invalid-first',statusUpdatedAt:'[object Object]',businessDate:'2026-11-27'}),'2026-11-27']];
 for(const[a,b,day]of pairs){const pa=actual.createCompletedOrderDocumentPayload(a),pb=actual.createCompletedOrderDocumentPayload(b);same(pa,pb,'Opaque typed and literal sources have identical persisted JSON');assert.equal(pa.businessDate,day);for(const[o,p]of [[a,pa],[b,pb]]){persisted(p,baseline.createCompletedOrderDocumentPayload(o),'opaque writer');const i=view(actual,p).info;assert.equal(i.timestamp,null);assert.equal(i.historyDateOnly,'');balances(p);}}
 const firstValid=order({processedAtServer:map,processedAt:laterMap,statusUpdatedAt:laterMap,businessDate:'2026-11-26'}),p=actual.createCompletedOrderDocumentPayload(firstValid);persisted(p,baseline.createCompletedOrderDocumentPayload(firstValid),'valid first before unused opaque fallback writer');assert.equal(view(actual,p).info.historyDateOnly,'','Opaque fallback can have a different erased original day despite a preserved first processing clock');
 const independent=order({businessAt:'2026-11-26T08:00:00+09:00',processedAt:laterMap,statusUpdatedAt:'2026-11-27T10:00:00+09:00'}),q=actual.createCompletedOrderDocumentPayload(independent);persisted(q,baseline.createCompletedOrderDocumentPayload(independent),'independent original business clock writer');assertInstant(view(actual,q).info,Date.parse('2026-11-26T08:00:00+09:00'));
 const receipt=order({createdAtServer:map,processedAt:laterMap,statusUpdatedAt:laterMap}),r=actual.createCompletedOrderDocumentPayload(receipt);persisted(r,baseline.createCompletedOrderDocumentPayload(receipt),'server receipt before opaque processing writer');assertInstant(view(actual,r).info,ms);
 return {opaqueIdenticalJSONPairs:pairs.length,opaqueFallbackRemainsUnresolvedDespiteValidFirst:true,independentOriginalBusinessClock:true,actualServerReceiptPreserved:true};
});
test('typed-origin restoration requires exact canonical strings and excludes falsy numeric zero',()=>{
 const ms=Date.parse('2026-11-25T14:59:59.123Z'),sec=Math.floor(ms/1000),ns=123000000,canonical=makeWebTimestamp(sec,ns).toString();
 const negatives=[[' '+canonical+' ','2026-11-25'],[canonical.replace('seconds='+sec,'seconds=0'+sec),'2026-11-25'],[canonical.replace('nanoseconds='+ns,'nanoseconds=0'+ns),'2026-11-25'],['Timestamp(seconds=-0, nanoseconds=123000000)','1970-01-01'],['0'+String(ms),'2026-11-25'],[' '+String(ms)+' ','2026-11-25'],['0','1970-01-01']];
 for(const[raw,day]of negatives){const o=order({processedAt:raw,statusUpdatedAt:'2026-11-27T10:00:00+09:00',businessDate:day}),p=actual.createCompletedOrderDocumentPayload(o);persisted(p,baseline.createCompletedOrderDocumentPayload(o),'noncanonical typed-origin negative writer');const i=view(actual,p).info;assert.equal(i.timestamp,null);assert.equal(i.historyDateOnly,day,'Noncanonical string must not invent typed-origin day');}
 const zero=order({processedAt:0}),p=actual.createCompletedOrderDocumentPayload(zero);persisted(p,baseline.createCompletedOrderDocumentPayload(zero),'falsy numeric zero writer');assert.equal(p.orderLite.processedAt,'');
 const sdkZero=order({processedAt:makeWebTimestamp(0,ns).toString(),statusUpdatedAt:'2026-11-27T10:00:00+09:00',businessDate:'1970-01-01'}),q=actual.createCompletedOrderDocumentPayload(sdkZero);persisted(q,baseline.createCompletedOrderDocumentPayload(sdkZero),'truthy canonical SDK zero writer');assert.equal(view(actual,q).info.historyDateOnly,'');
 return {noncanonicalNegatives:negatives.length,numericZeroFalsy:true,SDKZeroObjectTruthinessKept:true,storedFieldsUnchanged:true};
});


// Native16: existing 54 are retained. Oracles 33/51/53 are corrected only after
// exact complete-JSON counterpairs: erased-first fallback25/27, opaque fallback26.
const native16ProducerFixtures=[{"mode":"leadingPST","producerTimezone":"UTC","raw":"PST November 26, 2026 23:30:00","completionClock":"2026-11-27T10:00:00+09:00","businessDate":"2026-11-27","payloadSHA256":"80cf102014b37b9bd83d55d079723e18067acaa6c8935584c2919d89ed219fe8"},{"mode":"leadingPST","producerTimezone":"UTC","raw":"PST November 26, 2026 23:30:00","completionClock":"2026-11-30T10:00:00+09:00","businessDate":"2026-11-27","payloadSHA256":"1821e1dbd2ace5604daab01dbe0de3809ed22876f238b9a74f055adb79257be3"},{"mode":"timeFirst","producerTimezone":"UTC","raw":"23:30:00 2026-11-26","completionClock":"2026-11-27T10:00:00+09:00","businessDate":"2026-11-27","payloadSHA256":"d4d108342ce64326f23b14f013f4ed69900d46fe0a1b5618847d8f3058f0ec31"},{"mode":"timeFirst","producerTimezone":"UTC","raw":"23:30:00 2026-11-26","completionClock":"2026-11-30T10:00:00+09:00","businessDate":"2026-11-27","payloadSHA256":"d8c83806a598bd855339e710f562839c3db5a7a259b4d9ba8ee5659b5f3d3af1"},{"mode":"NULsuffix","producerTimezone":"UTC","raw":"2026-11-26T03:30:00\u0000","completionClock":"2026-11-27T10:00:00+09:00","businessDate":"2026-11-26","payloadSHA256":"eaeffa4d1cd111ceb287c09d89b3c11178494463ba401dca620ee25d0e4ffb17"},{"mode":"NULsuffix","producerTimezone":"UTC","raw":"2026-11-26T03:30:00\u0000","completionClock":"2026-11-30T10:00:00+09:00","businessDate":"2026-11-26","payloadSHA256":"7365f58a145a5a81768fde17b847471d70a06f6f254e97cebb536c97e748233e"},{"mode":"leadingPST","producerTimezone":"Asia/Seoul","raw":"PST November 26, 2026 23:30:00","completionClock":"2026-11-27T10:00:00+09:00","businessDate":"2026-11-26","payloadSHA256":"a143cb254187fd8f2d592ec11303b6ecbc357119460530a31ab1accf73c840b0"},{"mode":"leadingPST","producerTimezone":"Asia/Seoul","raw":"PST November 26, 2026 23:30:00","completionClock":"2026-11-30T10:00:00+09:00","businessDate":"2026-11-26","payloadSHA256":"12a8c47163d41b0e3db23a5d1ba3134381d1be7cc527f1cab90f0943a133c740"},{"mode":"timeFirst","producerTimezone":"Asia/Seoul","raw":"23:30:00 2026-11-26","completionClock":"2026-11-27T10:00:00+09:00","businessDate":"2026-11-26","payloadSHA256":"e67e55fc64c3f4bdb29e9884fa74f78a58cd558fb144018a4f1176454dabb590"},{"mode":"timeFirst","producerTimezone":"Asia/Seoul","raw":"23:30:00 2026-11-26","completionClock":"2026-11-30T10:00:00+09:00","businessDate":"2026-11-26","payloadSHA256":"a7b790d4eafdc58b23b1223ea410814e628e5531d0b1b84611ee8fd8222b3f14"},{"mode":"NULsuffix","producerTimezone":"Asia/Seoul","raw":"2026-11-26T03:30:00\u0000","completionClock":"2026-11-27T10:00:00+09:00","businessDate":"2026-11-26","payloadSHA256":"eaeffa4d1cd111ceb287c09d89b3c11178494463ba401dca620ee25d0e4ffb17"},{"mode":"NULsuffix","producerTimezone":"Asia/Seoul","raw":"2026-11-26T03:30:00\u0000","completionClock":"2026-11-30T10:00:00+09:00","businessDate":"2026-11-26","payloadSHA256":"7365f58a145a5a81768fde17b847471d70a06f6f254e97cebb536c97e748233e"},{"mode":"leadingPST","producerTimezone":"Pacific/Kiritimati","raw":"PST November 26, 2026 23:30:00","completionClock":"2026-11-27T10:00:00+09:00","businessDate":"2026-11-26","payloadSHA256":"a143cb254187fd8f2d592ec11303b6ecbc357119460530a31ab1accf73c840b0"},{"mode":"leadingPST","producerTimezone":"Pacific/Kiritimati","raw":"PST November 26, 2026 23:30:00","completionClock":"2026-11-30T10:00:00+09:00","businessDate":"2026-11-26","payloadSHA256":"12a8c47163d41b0e3db23a5d1ba3134381d1be7cc527f1cab90f0943a133c740"},{"mode":"timeFirst","producerTimezone":"Pacific/Kiritimati","raw":"23:30:00 2026-11-26","completionClock":"2026-11-27T10:00:00+09:00","businessDate":"2026-11-26","payloadSHA256":"e67e55fc64c3f4bdb29e9884fa74f78a58cd558fb144018a4f1176454dabb590"},{"mode":"timeFirst","producerTimezone":"Pacific/Kiritimati","raw":"23:30:00 2026-11-26","completionClock":"2026-11-30T10:00:00+09:00","businessDate":"2026-11-26","payloadSHA256":"a7b790d4eafdc58b23b1223ea410814e628e5531d0b1b84611ee8fd8222b3f14"},{"mode":"NULsuffix","producerTimezone":"Pacific/Kiritimati","raw":"2026-11-26T03:30:00\u0000","completionClock":"2026-11-27T10:00:00+09:00","businessDate":"2026-11-25","payloadSHA256":"4166e9ccc417418852623c95198cd772d2007e834a7b3fde61bdf26e599f8b36"},{"mode":"NULsuffix","producerTimezone":"Pacific/Kiritimati","raw":"2026-11-26T03:30:00\u0000","completionClock":"2026-11-30T10:00:00+09:00","businessDate":"2026-11-25","payloadSHA256":"ecf7da4299e5d6dbb6231f69be182ddc5cd910a6ad6336a3b57f397705656976"},{"mode":"leadingPST","producerTimezone":"Etc/GMT+12","raw":"PST November 26, 2026 23:30:00","completionClock":"2026-11-27T10:00:00+09:00","businessDate":"2026-11-27","payloadSHA256":"80cf102014b37b9bd83d55d079723e18067acaa6c8935584c2919d89ed219fe8"},{"mode":"leadingPST","producerTimezone":"Etc/GMT+12","raw":"PST November 26, 2026 23:30:00","completionClock":"2026-11-30T10:00:00+09:00","businessDate":"2026-11-27","payloadSHA256":"1821e1dbd2ace5604daab01dbe0de3809ed22876f238b9a74f055adb79257be3"},{"mode":"timeFirst","producerTimezone":"Etc/GMT+12","raw":"23:30:00 2026-11-26","completionClock":"2026-11-27T10:00:00+09:00","businessDate":"2026-11-27","payloadSHA256":"d4d108342ce64326f23b14f013f4ed69900d46fe0a1b5618847d8f3058f0ec31"},{"mode":"timeFirst","producerTimezone":"Etc/GMT+12","raw":"23:30:00 2026-11-26","completionClock":"2026-11-30T10:00:00+09:00","businessDate":"2026-11-27","payloadSHA256":"d8c83806a598bd855339e710f562839c3db5a7a259b4d9ba8ee5659b5f3d3af1"},{"mode":"NULsuffix","producerTimezone":"Etc/GMT+12","raw":"2026-11-26T03:30:00\u0000","completionClock":"2026-11-27T10:00:00+09:00","businessDate":"2026-11-27","payloadSHA256":"070b22d39e6a909c9a347fa4941c85a752dce3849eeb446f87c088f7cc1fcfaf"},{"mode":"NULsuffix","producerTimezone":"Etc/GMT+12","raw":"2026-11-26T03:30:00\u0000","completionClock":"2026-11-30T10:00:00+09:00","businessDate":"2026-11-27","payloadSHA256":"445c4d6a5a5dc0192fcabcf4b9b33f21eb680726f4dcd87ede53c296dc3b22bb"},{"mode":"leadingPST","producerTimezone":"America/New_York","raw":"PST November 26, 2026 23:30:00","completionClock":"2026-11-27T10:00:00+09:00","businessDate":"2026-11-27","payloadSHA256":"80cf102014b37b9bd83d55d079723e18067acaa6c8935584c2919d89ed219fe8"},{"mode":"leadingPST","producerTimezone":"America/New_York","raw":"PST November 26, 2026 23:30:00","completionClock":"2026-11-30T10:00:00+09:00","businessDate":"2026-11-27","payloadSHA256":"1821e1dbd2ace5604daab01dbe0de3809ed22876f238b9a74f055adb79257be3"},{"mode":"timeFirst","producerTimezone":"America/New_York","raw":"23:30:00 2026-11-26","completionClock":"2026-11-27T10:00:00+09:00","businessDate":"2026-11-27","payloadSHA256":"d4d108342ce64326f23b14f013f4ed69900d46fe0a1b5618847d8f3058f0ec31"},{"mode":"timeFirst","producerTimezone":"America/New_York","raw":"23:30:00 2026-11-26","completionClock":"2026-11-30T10:00:00+09:00","businessDate":"2026-11-27","payloadSHA256":"d8c83806a598bd855339e710f562839c3db5a7a259b4d9ba8ee5659b5f3d3af1"},{"mode":"NULsuffix","producerTimezone":"America/New_York","raw":"2026-11-26T03:30:00\u0000","completionClock":"2026-11-27T10:00:00+09:00","businessDate":"2026-11-26","payloadSHA256":"eaeffa4d1cd111ceb287c09d89b3c11178494463ba401dca620ee25d0e4ffb17"},{"mode":"NULsuffix","producerTimezone":"America/New_York","raw":"2026-11-26T03:30:00\u0000","completionClock":"2026-11-30T10:00:00+09:00","businessDate":"2026-11-26","payloadSHA256":"7365f58a145a5a81768fde17b847471d70a06f6f254e97cebb536c97e748233e"}];
const native16NYCompactFixture={"instant":"2026-11-25T14:59:59.000Z","rawDateString":"Wed Nov 25 2026 09:59:59 GMT-0500 (미 동부 표준시)","compact":{"v":1,"id":"roundtrip-order","n":"synthetic-17","sq":"17","u":"synthetic-only","un":"","ud":"","t":"Wed Nov 25 2026 09:59:59 GMT-0500 (미 동부 ","p":"2026-11-26T01:00:00+09:00","s":"P","d":"P","q":2,"r":17,"c":[],"i":[]},"compactSHA256":"524b6beba6f590f5d5d7a3ba560913ce2337119ae729036b0a1d19a6e2415c2f"};
test('erased falsy first clocks make genuine fallback days ambiguous without changing stored JSON',()=>{
 const processing='2026-11-25T10:00:00+09:00',completion='2026-11-27T10:00:00+09:00';let pairs=0;
 for(const field of ['businessAtServer','businessAtServerIso','createdAtServer','createdAtServerIso','businessAt','createdAt','timestamp','receivedAt','processedAtServer','processedAtServerIso'])for(const lost of [0,false]){
  const a=order({processedAt:processing,statusUpdatedAt:completion,[field]:lost}),b=order({processedAt:processing,statusUpdatedAt:completion,businessDate:'2026-11-27'}),pa=actual.createCompletedOrderDocumentPayload(a),pb=actual.createCompletedOrderDocumentPayload(b);
  assert.equal(actual.getOrderBusinessTimestamp(a),lost);assert.equal(actual.getOrderBusinessDateKey(a),'');same(pa,pb,'Lost falsy first and explicit fallback day have identical full stored JSON');
  for(const[o,p]of [[a,pa],[b,pb]]){persisted(p,baseline.createCompletedOrderDocumentPayload(o),'lost falsy first writer');const i=view(actual,p).info;assert.equal(i.timestamp,null);assert.equal(i.historyDateOnly,'');balances(p);}pairs++;
 }
 const map25={seconds:Math.floor(Date.parse(processing)/1000),nanoseconds:0},map26={seconds:Math.floor(Date.parse('2026-11-26T10:00:00+09:00')/1000),nanoseconds:0},map27={seconds:Math.floor(Date.parse(completion)/1000),nanoseconds:0};
 const a=order({processedAtServer:map25,processedAt:map27,statusUpdatedAt:map26,businessAtServer:0}),b=order({processedAtServer:map25,processedAt:map27,statusUpdatedAt:map27,businessDate:'2026-11-26'}),pa=actual.createCompletedOrderDocumentPayload(a),pb=actual.createCompletedOrderDocumentPayload(b);
 same(pa,pb,'Preserved valid first and opaque fallback26/27 still have identical full stored JSON');for(const[o,p]of [[a,pa],[b,pb]]){persisted(p,baseline.createCompletedOrderDocumentPayload(o),'opaque fallback after erased first writer');assert.equal(view(actual,p).info.historyDateOnly,'');}
 for(const day of ['2026-11-26','2026-11-20']){const o=order({processedAt:processing,statusUpdatedAt:completion,businessDate:day}),p=actual.createCompletedOrderDocumentPayload(o);persisted(p,baseline.createCompletedOrderDocumentPayload(o),'known independent day writer');assert.equal(view(actual,p).info.historyDateOnly,day);}
 return {lostFalsyIdenticalJSONPairs:pairs,opaqueFallbackIdenticalJSONPair:true,independent26AndFar20Retained:true,priorOpaqueOracleCorrectedByCounterproof:true};
});
test('parser-role zones time-first dates and ignored NUL suffixes cannot confirm local processing days',()=>{
 for(const f of native16ProducerFixtures){const p=JSON.parse(JSON.stringify(crossTimezoneProcessingFixture.UTCpayload).split('2026-11-27T10:00:00+09:00').join(f.completionClock));p.businessDate=f.businessDate;p.orderLite.businessDate=f.businessDate;p.orderLite.processedAt=f.raw;assert.equal(sha(JSON.stringify(p)),f.payloadSHA256);const i=view(actual,p).info;assert.equal(i.timestamp,null);assert.equal(i.historyDateOnly,'');balances(p);}
 for(const raw of ['PST November 26, 2026 23:30:00','23:30:00 2026-11-26','2026-11-26T03:30:00\u0000']){const o=order({processedAt:raw,statusUpdatedAt:'2026-11-27T10:00:00+09:00',businessDate:'2026-11-20'}),p=actual.createCompletedOrderDocumentPayload(o);persisted(p,baseline.createCompletedOrderDocumentPayload(o),'role-sensitive local clock writer');assert.equal(view(actual,p).info.historyDateOnly,'2026-11-20');}
 return {actualProducerFixtures:native16ProducerFixtures.length,producerTimezones:5,originalNov27CompletionPreserved:true,separateNov30CompletionGuard:true,noManufacturedDisplayClock:true};
});
test('raw server processing values retain literal provenance instead of invented typed origins',()=>{
 const canonical=makeWebTimestamp(Math.floor(Date.parse('2026-11-25T14:59:59Z')/1000),123000000).toString();
 for(const[raw,day]of [['[object Object]','2026-11-20'],[canonical,'2026-11-25'],['true','1970-01-01'],[String(Date.parse('2026-11-25T14:59:59Z')),'2026-11-25']]){
  const o=order({processedAtServer:raw,processedAt:'2026-11-27T10:00:00+09:00',statusUpdatedAt:'2026-11-27T10:00:00+09:00',businessDate:day}),p=actual.createCompletedOrderDocumentPayload(o);persisted(p,baseline.createCompletedOrderDocumentPayload(o),'raw server literal writer');assert.equal(p.orderProcessedAtServer,raw);const i=view(actual,p).info;assert.equal(i.timestamp,null);assert.equal(i.historyDateOnly,day);
 }
 return {rawServerLiteralCases:4,noStringCastOnRawServerField:true};
});
test('Web SDK nanosecond float at Seoul midnight excludes its actual writer day only',()=>{
 const seconds=Math.floor(Date.parse('2026-11-25T15:00:00Z')/1000)-1,nanoseconds=999999999,typed=makeWebTimestamp(seconds,nanoseconds),raw=typed.toString();
 assert.equal(typed.toDate().getTime(),Date.parse('2026-11-25T15:00:00Z'),'Web SDK seconds*1000+nanos/1e6 rounds this one-nanosecond boundary');
 const a=order({processedAt:typed,statusUpdatedAt:'2026-11-27T10:00:00+09:00'}),b=order({processedAt:raw,statusUpdatedAt:'2026-11-27T10:00:00+09:00',businessDate:'2026-11-26'}),pa=actual.createCompletedOrderDocumentPayload(a),pb=actual.createCompletedOrderDocumentPayload(b);same(pa,pb,'Web SDK typed rounded date and literal explicit date have identical full stored JSON');assert.equal(pa.businessDate,'2026-11-26');
 for(const[o,p]of [[a,pa],[b,pb]]){persisted(p,baseline.createCompletedOrderDocumentPayload(o),'Web SDK one-nanosecond processing writer');const i=view(actual,p).info;assert.equal(i.timestamp,null);assert.equal(i.historyDateOnly,'');}
 const independent=order({processedAt:raw,statusUpdatedAt:'2026-11-27T10:00:00+09:00',businessDate:'2026-11-25'}),p=actual.createCompletedOrderDocumentPayload(independent);persisted(p,baseline.createCompletedOrderDocumentPayload(independent),'provable day before rounded processing writer');assert.equal(view(actual,p).info.historyDateOnly,'2026-11-25');
 const typedJSON={...typed,toJSON(){return {type:'firestore/timestamp/1.0',seconds,nanoseconds};}},map=plain(typedJSON);
 for(const day of ['2026-11-25','2026-11-26']){const typedInput=order({processedAtServer:typedJSON,processedAt:'2026-11-27T10:00:00+09:00',statusUpdatedAt:'2026-11-27T10:00:00+09:00',...(day==='2026-11-25'?{businessDate:day}:{})}),mapInput=order({processedAtServer:map,processedAt:'2026-11-27T10:00:00+09:00',statusUpdatedAt:'2026-11-27T10:00:00+09:00',...(day==='2026-11-26'?{businessDate:day}:{})}),tp=actual.createCompletedOrderDocumentPayload(typedInput),mp=actual.createCompletedOrderDocumentPayload(mapInput);same(tp,mp,'Raw Web SDK prototype-erased map has identical full JSON for derived or explicit day '+day);for(const[o,q]of [[typedInput,tp],[mapInput,mp]]){persisted(q,baseline.createCompletedOrderDocumentPayload(o),'raw SDK map boundary writer');assert.equal(view(actual,q).info.historyDateOnly,'');}}
 const mapFar=order({processedAtServer:map,processedAt:'2026-11-27T10:00:00+09:00',statusUpdatedAt:'2026-11-27T10:00:00+09:00',businessDate:'2026-11-20'}),mapFarPayload=actual.createCompletedOrderDocumentPayload(mapFar);persisted(mapFarPayload,baseline.createCompletedOrderDocumentPayload(mapFar),'raw map independent far day writer');assert.equal(view(actual,mapFarPayload).info.historyDateOnly,'2026-11-20');
 const trueMillis=Date.parse('2026-11-25T14:59:59.999Z');for(const value of [typed,map,raw])assertInstant(actual.getHistoryTimeInfo([value]),trueMillis);
 const receipt=order({createdAtServer:typed,processedAt:'2026-11-27T10:00:00+09:00'});assertInstant(actual.getOrderHistoryTimeInfo(receipt),trueMillis);assert.equal(actual.getOrderBusinessDateKey(receipt),'2026-11-26','Existing reporting timestamp API must retain old Web SDK float calculation');
 const receiptPayload=actual.createCompletedOrderDocumentPayload(receipt);persisted(receiptPayload,baseline.createCompletedOrderDocumentPayload(receipt),'SDK original receipt reporting writer');assert.equal(receiptPayload.businessDate,'2026-11-26');assertInstant(view(actual,receiptPayload).info,trueMillis);
 const compactInput=order({timestamp:typed,processedAt:'2026-11-27T10:00:00+09:00'}),compact=actual.createEmergencyCompactOrderRecord(compactInput);persisted(compact,baseline.createEmergencyCompactOrderRecord(compactInput),'SDK partial original receipt compact creator');const partial=actual.getOrderHistoryTimeInfo(actual.expandEmergencyCompactHistoryOrderRecord(plain(compact)));assert.equal(partial.timestamp,null);assert.equal(partial.historyDateOnly,'2026-11-25');
 return {actualWebSDKMillisecondExpression:true,roundedTypedLiteralIdenticalJSON:true,rawJSONMapBothDaysUnknown:true,mapFar20Retained:true,originalSDKMapStringAndPartialTrueDay25:true,existingReporting26Unchanged:true,otherProvableDayRetained:true,noFractionalReceiptInvented:true};
});
test('finite extreme legacy processing clocks never throw while shifting civil date bounds',()=>{
 for(const raw of ['+275760-09-12T12:00:00','-271821-04-20T00:00:00']){const o=order({processedAt:raw,statusUpdatedAt:'2026-11-27T10:00:00+09:00'}),p=actual.createCompletedOrderDocumentPayload(o);persisted(p,baseline.createCompletedOrderDocumentPayload(o),'finite extreme legacy writer');let info;assert.doesNotThrow(()=>{info=view(actual,p).info;});assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,'');}
 return {finiteDateOverflowAndUnderflowDoNotThrow:true,unresolvedEvidenceUnknown:true};
});
test('actual New York compact Date label follows baseline trim storage contract',()=>{
 const f=native16NYCompactFixture,c=plain(f.compact);assert.equal(sha(JSON.stringify(c)),f.compactSHA256);assert.equal(c.t.length,40);assert(c.t.endsWith(' '),'Actual NY producer must prove the trailing-space edge');
 const n=actual.normalizeEmergencyCompactOrderRecord(c);persisted(n,baseline.normalizeEmergencyCompactOrderRecord(c),'NY Date compact trim normalizer');assert.equal(n.t,c.t.trim());assert.equal(Object.keys(plain(n)).length,15);
 for(const value of [n,plain(n)]){const e=actual.expandEmergencyCompactHistoryOrderRecord(value);assertInstant(actual.getOrderHistoryTimeInfo(e),Date.parse(f.instant));persisted(actual.expandEmergencyCompactOrderRecord(value),baseline.expandEmergencyCompactOrderRecord(value),'NY global compact financial expansion');}
 return {actualProducerTimezone:'America/New_York',trailingSpaceTrimIsBaselineContract:true,storedJSONAndFinancialExpansionUnchanged:true};
});


// Native17: expectations fixed before candidate-reader execution. Prior60 unchanged.
const native17WriterFixtures=[{"mode":"localAM","raw":"AM +2026-11-26 23:30:00","producerTimezone":"UTC","businessDate":"2026-11-27","payloadSHA256":"2a66620d6b5267348475dbbbc1c427c55914d2c726ac3b7f0fe5a7b9ec8c36d2","independentPayloadSHA256":null},{"mode":"localNovUnderscore","raw":"23:30:00 Nov_-26-2026","producerTimezone":"UTC","businessDate":"2026-11-27","payloadSHA256":"7cb4ecb8e9a76069152800e48899df7a261dfe507f79a3df8caa55735ab1d529","independentPayloadSHA256":null},{"mode":"rawArray","raw":["2026-11-26T23:30:00"],"producerTimezone":"UTC","businessDate":"2026-11-27","payloadSHA256":"358e8122dfe875852e3dfc43e271435529bc15fbe8e2f0f4bc5f0e2cfafae3f2","independentPayloadSHA256":null},{"mode":"offsetSpaced","raw":"2026-11-26 23: 30: 00-0800","producerTimezone":"UTC","businessDate":"2026-11-27","payloadSHA256":"a0a0b2f0db076a44f0cc3f5195cacb730e437043660652166e522c6577202eef","independentPayloadSHA256":"f1306785df68ef2f12fb64839da3692ab05649b0526d6ccb3207cf754878c5b4"},{"mode":"offsetDoubleColon","raw":"2026-11-26 23::30-0800","producerTimezone":"UTC","businessDate":"2026-11-27","payloadSHA256":"4bb6f8400f6da5312b042d2e0765386d6c00a90c1021a0b7e82a8987e64ade04","independentPayloadSHA256":"d5c213a368f7bf9077f63ba6a18ab0687a171229c5284ff6aa2b5c1027313fa1"},{"mode":"localAM","raw":"AM +2026-11-26 23:30:00","producerTimezone":"Asia/Seoul","businessDate":"2026-11-26","payloadSHA256":"a66b4c3c768c7b4cc44359be8e50f7c5590e7abb0f24ccdc2f488b551d3d64fe","independentPayloadSHA256":null},{"mode":"localNovUnderscore","raw":"23:30:00 Nov_-26-2026","producerTimezone":"Asia/Seoul","businessDate":"2026-11-26","payloadSHA256":"55db44f893c467b45e08e387d4bb3d480ddad9bfdad68a74c8e473f4a1123c52","independentPayloadSHA256":null},{"mode":"rawArray","raw":["2026-11-26T23:30:00"],"producerTimezone":"Asia/Seoul","businessDate":"2026-11-26","payloadSHA256":"bb5188bc7fe1a818ff9ca68b55bcb7bdd97f3c43d35558c1ed79b4a460e9bc47","independentPayloadSHA256":null},{"mode":"offsetSpaced","raw":"2026-11-26 23: 30: 00-0800","producerTimezone":"Asia/Seoul","businessDate":"2026-11-27","payloadSHA256":"a0a0b2f0db076a44f0cc3f5195cacb730e437043660652166e522c6577202eef","independentPayloadSHA256":"f1306785df68ef2f12fb64839da3692ab05649b0526d6ccb3207cf754878c5b4"},{"mode":"offsetDoubleColon","raw":"2026-11-26 23::30-0800","producerTimezone":"Asia/Seoul","businessDate":"2026-11-27","payloadSHA256":"4bb6f8400f6da5312b042d2e0765386d6c00a90c1021a0b7e82a8987e64ade04","independentPayloadSHA256":"d5c213a368f7bf9077f63ba6a18ab0687a171229c5284ff6aa2b5c1027313fa1"},{"mode":"localAM","raw":"AM +2026-11-26 23:30:00","producerTimezone":"Pacific/Kiritimati","businessDate":"2026-11-26","payloadSHA256":"a66b4c3c768c7b4cc44359be8e50f7c5590e7abb0f24ccdc2f488b551d3d64fe","independentPayloadSHA256":null},{"mode":"localNovUnderscore","raw":"23:30:00 Nov_-26-2026","producerTimezone":"Pacific/Kiritimati","businessDate":"2026-11-26","payloadSHA256":"55db44f893c467b45e08e387d4bb3d480ddad9bfdad68a74c8e473f4a1123c52","independentPayloadSHA256":null},{"mode":"rawArray","raw":["2026-11-26T23:30:00"],"producerTimezone":"Pacific/Kiritimati","businessDate":"2026-11-26","payloadSHA256":"bb5188bc7fe1a818ff9ca68b55bcb7bdd97f3c43d35558c1ed79b4a460e9bc47","independentPayloadSHA256":null},{"mode":"offsetSpaced","raw":"2026-11-26 23: 30: 00-0800","producerTimezone":"Pacific/Kiritimati","businessDate":"2026-11-27","payloadSHA256":"a0a0b2f0db076a44f0cc3f5195cacb730e437043660652166e522c6577202eef","independentPayloadSHA256":"f1306785df68ef2f12fb64839da3692ab05649b0526d6ccb3207cf754878c5b4"},{"mode":"offsetDoubleColon","raw":"2026-11-26 23::30-0800","producerTimezone":"Pacific/Kiritimati","businessDate":"2026-11-27","payloadSHA256":"4bb6f8400f6da5312b042d2e0765386d6c00a90c1021a0b7e82a8987e64ade04","independentPayloadSHA256":"d5c213a368f7bf9077f63ba6a18ab0687a171229c5284ff6aa2b5c1027313fa1"},{"mode":"localAM","raw":"AM +2026-11-26 23:30:00","producerTimezone":"Etc/GMT+12","businessDate":"2026-11-27","payloadSHA256":"2a66620d6b5267348475dbbbc1c427c55914d2c726ac3b7f0fe5a7b9ec8c36d2","independentPayloadSHA256":null},{"mode":"localNovUnderscore","raw":"23:30:00 Nov_-26-2026","producerTimezone":"Etc/GMT+12","businessDate":"2026-11-27","payloadSHA256":"7cb4ecb8e9a76069152800e48899df7a261dfe507f79a3df8caa55735ab1d529","independentPayloadSHA256":null},{"mode":"rawArray","raw":["2026-11-26T23:30:00"],"producerTimezone":"Etc/GMT+12","businessDate":"2026-11-27","payloadSHA256":"358e8122dfe875852e3dfc43e271435529bc15fbe8e2f0f4bc5f0e2cfafae3f2","independentPayloadSHA256":null},{"mode":"offsetSpaced","raw":"2026-11-26 23: 30: 00-0800","producerTimezone":"Etc/GMT+12","businessDate":"2026-11-27","payloadSHA256":"a0a0b2f0db076a44f0cc3f5195cacb730e437043660652166e522c6577202eef","independentPayloadSHA256":"f1306785df68ef2f12fb64839da3692ab05649b0526d6ccb3207cf754878c5b4"},{"mode":"offsetDoubleColon","raw":"2026-11-26 23::30-0800","producerTimezone":"Etc/GMT+12","businessDate":"2026-11-27","payloadSHA256":"4bb6f8400f6da5312b042d2e0765386d6c00a90c1021a0b7e82a8987e64ade04","independentPayloadSHA256":"d5c213a368f7bf9077f63ba6a18ab0687a171229c5284ff6aa2b5c1027313fa1"},{"mode":"localAM","raw":"AM +2026-11-26 23:30:00","producerTimezone":"America/New_York","businessDate":"2026-11-27","payloadSHA256":"2a66620d6b5267348475dbbbc1c427c55914d2c726ac3b7f0fe5a7b9ec8c36d2","independentPayloadSHA256":null},{"mode":"localNovUnderscore","raw":"23:30:00 Nov_-26-2026","producerTimezone":"America/New_York","businessDate":"2026-11-27","payloadSHA256":"7cb4ecb8e9a76069152800e48899df7a261dfe507f79a3df8caa55735ab1d529","independentPayloadSHA256":null},{"mode":"rawArray","raw":["2026-11-26T23:30:00"],"producerTimezone":"America/New_York","businessDate":"2026-11-27","payloadSHA256":"358e8122dfe875852e3dfc43e271435529bc15fbe8e2f0f4bc5f0e2cfafae3f2","independentPayloadSHA256":null},{"mode":"offsetSpaced","raw":"2026-11-26 23: 30: 00-0800","producerTimezone":"America/New_York","businessDate":"2026-11-27","payloadSHA256":"a0a0b2f0db076a44f0cc3f5195cacb730e437043660652166e522c6577202eef","independentPayloadSHA256":"f1306785df68ef2f12fb64839da3692ab05649b0526d6ccb3207cf754878c5b4"},{"mode":"offsetDoubleColon","raw":"2026-11-26 23::30-0800","producerTimezone":"America/New_York","businessDate":"2026-11-27","payloadSHA256":"4bb6f8400f6da5312b042d2e0765386d6c00a90c1021a0b7e82a8987e64ade04","independentPayloadSHA256":"d5c213a368f7bf9077f63ba6a18ab0687a171229c5284ff6aa2b5c1027313fa1"}];
function native17Payload(f,day=f.businessDate){const p=JSON.parse(JSON.stringify(crossTimezoneProcessingFixture.UTCpayload).split('2026-11-27T10:00:00+09:00').join('2026-11-30T10:00:00+09:00'));p.businessDate=day;p.orderLite.businessDate=day;if(f.mode==='rawArray'){p.orderProcessedAtServer=f.raw;p.orderLite.processedAt='';}else p.orderLite.processedAt=f.raw;assert.equal(sha(JSON.stringify(p)),day===f.businessDate?f.payloadSHA256:f.independentPayloadSHA256,'Actual baseline writer payload changed');return p;}
test('AM date signs and underscored month tokens remain local processing clocks across writer zones',()=>{
 const cases=native17WriterFixtures.filter(f=>f.mode==='localAM'||f.mode==='localNovUnderscore');for(const f of cases){const p=native17Payload(f),i=view(actual,p).info;assert.equal(i.timestamp,null);assert.equal(i.historyDateOnly,'');balances(p);}
 for(const raw of ['AM +2026-11-26 23:30:00','23:30:00 Nov_-26-2026']){const o=order({processedAt:raw,statusUpdatedAt:'2026-11-30T10:00:00+09:00',businessDate:'2026-11-20'}),p=actual.createCompletedOrderDocumentPayload(o);persisted(p,baseline.createCompletedOrderDocumentPayload(o),'Native17 local-role independent day writer');assert.equal(view(actual,p).info.historyDateOnly,'2026-11-20');}
 return {actualProducerFixtures:cases.length,producerTimezones:5,Nov30FallbackDisjoint:true,autoExplicitFullJSONProof:true,independentFar20Retained:true};
});
test('spaced and double-colon valid negative offsets retain independent receipt dates',()=>{
 const cases=native17WriterFixtures.filter(f=>f.mode==='offsetSpaced'||f.mode==='offsetDoubleColon');for(const f of cases){assert.equal(f.businessDate,'2026-11-27');const derived=native17Payload(f),independent=native17Payload(f,'2026-11-26');assert.equal(view(actual,derived).info.historyDateOnly,'');const i=view(actual,independent).info;assert.equal(i.timestamp,null);assert.equal(i.historyDateOnly,'2026-11-26');balances(derived);balances(independent);}
 return {actualProducerFixtures:cases.length,producerTimezones:5,explicitOffsetDerived27:true,independent26Retained:true,Nov30FallbackDisjoint:true};
});
test('raw server arrays accepted by legacy writer keep their local clock ambiguity',()=>{
 const cases=native17WriterFixtures.filter(f=>f.mode==='rawArray');for(const f of cases){const p=native17Payload(f);assert(Array.isArray(p.orderProcessedAtServer));assert.equal(p.orderLite.processedAt,'');const i=view(actual,p).info;assert.equal(i.timestamp,null);assert.equal(i.historyDateOnly,'');balances(p);}
 for(const[raw,day]of [[['2026-11-26T23:30:00'],'2026-11-20'],[['2026-11-26T23:30:00+09:00'],'2026-11-25']]){const o=order({processedAtServer:raw,processedAt:'',statusUpdatedAt:'2026-11-30T10:00:00+09:00',businessDate:day}),p=actual.createCompletedOrderDocumentPayload(o);persisted(p,baseline.createCompletedOrderDocumentPayload(o),'Native17 raw-array independent day writer');same(p.orderProcessedAtServer,raw,'Raw array must remain raw in stored JSON');assert.equal(view(actual,p).info.historyDateOnly,day);}
 return {actualProducerFixtures:cases.length,producerTimezones:5,autoExplicitFullJSONProof:true,rawArrayJSONPreserved:true,farAndExplicitZoneIndependentDayRetained:true};
});
test('original server receipt date-only remains a date and never adopts completion time',()=>{
 const o=order({processedAt:'',completedAt:'2026-11-27T10:00:00+09:00',statusUpdatedAt:'2026-11-27T10:00:00+09:00',createdAtServerIso:'2026-11-20'}),p=actual.createCompletedOrderDocumentPayload(o);persisted(p,baseline.createCompletedOrderDocumentPayload(o),'Native17 original receipt day-only writer');assert.equal(p.businessDate,'2026-11-20');assert.equal(p.orderCreatedAtServerIso,'2026-11-20');assert.equal(p.orderLite.businessAt,'2026-11-27T10:00:00+09:00');for(const json of [false,true]){const i=view(actual,p,json).info;assert.equal(i.timestamp,null);assert.equal(i.historyDateOnly,'2026-11-20');}balances(p);return {originalDay20Preserved:true,completion27NeverReceiptClock:true,JSONAndDirectPaths:true};
});
test('opaque typed receipt ISO and invalid literal identical JSON preserve independent original day',()=>{
 const receipt={seconds:Math.floor(Date.parse('2026-11-20T01:00:00Z')/1000),nanoseconds:0},common={processedAt:'',completedAt:'2026-11-27T10:00:00+09:00',statusUpdatedAt:'2026-11-27T10:00:00+09:00'},typed=order({...common,createdAtServerIso:receipt}),literal=order({...common,createdAtServerIso:'[object Object]',businessDate:'2026-11-20'}),a=actual.createCompletedOrderDocumentPayload(typed),b=actual.createCompletedOrderDocumentPayload(literal);same(a,b,'Actual baseline typed receipt and invalid literal with explicit original day have identical full stored JSON');assert.equal(a.businessDate,'2026-11-20');assert.equal(a.orderCreatedAtServerIso,'[object Object]');
 for(const[o,p]of [[typed,a],[literal,b]]){persisted(p,baseline.createCompletedOrderDocumentPayload(o),'Native17 opaque original receipt writer');for(const json of [false,true]){const i=view(actual,p,json).info;assert.equal(i.timestamp,null);assert.equal(i.historyDateOnly,'2026-11-20');}balances(p);}
 return {typedReceiptLiteralFullJSONExactlyIdentical:true,receiptRoleNotOpaqueProcessing:true,date20WithoutInventedClock:true};
});


// Native17 wrapper/priority expectations fixed before candidate execution.
const native17WrapperBaselineBodies={"buildPayload":"  function buildPayload(data){\n    if(window.HaetsalRuntimeGuard && !window.HaetsalRuntimeGuard.canWrite('firestore-build-payload')){\n      throw new Error('Firestore write blocked by runtime guard');\n    }\n    const savedAt = new Date().toISOString();\n    const appBuildNumber = window.HaetsalRuntimeGuard && Number(window.HaetsalRuntimeGuard.APP_BUILD_NUMBER || 0);\n    const appBuildLabel = window.HaetsalRuntimeGuard ? String(window.HaetsalRuntimeGuard.APP_BUILD_LABEL || '') : '';\n    const writeSchemaVersion = window.HaetsalRuntimeGuard && Number(window.HaetsalRuntimeGuard.WRITE_SCHEMA_VERSION || 0);\n    const clientWriteId = makeClientWriteId();\n    return {\n      data: attachRemoteDataGuard(data, savedAt),\n      updatedAt: savedAt,\n      dataGuardVersion: REMOTE_DATA_GUARD_VERSION,\n      appBuild: REMOTE_DATA_GUARD_BUILD,\n      savedAt,\n      deviceId: getRemoteDataGuardDeviceId(),\n      clientBuildNumber:appBuildNumber,\n      clientBuildLabel:appBuildLabel,\n      writeSchemaVersion,\n      clientWriteAt:savedAt,\n      clientWriteId\n    };\n  }","buildPayloadWithServerOrderTimes":"  function buildPayloadWithServerOrderTimes(data, mode){\n    const source = data && typeof data === 'object' ? data : {};\n    const built = buildPayload(source);\n    built.serverUpdatedAt = serverTimestamp();\n    const copyFields = [\n      'orderCreatedAtServer','orderCreatedAtServerIso','orderProcessedAtServer','orderProcessedAtServerIso',\n      'orderCompletedAtServer','orderCompletedAtServerIso','orderCancelledAtServer','orderCancelledAtServerIso',\n      'orderStatusUpdatedAtServer','orderStatusUpdatedAtServerIso','orderUpdatedAtServer','orderUpdatedAtServerIso'\n    ];\n    copyFields.forEach(key => {\n      const value = source[key];\n      if(value !== undefined && value !== null && value !== '') built[key] = value;\n    });\n    built.orderUpdatedAtServer = serverTimestamp();\n    const serverMode = String(mode || 'updated');\n    if(serverMode === 'created'){\n      built.orderCreatedAtServer = serverTimestamp();\n      built.orderStatusUpdatedAtServer = serverTimestamp();\n    }else if(serverMode === 'completed'){\n      built.orderProcessedAtServer = serverTimestamp();\n      built.orderCompletedAtServer = serverTimestamp();\n      built.orderStatusUpdatedAtServer = serverTimestamp();\n    }else if(serverMode === 'cancelled'){\n      built.orderProcessedAtServer = serverTimestamp();\n      built.orderCancelledAtServer = serverTimestamp();\n      built.orderStatusUpdatedAtServer = serverTimestamp();\n    }\n    return built;\n  }","writeCompletedOrderPayloadToRef":"  async function writeCompletedOrderPayloadToRef(ref, finalPayload, label, onProgress, timeoutMs){\n    const builtPayload = buildPayloadWithServerOrderTimes(finalPayload, 'updated');\n    builtPayload.serverSavedAt = serverTimestamp();\n    const status = String(finalPayload && finalPayload.status || '').toUpperCase();\n    if(status === 'CANCELLED' && !builtPayload.orderCancelledAtServer){\n      builtPayload.orderCancelledAtServer = serverTimestamp();\n      builtPayload.orderProcessedAtServer = serverTimestamp();\n      builtPayload.orderStatusUpdatedAtServer = serverTimestamp();\n    }else if((status === 'PICKUP_DONE' || status === 'DELIVERY_DONE') && !builtPayload.orderCompletedAtServer){\n      builtPayload.orderCompletedAtServer = serverTimestamp();\n      builtPayload.orderProcessedAtServer = serverTimestamp();\n      builtPayload.orderStatusUpdatedAtServer = serverTimestamp();\n    }\n    const payloadBytes = getArchiveJsonBytes(builtPayload);\n    if(onProgress) onProgress(`${label} 쓰기 시작 · ${Math.round(payloadBytes / 1024)}KB`, { step:'completed-doc-write-start', bytes:payloadBytes, storageLocation:finalPayload.storageLocation, docId:finalPayload.docId });\n    let timeoutError = null;\n    try{\n      await runArchiveCloudPromiseWithTimeout(\n        setDoc(ref, builtPayload, { merge:true }),\n        Math.max(1000, Number(timeoutMs || COMPLETED_ORDER_DOC_CLOUD_WRITE_TIMEOUT_MS)),\n        `${label} 저장 시간이 초과되었습니다.`\n      );\n    }catch(error){\n      timeoutError = error;\n      if(onProgress) onProgress(`${label} 시간초과/오류 후 서버 재조회 중`, { step:'completed-doc-timeout-verify', error:error && error.message ? error.message : String(error || ''), storageLocation:finalPayload.storageLocation, docId:finalPayload.docId });\n    }\n    const verify = await verifyDocumentExistsWithRetry(ref, label, onProgress, COMPLETED_ORDER_DOC_VERIFY_RETRY_COUNT, COMPLETED_ORDER_DOC_VERIFY_RETRY_DELAY_MS);\n    if(verify && verify.exists){\n      return { saved:true, verified:true, docId:finalPayload.docId, storageLocation:finalPayload.storageLocation, payloadBytes, recoveredAfterTimeout:!!timeoutError, verifiedAt:new Date().toISOString() };\n    }\n    if(timeoutError){\n      throw new Error(`${timeoutError.message} 서버 재조회에서도 문서가 확인되지 않았습니다.`);\n    }\n    throw new Error(`${label} 저장 후 서버 재조회에서 문서가 확인되지 않았습니다.`);\n  }","normalizeCompletedOrderCloudPayload":"  function normalizeCompletedOrderCloudPayload(docSnap, storageLocation){\n    if(!docSnap || !docSnap.exists || !docSnap.exists()) return null;\n    const raw = docSnap.data && docSnap.data();\n    const data = raw && raw.data && typeof raw.data === 'object' ? raw.data : raw;\n    if(!data || typeof data !== 'object') return null;\n    if(data.payloadKind && data.payloadKind !== 'lightweight-completed-order') return null;\n    if(!data.orderLite && !data.orderId) return null;\n    return {\n      ...data,\n      orderCreatedAtServer:raw && raw.orderCreatedAtServer || data.orderCreatedAtServer || '',\n      orderCreatedAtServerIso:String(raw && raw.orderCreatedAtServerIso || data.orderCreatedAtServerIso || ''),\n      orderProcessedAtServer:raw && raw.orderProcessedAtServer || data.orderProcessedAtServer || '',\n      orderProcessedAtServerIso:String(raw && raw.orderProcessedAtServerIso || data.orderProcessedAtServerIso || ''),\n      orderCompletedAtServer:raw && raw.orderCompletedAtServer || data.orderCompletedAtServer || '',\n      orderCompletedAtServerIso:String(raw && raw.orderCompletedAtServerIso || data.orderCompletedAtServerIso || ''),\n      orderCancelledAtServer:raw && raw.orderCancelledAtServer || data.orderCancelledAtServer || '',\n      orderCancelledAtServerIso:String(raw && raw.orderCancelledAtServerIso || data.orderCancelledAtServerIso || ''),\n      orderStatusUpdatedAtServer:raw && raw.orderStatusUpdatedAtServer || data.orderStatusUpdatedAtServer || '',\n      orderStatusUpdatedAtServerIso:String(raw && raw.orderStatusUpdatedAtServerIso || data.orderStatusUpdatedAtServerIso || ''),\n      orderUpdatedAtServer:raw && raw.orderUpdatedAtServer || data.orderUpdatedAtServer || raw && raw.serverUpdatedAt || '',\n      orderUpdatedAtServerIso:String(raw && raw.orderUpdatedAtServerIso || data.orderUpdatedAtServerIso || ''),\n      docId: data.docId || docSnap.id,\n      storageLocation: data.storageLocation || storageLocation || ''\n    };\n  }"};
async function testAsync(name,fn){try{const details=await fn();rows.push({name,status:'PASS',...details});}catch(error){rows.push({name,status:'FAIL',message:error.message,actual:error.actual,expected:error.expected,stack:error.stack});}}
(async()=>{
await testAsync('archive storage wrapper cannot replace original nested null processing provenance',async()=>{
 const names=Object.keys(native17WrapperBaselineBodies),captures=new Map([[actual,[]],[baseline,[]]]),saved=new Map(),keys=['REMOTE_DATA_GUARD_VERSION','REMOTE_DATA_GUARD_BUILD','attachRemoteDataGuard','makeClientWriteId','getRemoteDataGuardDeviceId','serverTimestamp','getArchiveJsonBytes','setDoc','runArchiveCloudPromiseWithTimeout','verifyDocumentExistsWithRetry','COMPLETED_ORDER_DOC_VERIFY_RETRY_COUNT','COMPLETED_ORDER_DOC_VERIFY_RETRY_DELAY_MS'];
 try{
  for(const ctx of [actual,baseline]){saved.set(ctx,keys.map(key=>({key,own:Object.prototype.hasOwnProperty.call(ctx,key),value:ctx[key]})));for(const name of names){const body=ctx===actual?extract(source,name):native17WrapperBaselineBodies[name];if(ctx===actual){extracted[name]=sha(body);if(name!=='normalizeCompletedOrderCloudPayload')assert.equal(sha(body),sha(native17WrapperBaselineBodies[name]),'Archive writer wrapper must be baseline-byte-exact');}vm.runInContext(body,ctx);}
   Object.assign(ctx,{REMOTE_DATA_GUARD_VERSION:1,REMOTE_DATA_GUARD_BUILD:'fixed-baseline-proof',attachRemoteDataGuard:value=>value,makeClientWriteId:()=> 'fixed-client-write',getRemoteDataGuardDeviceId:()=> 'private-pure-fixture',serverTimestamp:()=> '2026-12-01T00:00:00.000Z',getArchiveJsonBytes:value=>Buffer.byteLength(JSON.stringify(value)),setDoc:async(ref,value)=>{captures.get(ctx).push(plain(value));},runArchiveCloudPromiseWithTimeout:async promise=>await promise,verifyDocumentExistsWithRetry:async()=>({exists:true}),COMPLETED_ORDER_DOC_VERIFY_RETRY_COUNT:1,COMPLETED_ORDER_DOC_VERIFY_RETRY_DELAY_MS:1});
  }
  const input=order({createdAt:'',timestamp:'',businessAt:'',businessDate:'',processedAt:'2026-11-26T10:00:00+09:00',completedAt:'2026-11-30T10:00:00+09:00',statusUpdatedAt:'2026-11-30T10:00:00+09:00'}),explicit={...input,businessDate:'2026-11-26'},independent={...input,businessDate:'2026-11-20'},payloads=[input,explicit,independent].map(o=>actual.createCompletedOrderDocumentPayload(o));same(payloads[0],payloads[1],'Actual baseline derived26 and declared26 have identical full stored JSON');
  for(const[o,p]of [[input,payloads[0]],[explicit,payloads[1]],[independent,payloads[2]]]){persisted(p,baseline.createCompletedOrderDocumentPayload(o),'wrapper original payload writer');await actual.writeCompletedOrderPayloadToRef({},p,'pure fixture',null,1000);await baseline.writeCompletedOrderPayloadToRef({},p,'pure fixture',null,1000);}
  same(captures.get(actual),captures.get(baseline),'Actual wrapper complete stored snapshots must remain baseline JSON');same(captures.get(actual)[0],captures.get(actual)[1],'Wrapped derived and explicit pair remain identical full JSON');
  for(let i=0;i<3;i++){const stored=captures.get(actual)[i],old=captures.get(baseline)[i];assert(Object.prototype.hasOwnProperty.call(stored.data,'orderProcessedAtServer'));assert.equal(stored.data.orderProcessedAtServer,null);assert.equal(stored.orderProcessedAtServer,'2026-12-01T00:00:00.000Z');
   const doc=value=>({id:'archive-fixture',exists:()=>true,data:()=>value}),adapted=actual.normalizeCompletedOrderCloudPayload(doc(stored),'haetsalCompletedOrders'),oldAdapted=baseline.normalizeCompletedOrderCloudPayload(doc(old),'haetsalCompletedOrders');persisted(adapted,oldAdapted,'readonly archive adapter enumerable storage fields');
   for(const value of [payloads[i],stored,adapted]){const read=actual.normalizeArchivedCompletedPayloadToOrder(value),info=actual.getOrderHistoryTimeInfo(read);assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,i===2?'2026-11-20':'');balances({orderLite:read});}
  }
  return {actualBaselineWrapperThreeBodiesExact:true,actualAdapterExecuted:true,derivedExplicitFullSnapshotJSONIdentical:true,nestedOwnNullAndOuterDec1Preserved:true,derived26Unknown:true,independent20Retained:true,networkWrites:0,wrapperSetDocAndServerTimestampAreLocalMocks:true};
 }finally{for(const[ctx,entries]of saved)for(const{key,own,value}of entries){if(own)ctx[key]=value;else delete ctx[key];}}
});
test('server receipt date-only wins same-order and both merge directions while last financial fields stay unchanged',()=>{
 const id='native17-dateonly-priority',uid='synthetic-only',strong=order({id,userId:uid,createdAtServerIso:'2026-11-20',timestamp:'',remainingCoupons:17,statusRevision:4,quantity:2,memo:'strong-day20'}),weak=order({id,userId:uid,createdAtServerIso:'',timestamp:'2026-11-21T10:00:00+09:00',remainingCoupons:9,statusRevision:9,quantity:3,memo:'latest-client21'}),sameOrder={...weak,createdAtServerIso:'2026-11-20'},beforeStrong=plain(strong),beforeWeak=plain(weak);
 const check=value=>{const info=actual.getOrderHistoryTimeInfo(value);assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,'2026-11-20');assert.equal(info.evidenceRank,2);};check(sameOrder);
 for(const[a,b]of [[strong,weak],[weak,strong]]){const result=actual.mergeOrdersByIdForCouponHistory([a],[b]);assert.equal(result.length,1);check(result[0]);const stripped=plain(result[0]);for(const key of ['historyOriginalTimeResolved','historyOriginalTimestamp','historyOriginalDateOnly','historyOriginalTimeRank'])delete stripped[key];same(stripped,b,'All latest raw financial/status/input fields remain exactly the last existing merge input');}
 const p=actual.createCompletedOrderDocumentPayload(sameOrder);persisted(p,baseline.createCompletedOrderDocumentPayload(sameOrder),'server day20 and client21 original writer');assert.equal(p.businessDate,'2026-11-20');assert.equal(p.orderLite.timestamp,'2026-11-21T10:00:00+09:00');for(const json of [false,true])check(view(actual,p,json).read);same(strong,beforeStrong,'Strong original input not mutated');same(weak,beforeWeak,'Weak original input not mutated');
 return {sameOrderAndWriterJSONDay20:true,serverDateOnlyRank:2,bothMergeDirections:true,lastFinancialStatusAndAllRawFieldsUnchanged:true,inputObjectsUnchanged:true};
});


// Native18 five regression expectations were frozen before corrected-source execution.
// Contract SHA256 1277fc20f44a72fecffd2c9286c5597c4b2791078ea2f13c5f06769890832785; prior67 test bodies and expectations are unchanged.
const native18FiveContract={
  "contract": "Native18 five findings. Expected values fixed before executing the corrected candidate. Existing67 oracles unchanged.",
  "brokenSourceSHA256": "7f88567fb0678b26f42aadd1543265dbd2919a9533dc967581edae6b7e8766e7",
  "fixedSourceSHA256": "64ced9fe2e6417a497c1ab6476825cec880c4261e0c18a208ec8210769ea46f5",
  "clientDateWithPreciseClient": {
    "businessAt": "2026-11-26",
    "createdAt": "2026-11-26T10:23:00+09:00",
    "expectedISO": "2026-11-26T01:23:00.000Z",
    "expectedRank": 1
  },
  "canonicalEarlyYearLocalProcessing": {
    "processedAt": "0010-11-26T23:30:00",
    "completedAt": "2026-11-30T10:00:00+09:00",
    "independentDay": "2026-10-12",
    "farIndependentDay": "2026-11-20",
    "readers": [
      "UTC",
      "Asia/Seoul",
      "America/New_York"
    ],
    "expectedTimestamp": null
  },
  "flatWrapper": {
    "orderId": "native19-flat-order",
    "docId": "native19-flat-document",
    "storageLocation": "haetsalCompletedOrders",
    "outerProcessedAt": "2026-12-01T00:00:00.000Z",
    "originalProcessedAt": null,
    "expectedLegacyEnumerableJSON": "exact baseline normalizer(adapter(snapshot)), excluding only four documented history view keys"
  },
  "invalidFirstMaps": [
    {
      "name": "fractional-seconds",
      "value": {
        "seconds": 1795653000.25,
        "nanoseconds": 0
      }
    },
    {
      "name": "hex-seconds",
      "value": {
        "seconds": "0x6b0a31c8",
        "nanoseconds": 0
      }
    },
    {
      "name": "exponent-seconds",
      "value": {
        "seconds": "1.795653e9",
        "nanoseconds": 0
      }
    },
    {
      "name": "beyond-SDK-max",
      "value": {
        "seconds": 253402300800,
        "nanoseconds": 0
      }
    },
    {
      "name": "before-SDK-min",
      "value": {
        "seconds": -62135596801,
        "nanoseconds": 0
      }
    },
    {
      "name": "hex-nanoseconds",
      "value": {
        "seconds": 1795653000,
        "nanoseconds": "0x1"
      }
    }
  ],
  "validNextISO": "2026-11-25T01:00:00.000Z",
  "validDecimalMap": {
    "seconds": "1795653000",
    "nanoseconds": "123000000"
  },
  "validDecimalMapISO": "2026-11-26T00:30:00.123Z",
  "earlySort": {
    "earlyISO": "0999-11-26T01:00:00.000Z",
    "modernISO": "2026-11-25T01:00:00.000Z",
    "expectedIDs": [
      "modern",
      "early"
    ],
    "expectedMixedIDs": [
      "modern",
      "modern-day",
      "early",
      "early-day"
    ]
  }
};

test('client date-only never hides an available precise client receipt',()=>{
 const c=native18FiveContract.clientDateWithPreciseClient,o=order({businessAt:c.businessAt,createdAt:c.createdAt,processedAt:'',statusUpdatedAt:'2026-11-30T10:00:00+09:00'}),before=plain(o),p=actual.createCompletedOrderDocumentPayload(o);
 persisted(p,baseline.createCompletedOrderDocumentPayload(o),'Native18 client date and precise receipt writer');
 for(const info of [actual.getOrderHistoryTimeInfo(o),view(actual,p,false).info,view(actual,p,true).info]){assertInstant(info,Date.parse(c.expectedISO));assert.equal(info.historyDateOnly,'');assert.equal(info.evidenceRank,1);}
 const server=actual.getOrderHistoryTimeInfo({...o,createdAtServerIso:'2026-11-20'});assert.equal(server.timestamp,null);assert.equal(server.historyDateOnly,'2026-11-20');assert.equal(server.evidenceRank,2);same(o,before,'Client input remains unchanged');balances(p);
 return {liveAndBothArchivePathsPreciseClient:true,serverDay20StillAuthoritative:true,storedJSONBaselineExact:true};
});
test('canonical offsetless ISO year0010 cannot manufacture an unrelated modern day',()=>{
 const c=native18FiveContract.canonicalEarlyYearLocalProcessing,oldTZ=process.env.TZ,checks=[];
 try{for(const TZ of c.readers){process.env.TZ=TZ;for(const day of [c.independentDay,c.farIndependentDay]){const o=order({processedAt:c.processedAt,statusUpdatedAt:c.completedAt,businessDate:day}),p=actual.createCompletedOrderDocumentPayload(o);persisted(p,baseline.createCompletedOrderDocumentPayload(o),'Native18 early ISO year independent day writer');const info=view(actual,p).info;assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,day);balances(p);checks.push({TZ,day});}
  const ordinary=order({processedAt:'2026-11-26T23:30:00',statusUpdatedAt:c.completedAt,businessDate:'2026-11-27'}),p=actual.createCompletedOrderDocumentPayload(ordinary);persisted(p,baseline.createCompletedOrderDocumentPayload(ordinary),'Native18 ordinary local processing negative');assert.equal(view(actual,p).info.historyDateOnly,'');}}
 finally{if(oldTZ===undefined)delete process.env.TZ;else process.env.TZ=oldTZ;}
 return {fixedIndependentOct12AndFar20:checks,ordinaryModernDerivedDayStillUnknown:true,storedJSONBaselineExact:true};
});
test('flat legacy archive normalization retains every baseline enumerable field',()=>{
 const c=native18FiveContract.flatWrapper,payload={payloadKind:'lightweight-completed-order',orderId:c.orderId,userId:'synthetic-only',status:'PICKUP_DONE',timestamp:'2026-11-20T01:00:00Z',businessDate:'2026-11-20',processedAt:'2026-11-26T01:00:00Z',completedAt:'2026-11-30T01:00:00Z',orderProcessedAtServer:null,quantity:2,remainingCoupons:17,productionCycle:3,statusRevision:4},raw={data:payload,orderProcessedAtServer:c.outerProcessedAt},before=plain(raw),snap={id:c.docId,exists:()=>true,data:()=>raw};
 const baselineAdapter=vm.runInContext('('+native17WrapperBaselineBodies.normalizeCompletedOrderCloudPayload+')',baseline),adapted=actual.normalizeCompletedOrderCloudPayload(snap,c.storageLocation),oldAdapted=baselineAdapter(snap,c.storageLocation);persisted(adapted,oldAdapted,'Native18 flat adapter JSON');
 const current=actual.normalizeArchivedCompletedPayloadToOrder(adapted),old=baseline.normalizeArchivedCompletedPayloadToOrder(oldAdapted),legacy=value=>{const copy=plain(value);for(const key of ['historyOriginalTimeResolved','historyOriginalTimestamp','historyOriginalDateOnly','historyOriginalTimeRank'])delete copy[key];return copy;};same(legacy(current),legacy(old),'Entire flat normalized legacy field set must remain baseline JSON');
 assert.equal(current.docId,c.docId);assert.equal(current.storageLocation,c.storageLocation);assert.equal(current.orderProcessedAtServer,c.outerProcessedAt);assert.equal(Object.getOwnPropertyDescriptor(adapted,'historyOriginalPayload').value,payload);assert.equal(payload.orderProcessedAtServer,null);same(raw,before,'Original flat wrapper raw object unchanged');balances({orderLite:current});
 return {entireLegacyNormalizedJSONBaselineExact:true,adapterEnumerableJSONBaselineExact:true,docIdStorageLocationAndOuterClockPreserved:true,nestedOwnNullProvenanceIntact:true};
});
test('malformed authoritative Timestamp maps skip to a valid next receipt candidate',()=>{
 const c=native18FiveContract;for(const {name,value}of c.invalidFirstMaps){const info=actual.getHistoryTimeInfo([value,c.validNextISO]);assertInstant(info,Date.parse(c.validNextISO));assert.equal(info.value,c.validNextISO,name+' fallback identity');const orderInfo=actual.getOrderHistoryTimeInfo({createdAtServer:value,createdAtServerIso:c.validNextISO});assertInstant(orderInfo,Date.parse(c.validNextISO));assert.equal(orderInfo.evidenceRank,2,name+' malformed map cannot provide rank3');}
 const valid=actual.getHistoryTimeInfo([c.validDecimalMap]);assertInstant(valid,Date.parse(c.validDecimalMapISO));assert.equal(valid.value,c.validDecimalMap);return {invalidFirstMaps:c.invalidFirstMaps.length,validDecimalSecondsAndNanosRetained:true,fallbackValueIdentityAndServerISORank2:true};
});
test('early-year exact and date-only receipt rows sort below modern records',()=>{
 for(const name of ['getCombinedHistoryItemTime','compareCombinedHistoryItemsByTimeDesc']){const body=extract(source,name);extracted[name]=sha(body);vm.runInContext(body,actual);}
 const c=native18FiveContract.earlySort,early={id:'early',timestamp:new Date(c.earlyISO)},modern={id:'modern',timestamp:new Date(c.modernISO)},pair=[early,modern].sort(actual.compareCombinedHistoryItemsByTimeDesc);same(pair.map(row=>row.id),c.expectedIDs,'Year0999 must sort below2026');
 const mixed=[{id:'early-day',timestamp:null,historyDateOnly:'0999-11-26'},modern,early,{id:'modern-day',timestamp:null,historyDateOnly:'2026-11-25'}].sort(actual.compareCombinedHistoryItemsByTimeDesc);same(mixed.map(row=>row.id),c.expectedMixedIDs,'Numeric calendar sorting must preserve exact-before-dateonly within same day');
 return {exactIDs:pair.map(row=>row.id),mixedExactAndDateOnlyIDs:mixed.map(row=>row.id)};
});


// Native19 final two expectations fixed before candidate execution; previous72 are byte-preserved.
// Contract SHA256 6607c665a447be537b9e9e8bb7bc0583f21f0e3e0f072eac370b165996609c54
const native19TwoContract={
  "contract": "Native19 final two findings. Expected values fixed before corrected-source execution; previous72 oracles unchanged.",
  "brokenSourceSHA256": "64ced9fe2e6417a497c1ab6476825cec880c4261e0c18a208ec8210769ea46f5",
  "fixedSourceSHA256": "62e3de3dabb6eb636f567bced9f55852d9dd06406c5d4608d3a4a30a88e32665",
  "validClientISO": "2026-11-26T01:23:00.000Z",
  "seconds": 1795653000,
  "omittedNanosISO": "2026-11-26T00:30:00.000Z",
  "invalidMapCases": [
    "explicit-null-nanos",
    "explicit-undefined-nanos",
    "underscored-null-nanos",
    "underscored-undefined-nanos",
    "malformed-nanos",
    "fractional-seconds-throwing-toDate",
    "nano-only-with-toDate"
  ],
  "invalidMapToDateCalls": 0,
  "toDateOnlyWithoutEpochFieldsCalls": 1,
  "undefinedJSONErasure": "An explicit undefined field is erased by JSON. The resulting omitted-nanos map is a valid different representation; raw undefined rejection must not imply JSON-roundtrip rejection.",
  "era": {
    "yearZeroISO": "0000-11-26T00:00:00.000Z",
    "yearOneISO": "0001-01-01T00:00:00.000Z",
    "expectedIDs": [
      "year-one",
      "year-one-day",
      "year-zero",
      "year-zero-day",
      "year-zero-previous-day"
    ]
  }
};

test('explicit malformed epoch fields cannot use toDate or override a valid client receipt',()=>{
 const c=native19TwoContract,s=c.seconds;let calls=0;
 const cases=[
  {name:'explicit-null-nanos',value:{seconds:s,nanoseconds:null}},
  {name:'explicit-undefined-nanos',value:{seconds:s,nanoseconds:undefined},undefinedErased:true},
  {name:'underscored-null-nanos',value:{_seconds:s,_nanoseconds:null}},
  {name:'underscored-undefined-nanos',value:{_seconds:s,_nanoseconds:undefined},undefinedErased:true},
  {name:'malformed-nanos',value:{seconds:s,nanoseconds:'invalid'}},
  {name:'fractional-seconds-throwing-toDate',value:{seconds:s+0.25,nanoseconds:0,toDate(){calls++;throw Error('MALFORMED_MAP_TODATE_MUST_NOT_RUN');}}},
  {name:'nano-only-with-toDate',value:{nanoseconds:0,toDate(){calls++;return new Date('2026-11-20T00:00:00Z');}}}
 ];
 same(cases.map(row=>row.name),c.invalidMapCases,'Fixed invalid-map families');
 for(const row of cases){calls=0;const info=actual.getHistoryTimeInfo([row.value,c.validClientISO]);assertInstant(info,Date.parse(c.validClientISO));assert.equal(info.value,c.validClientISO);assert.equal(calls,0,row.name+' raw reader called toDate');
  const o=order({createdAtServer:row.value,createdAt:c.validClientISO,processedAt:'',statusUpdatedAt:'2026-11-30T10:00:00+09:00'}),p=actual.createCompletedOrderDocumentPayload(o);persisted(p,baseline.createCompletedOrderDocumentPayload(o),'Native19 malformed map writer remains baseline');calls=0;const direct=view(actual,p,false).info;assertInstant(direct,Date.parse(c.validClientISO));assert.equal(direct.evidenceRank,1);assert.equal(calls,0,row.name+' archive reader called toDate');
  const json=view(actual,p,true).info;if(row.undefinedErased){assertInstant(json,Date.parse(c.omittedNanosISO));assert.equal(json.evidenceRank,3);}else{assertInstant(json,Date.parse(c.validClientISO));assert.equal(json.evidenceRank,1);}balances(p);
 }
 for(const value of [{seconds:s},{_seconds:s}]){const info=actual.getHistoryTimeInfo([value]);assertInstant(info,Date.parse(c.omittedNanosISO));assert.equal(info.value,value);}
 calls=0;const onlyMethod={toDate(){calls++;return new Date(c.validClientISO);}},methodInfo=actual.getHistoryTimeInfo([onlyMethod]);assertInstant(methodInfo,Date.parse(c.validClientISO));assert.equal(methodInfo.value,onlyMethod);assert.equal(calls,1);
 return {invalidMapFamilies:cases.length,malformedToDateCalls:0,rawUndefinedVsJSONOmittedDistinguished:true,omittedNanosDefaultZero:true,toDateOnlyWithoutEpochFieldsPreserved:true,writerJSONBaselineExact:true};
});
test('era-aware Seoul sort keeps astronomical yearzero below yearone and beside its date-only row',()=>{
 for(const name of ['getCombinedHistoryItemTime','compareCombinedHistoryItemsByTimeDesc']){const body=extract(source,name);extracted[name]=sha(body);vm.runInContext(body,actual);}
 const c=native19TwoContract.era,rows=[{id:'year-zero',timestamp:new Date(c.yearZeroISO)},{id:'year-zero-previous-day',timestamp:null,historyDateOnly:'0000-11-25'},{id:'year-one-day',timestamp:null,historyDateOnly:'0001-01-01'},{id:'year-one',timestamp:new Date(c.yearOneISO)},{id:'year-zero-day',timestamp:null,historyDateOnly:'0000-11-26'}];
 const before=plain(rows),sorted=rows.slice().sort(actual.compareCombinedHistoryItemsByTimeDesc);same(sorted.map(row=>row.id),c.expectedIDs,'Astronomical0 year exact/date-only ordering');same(rows,before,'Comparator must not mutate original rows');return {sortedIDs:sorted.map(row=>row.id),year0And1Separated:true,year0ExactAndDateOnlyAdjacent:true,sourceRowsUnchanged:true};
});

const failures=rows.filter(row=>row.status==='FAIL'),bodyComparison=Object.fromEntries(Object.keys(baselineBodies).map(n=>[n,{baselineSHA256:baselineBodyHashes[n],actualSHA256:extracted[n],byteSame:baselineBodyHashes[n]===extracted[n]}]));
console.log(JSON.stringify({status:failures.length?'FAIL':'PASS_STORAGE_PRESERVATION_AND_AVAILABLE_VIEW_MODELS_ONLY',sourceFile,sourceSHA256,baselineReference,tests:rows.length,passed:rows.length-failures.length,failed:failures.length,rows,limitations:limits,bodyComparison,webSDKStringContract,extractedFunctions:extracted,stubs:['item rendering','quantity aggregation','item compaction','coupon-cost snapshot copying','coupon-ledger source records'],stubScope:'Actual date/status, writer, reader, compact, readonly bridge and display sorting/cutoff functions run unchanged. Non-date fixture builders do not prove runtime financial transactions.',timestampFixture:'Protocol Timestamp .toDate/serialized seconds+nanos; actual SDK constructor is a separate private run.',SDK:0,Auth:0,network:0,RulesRuntime:'UNVERIFIED',actualUI:'UNVERIFIED'},null,2));
if(failures.length)process.exitCode=1;

})().catch(error=>{console.error(JSON.stringify({status:"FAIL_ASYNC_FIXTURE_RUNNER",message:error.message,stack:error.stack}));process.exitCode=1;});
