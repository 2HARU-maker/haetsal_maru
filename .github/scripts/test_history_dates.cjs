const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8').replace(/\r\n/g, '\n');
function extract(name) {
  const start = source.indexOf('    function ' + name + '(');
  const end = source.indexOf('\n    }', start) + 6;
  assert(start >= 0 && end > start, 'Missing product function ' + name);
  return source.slice(start, end);
}
const state = { orders: [], userCouponArchivedOrdersByUserId: {}, logs: [] };
let couponRows = [];
const context = vm.createContext({
  Date, Intl, state, couponHistoryRenderSnapshot:null, ownHistoryPageState:null,
  ORDER_SEOUL_DATE_TIME_FORMATTER: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }),
  getEmergencyCompactOrdersForDisplay: () => [],
  getEmergencyCompactHistoryOrdersForDisplay: () => [],
  getCouponHistoryLogsForUser: () => [],
  buildCouponLedgerDisplayRecords: () => couponRows,
  getLatestCouponRecalcTimelineResult: () => null,
  getCombinedOrderHistorySummary: () => null,
  getOrderTotalQuantity: order => order.quantity,
  normalizeHistoryRemainingCoupons: value => value,
  getNormalizedOrderStatus: value => typeof value === 'object' ? value.status : value,
  copyStoredCouponCostSnapshotFields: value => value,
  normalizeShotCount: value => Number(value || 0)
});
for (const name of ['toOrderDate', 'getOrderSeoulDateTimeParts', 'formatAMPM', 'formatMonthDay', 'formatDateTime', 'getDateString', 'getCouponHistoryLinkedIdentifier', 'getCouponHistoryEventIdentityKey', 'getCouponHistoryDownloadEventKey', 'getHistoryItemAnchorKey', 'getCouponHistoryViewportScope', 'getOwnHistoryPage', 'getOwnHistoryVisibleRows', 'hasEarlierHistoryRows', 'showLatestOwnHistory', 'getFirstOrderTimeValue', 'getOrderBusinessTimestamp', 'getOrderBusinessDateKey', 'getCouponHistorySortTime', 'formatCouponLedgerTimestamp', 'formatUserCouponLedgerTimestamp', 'normalizeHistoryDateOnly', 'isHistoryTimestampString', 'getHistoryTimeInfo', 'getOrderHistoryTimeInfo', 'formatHistoryTime', 'getCombinedHistoryItemTime', 'compareCombinedHistoryItemsByTimeDesc', 'mergeOrdersByIdForCouponHistory', 'getUserCouponArchivedOrders', 'getCouponHistoryOrdersForUser', 'getCombinedHistory', 'normalizeArchivedCompletedPayloadToOrder', 'trimCompactOrderText', 'decodeCompactDeliveryType', 'decodeCompactOrderStatus', 'encodeCompactOrderStatus', 'encodeCompactDeliveryType', 'encodeCompactCupType', 'decodeCompactCupType', 'normalizeEmergencyCompactOrderRecord', 'expandEmergencyCompactOrderRecord', 'expandEmergencyCompactHistoryOrderRecord']) {
  vm.runInContext(extract(name), context);
}
let passed = 0;
function test(name, run) { run(); passed++; }
const iso = '2026-11-26T00:05:00.123Z';
const millis = Date.parse(iso);
const seconds = Math.floor(millis / 1000);
const order = extra => ({ id: 'today', userId: 'synthetic-user', status: 'PICKUP_DONE', quantity: 2, remainingCoupons: 18, ...extra });

for (const [name, timestamp] of Object.entries({ iso, date: new Date(iso), timestamp: { toDate: () => new Date(iso) }, serialized: { seconds, nanoseconds: 123000000 }, legacy: { _seconds: seconds, _nanoseconds: 123000000 } })) {
  test(name + ' uses original type', () => {
    const info = context.getOrderHistoryTimeInfo(order({ createdAtServer: timestamp }));
    assert.equal(info.timestamp.getTime(), millis);
    assert.equal(context.formatHistoryTime(info), '11/26 오전 9:05');
  });
}
test('malformed nanoseconds fall through instead of manufacturing a different date', () => {
  const info = context.getOrderHistoryTimeInfo(order({ businessAtServer: { seconds, nanoseconds: 1000000000 }, businessAtServerIso: iso }));
  assert.equal(info.timestamp.getTime(), millis);
});
test('invalid first candidate falls through within original business time', () => {
  const info = context.getOrderHistoryTimeInfo(order({ businessAtServer: { seconds: 'bad' }, businessAtServerIso: iso }));
  assert.equal(info.timestamp.getTime(), millis);
});
test('impossible or incomplete string dates fall through to valid original evidence', () => {
  for (const bad of ['2026-02-30T00:00:00Z','2026-11','2026','2026-11-26T24:01:00Z','Thu, 30 Feb 2026 00:30:00 GMT']) {
    const info = context.getHistoryTimeInfo([bad, iso]);
    assert.equal(info.timestamp.getTime(), millis, bad);
  }
});
test('incomplete precision stays unknown and accepted full legacy strings retain their instant', () => {
  for (const bad of ['2026-11','2026','11/2026','9:05']) assert.equal(context.getHistoryTimeInfo([bad]).timestamp, null, bad);
  for (const full of [' Thu, 26 Nov 2026 00:30:00 GMT ', 'thu, 26 nov 2026 00:30:00 gmt', 'Thu Nov 26 2026 09:30:00 GMT+0900 (Korean Standard Time)']) assert.equal(context.getHistoryTimeInfo([full]).timestamp.getTime(), Date.parse('2026-11-26T00:30:00Z'));
});
test('lossless Firestore Timestamp strings retain exact receipt and reject invalid nanoseconds', () => {
  const text='Timestamp(seconds='+seconds+', nanoseconds=123000000)';
  assert.equal(context.getHistoryTimeInfo([text]).timestamp.getTime(),millis);
  assert.equal(context.getHistoryTimeInfo(['Timestamp(seconds='+seconds+', nanoseconds=1000000000)',iso]).timestamp.getTime(),millis);
});
test('malformed business clock is not proof that a valid business date came from processing', () => {
  const archived=context.normalizeArchivedCompletedPayloadToOrder({orderId:'today',completedAt:iso,businessDate:'2026-11-26',orderLite:order({businessAt:'unknown',businessDate:'2026-11-26',completedAt:iso})});
  const info=context.getOrderHistoryTimeInfo(archived);assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,'2026-11-26');
});
test('independently stored day is not discarded for an unrelated completion server day', () => {
  const processed='2026-11-26T01:00:00+09:00',earlier='2026-11-25T23:59:59+09:00';
  const archived=context.normalizeArchivedCompletedPayloadToOrder({orderId:'today',businessDate:'2026-11-25',completedAt:processed,orderCompletedAtServer:new Date(earlier),orderLite:order({timestamp:'',createdAt:'',businessAt:processed,businessDate:'2026-11-25',processedAt:processed,completedAt:processed})});
  assert.equal(context.getOrderHistoryTimeInfo(archived).historyDateOnly,'2026-11-25');
});
test('coupon ledger formats the resolved timestamp and preserves full years', () => {
  const text='Timestamp(seconds='+seconds+', nanoseconds=123000000)';
  assert.equal(context.formatUserCouponLedgerTimestamp({source:'coupon-history',timestamp:text}),'2026.11.26 오전 09:05');
  const reference={source:'order-record',orderId:'today',userId:'synthetic-user'};
  assert.equal(context.formatUserCouponLedgerTimestamp(reference,order({timestamp:'2025-11-26T00:05:00Z'})),'2025.11.26 오전 09:05');
  assert.equal(context.formatUserCouponLedgerTimestamp(reference,order({timestamp:iso})),'2026.11.26 오전 09:05');
});
test('offsetless timestamp strings cannot establish an instant or device-dependent receipt date', () => {
  const local='2026-11-26T23:30:00';
  assert.equal(context.getHistoryTimeInfo([local]).timestamp,null);assert.equal(context.getHistoryTimeInfo([local]).historyDateOnly,'');
  assert.equal(context.getHistoryTimeInfo([local,iso]).timestamp.getTime(),millis);
  const day=context.getOrderHistoryTimeInfo(order({createdAt:local,businessDate:'2026-11-26'}));assert.equal(day.timestamp,null);assert.equal(day.historyDateOnly,'2026-11-26');
});
test('date-only processing fallback cannot fabricate an original receipt day', () => {
  const day='2026-11-26';
  const archived=context.normalizeArchivedCompletedPayloadToOrder({orderId:'today',completedAt:day,businessDate:day,orderLite:order({businessAt:day,businessDate:day,processedAt:day,completedAt:day})});
  assert.equal(context.getOrderHistoryTimeInfo(archived).timestamp,null);assert.equal(context.getOrderHistoryTimeInfo(archived).historyDateOnly,'');
});
test('serialized processing timestamps cannot establish an original receipt day', () => {
  const raw='Timestamp(seconds='+seconds+', nanoseconds=123000000)';
  const archived=context.normalizeArchivedCompletedPayloadToOrder({orderId:'today',completedAt:raw,businessDate:'2026-11-26',orderLite:order({businessAt:raw,businessDate:'2026-11-26',processedAt:raw,completedAt:raw})});
  const info=context.getOrderHistoryTimeInfo(archived);assert.equal(info.timestamp,null);// A typed SDK value and this original string can produce identical stored JSON.
  assert.equal(info.historyDateOnly,'');
});
test('a valid original business timestamp is not an alias merely because a lifecycle instant matches', () => {
  for(const [business,completed] of [['2026-11-25T14:59:59Z','2026-11-26T01:00:00+09:00'],['2026-11-25T14:59:59Z','2026-11-25T23:59:59+09:00']]){
    const archived=context.normalizeArchivedCompletedPayloadToOrder({orderId:'today',completedAt:completed,orderLite:order({businessAt:business,processedAt:business,completedAt:completed})});
    assert.equal(context.getOrderHistoryTimeInfo(archived).timestamp.getTime(),Date.parse(business));
  }
});
test('raw client receipt presence prevents inventing a completion alias', () => {
  for(const raw of ['bad','2026-11-26T23:30:00']){
    const archived=context.normalizeArchivedCompletedPayloadToOrder({orderId:'today',completedAt:iso,orderLite:order({createdAt:raw,timestamp:raw,businessAt:iso,completedAt:iso})});
    assert.equal(context.getOrderHistoryTimeInfo(archived).timestamp.getTime(),millis);assert.equal(archived.timestamp,raw);
  }
});
test('a day with indistinguishable completion origin remains unknown without preserved precedence', () => {
  const completed='2026-11-26T00:00:01+09:00';
  const payload={orderId:'today',completedAt:completed,businessDate:'2026-11-25',orderLite:order({timestamp:'',createdAt:'',businessAt:completed,completedAt:completed,processedAt:'',businessDate:'2026-11-25'})};
  const ambiguous=context.normalizeArchivedCompletedPayloadToOrder(payload);assert.equal(context.getOrderHistoryTimeInfo(ambiguous).historyDateOnly,'');assert.equal(ambiguous.businessDate,'2026-11-25');
  const proven=context.normalizeArchivedCompletedPayloadToOrder({...payload,orderProcessedAtServer:new Date(completed)});assert.equal(context.getOrderHistoryTimeInfo(proven).historyDateOnly,'2026-11-25');
});
test('compact date strings retain a complete numeric timezone prefix after the label is truncated', () => {
  const exact=new Date('2026-11-26T00:05:00Z'),compactText=exact.toString().slice(0,40);
  assert.equal(context.getHistoryTimeInfo([compactText]).timestamp.getTime(),exact.getTime());
  const compact=context.expandEmergencyCompactHistoryOrderRecord({id:'truncated-date',t:compactText,p:'2026-11-27T00:00:00Z',u:'synthetic-user',q:2,r:18});
  assert.equal(context.getOrderHistoryTimeInfo(compact).timestamp.getTime(),exact.getTime());assert.equal(compact.timestamp,compactText.trim());
});
test('truncated compact SDK timestamps recover a Seoul date without inventing fractional time', () => {
  for(const [instant,expectedDay] of [['2026-11-25T14:59:59Z','2026-11-25'],['2026-11-25T15:00:00Z','2026-11-26']]){
    const text=('Timestamp(seconds='+Math.floor(Date.parse(instant)/1000)+', nanoseconds=999999999)').slice(0,40);
    const compact=context.expandEmergencyCompactHistoryOrderRecord({id:'partial-sdk',t:text,p:'2026-11-27T00:00:00Z',u:'synthetic-user',q:2,r:18});
    const time=context.getOrderHistoryTimeInfo(compact);assert.equal(time.timestamp,null);assert.equal(time.historyDateOnly,expectedDay);assert.equal(compact.timestamp,text);assert.equal(compact.remainingCoupons,18);
    const ambiguous=context.expandEmergencyCompactHistoryOrderRecord({id:'partial-sdk',t:text,p:text,u:'synthetic-user',q:2,r:18});assert.equal(context.getOrderHistoryTimeInfo(ambiguous).historyDateOnly,'');
  }
});
test('completion and backup dates never stand in for receipt date', () => {
  const info = context.getOrderHistoryTimeInfo(order({ completedAt: iso, savedAt: iso, updatedAt: iso }));
  assert.equal(info.timestamp, null);
  assert.equal(context.formatHistoryTime(info), '일시 확인 필요');
});
test('yesterday received and today completed stays yesterday', () => {
  const info = context.getOrderHistoryTimeInfo(order({ timestamp: '2026-11-25T14:59:00Z', completedAt: iso }));
  assert.equal(context.formatHistoryTime(info), '11/25 오후 11:59');
});
test('date only never invents an instant', () => {
  const info = context.getOrderHistoryTimeInfo(order({ businessDate: '2026-11-26' }));
  assert.equal(info.timestamp, null);
  assert.equal(context.getCombinedHistoryItemTime(info), null);
  assert.equal(context.formatHistoryTime(info), '11/26');
});
test('compact Korean business date', () => assert.equal(context.getOrderHistoryTimeInfo(order({ sequenceDate: '20261126' })).historyDateOnly, '2026-11-26'));
test('invalid calendar date stays unknown', () => assert.equal(context.formatHistoryTime(context.getOrderHistoryTimeInfo(order({ businessDate: '2026-02-30' }))), '일시 확인 필요'));
test('Seoul midnight', () => {
  assert.equal(context.formatHistoryTime(context.getHistoryTimeInfo(['2026-11-25T14:59:59Z'])), '11/25 오후 11:59');
  assert.equal(context.formatHistoryTime(context.getHistoryTimeInfo(['2026-11-25T15:00:00Z'])), '11/26 오전 12:00');
});
test('archive retains raw original timestamps without completion fallback', () => {
  const raw = { orderId: 'today', completedAt: iso, orderLite: order({ timestamp: { seconds, nanoseconds: 123000000 } }) };
  const result = context.normalizeArchivedCompletedPayloadToOrder(raw);
  assert.equal(context.getOrderHistoryTimeInfo(result).timestamp.getTime(), millis);
  const unknown = context.normalizeArchivedCompletedPayloadToOrder({ orderId: 'unknown', savedAt: iso, completedAt: iso });
  assert.equal(context.getOrderHistoryTimeInfo(unknown).timestamp, null);
});
test('archive date display preserves existing accounting and status fields', () => {
  const result = context.normalizeArchivedCompletedPayloadToOrder({
    orderId: 'unknown-original-time', savedAt: iso, completedAt: iso,
    orderLite: { userId: 'synthetic-user', status: 'CANCELLED', quantity: 2, totalCups: 2, remainingCoupons: 18, refundQuantity: 2, refundBeforeCoupons: 16, refundAfterCoupons: 18, refundHistoryId: 'original-refund', refundHistoryType: 'COUPON_ORDER_REFUND' }
  });
  for (const [key, value] of Object.entries({ status: 'CANCELLED', quantity: 2, totalCups: 2, remainingCoupons: 18, refundQuantity: 2, refundBeforeCoupons: 16, refundAfterCoupons: 18, refundHistoryId: 'original-refund', timestamp: iso, createdAt: iso, businessAt: iso, completedAt: iso, statusUpdatedAt: iso })) assert.equal(result[key], value, key);
  assert.equal(context.formatHistoryTime(context.getOrderHistoryTimeInfo(result)), '일시 확인 필요');
});
test('order reference dates use original evidence while real transactions keep event time', () => {
  const dateOnlyOrder = order({ businessDate: '2026-11-26' });
  const reference = { id: 'reference', orderId: 'today', userId: 'synthetic-user', source: 'order-record', timestamp: '2026-11-30T09:00:00Z' };
  assert.equal(context.formatUserCouponLedgerTimestamp(reference, dateOnlyOrder), '2026.11.26');
  assert.equal(context.formatUserCouponLedgerTimestamp(reference, order({})), '일시 확인 필요');
  assert.equal(context.formatUserCouponLedgerTimestamp({ ...reference, source: 'cancelled-order-record', timestamp: iso }, dateOnlyOrder), '2026.11.26 오전 09:05');
  assert.equal(context.formatUserCouponLedgerTimestamp({ ...reference, source: 'coupon-history', timestamp: iso }, dateOnlyOrder), '2026.11.26 오전 09:05');
});
test('duplicate copy retains original time and authoritative financial fields', () => {
  const live = order({ timestamp: iso, quantity: 1 });
  const archived = order({ quantity: 3, remainingCoupons: 17 });
  const before = JSON.stringify([live, archived]);
  const merged = context.mergeOrdersByIdForCouponHistory([live], [archived]);
  assert.equal(merged.length, 1);
  assert.equal(context.getOrderHistoryTimeInfo(merged[0]).timestamp.getTime(), millis);
  assert.equal(merged[0].quantity, 3);
  assert.equal(merged[0].remainingCoupons, 17);
  assert.equal(JSON.stringify([live, archived]), before);
});
test('foreign user cannot donate a timestamp', () => {
  const merged = context.mergeOrdersByIdForCouponHistory([order({ timestamp: iso })], [order({ userId: 'other' })]);
  assert.equal(context.getOrderHistoryTimeInfo(merged[0]).timestamp, null);
});
test('mixed history ordering, pagination, doc ID ties and unchanged values', () => {
  state.orders = [order({ businessAtServer: { seconds, nanoseconds: 123000000 } }), order({ id: 'june', timestamp: '2026-06-16T00:00:00Z' }), order({ id: 'unknown' }), order({ id: 'foreign', userId: 'other', timestamp: iso }), order({ id: 'date-only', businessDate: '2026-11-26' })];
  couponRows = [
    { id: 'nov-charge', docId: 'coupon_event_nov', userId: 'synthetic-user', type: 'COUPON_CHARGE', timestamp: '2026-11-13T00:00:00Z', amount: 10, delta: 10, remainingCoupons: 28 },
    { id: 'oct-charge', userId: 'synthetic-user', type: 'COUPON_CHARGE', timestamp: '2026-10-01T00:00:00Z', amount: 10, delta: 10 },
    { id: 'sep-charge', userId: 'synthetic-user', type: 'COUPON_CHARGE', timestamp: '2026-09-01T00:00:00Z', amount: 10, delta: 10 },
    ...['a', 'z'].map(id => ({ id, docId: 'coupon_event_' + id, userId: 'synthetic-user', type: 'COUPON_ORDER_REFUND', timestamp: iso, amount: 1, delta: 1 }))
  ];
  const before = JSON.stringify({ state, couponRows });
  const rows = context.getCombinedHistory('synthetic-user', undefined, true);
  assert(rows.findIndex(row => row.id === 'today') < 5);
  assert(rows.findIndex(row => row.id === 'today') < rows.findIndex(row => row.id === 'nov-charge'));
  assert(rows.findIndex(row => row.id === 'z') < rows.findIndex(row => row.id === 'a'));
  assert.equal(rows.at(-1).id, 'unknown');
  assert(!rows.some(row => row.id === 'foreign'));
  assert.equal(new Set([...rows.slice(0, 5), ...rows.slice(5)].map(row => row.id)).size, rows.length);
  assert.equal(rows.find(row => row.id === 'today').remainingCoupons, 18);
  assert.equal(rows.find(row => row.id === 'nov-charge').delta, 10);
  assert.equal(JSON.stringify({ state, couponRows }), before);
});
test('date-only equal stored coupon times keep descending document IDs without inventing a time', () => {
  state.orders = [];
  couponRows = ['a','z'].map(id => ({ id, docId: 'coupon_event_' + id, userId: 'synthetic-user', type: 'COUPON_CHARGE', timestamp: '2026-11-26', amount: 1, delta: 1 }));
  const rows = context.getCombinedHistory('synthetic-user', undefined, true);
  assert.deepEqual(Array.from(rows, row => row.id), ['z','a']);
  assert(rows.every(row => row.timestamp === null && row.historyDateOnly === '2026-11-26'));
});
test('writer completion fallback cannot replace the known receipt business day', () => {
  const completed = '2026-11-26T01:00:00Z';
  const archived = context.normalizeArchivedCompletedPayloadToOrder({ orderId: 'day-only', businessAt: completed, completedAt: completed, businessDate: '2026-11-25', orderLite: order({ id: 'day-only', timestamp: '', createdAt: '', businessAt: completed, processedAt:completed, businessDate: '2026-11-25' }) });
  assert.equal(context.formatHistoryTime(context.getOrderHistoryTimeInfo(archived)), '11/25');
  assert.equal(archived.businessAt, completed);
});
test('compact view evidence does not change persisted financial fields or hide legacy provenance loss', () => {
  const raw = { id:'p-only', u:'synthetic-user', p:iso, q:2, r:18 };
  const compact = context.normalizeEmergencyCompactOrderRecord(raw);
  assert.equal(compact.t, iso); // Existing accounting/reporting fallback is preserved.
  assert.equal(context.getOrderHistoryTimeInfo(context.expandEmergencyCompactHistoryOrderRecord(compact)).timestamp, null);
  assert(!Object.keys(compact).includes('historyOriginalTimeInfo'));
  const reloaded = context.expandEmergencyCompactHistoryOrderRecord(JSON.parse(JSON.stringify(compact)));
  assert.equal(reloaded.timestamp, iso); // Already-lost provenance cannot be inferred or repaired.
  assert.equal(reloaded.quantity, 2);
  assert.equal(reloaded.remainingCoupons, 18);
});
test('display references share the order receipt while accounting and independent events retain their clocks', () => {
  state.orders = [order({ timestamp:'2026-11-25T14:59:59Z', createdAtServer:'2026-11-25T15:00:01Z', status:'PENDING' })];
  couponRows = [{ id:'ref', orderId:'today', userId:'synthetic-user', source:'order-record', type:'COUPON_ORDER_USE', timestamp:'2026-11-25T14:59:59Z', amount:1, delta:-1 }, { id:'real', orderId:'today', userId:'synthetic-user', source:'coupon-history', type:'COUPON_ORDER_USE', timestamp:'2026-11-25T14:59:59Z', amount:1, delta:-1 }];
  const rows = context.getCombinedHistory('synthetic-user', undefined, true);
  assert.equal(rows.find(row=>row.id==='ref').timestamp.getTime(), rows.find(row=>row.id==='today').timestamp.getTime());
  assert.equal(rows.find(row=>row.id==='real').timestamp.getTime(), Date.parse('2026-11-25T14:59:59Z'));
});
test('date-only coupons cannot join exact-time document ID ties', () => {
  vm.runInContext(extract('getUserCouponLedgerDisplayRecords'), context);
  state.orders = [];
  couponRows = [{ id:'day', docId:'coupon_event_z', userId:'synthetic-user', type:'COUPON_CHARGE', timestamp:'2026-11-26', amount:1, delta:1 }, { id:'instant', docId:'coupon_event_a', userId:'synthetic-user', type:'COUPON_CHARGE', timestamp:'2026-11-26T00:00:00Z', amount:1, delta:1 }];
  assert.deepEqual(Array.from(context.getUserCouponLedgerDisplayRecords('synthetic-user', undefined, true), row=>row.id), ['instant','day']);
});
test('full ledger ID ties use resolved display times instead of stale event clocks', () => {
  vm.runInContext(extract('getUserCouponLedgerDisplayRecords'),context);
  state.orders=[order({timestamp:'2026-11-25T14:59:59Z',createdAtServer:'2026-11-25T15:00:01Z'})];
  couponRows=[{id:'charge',docId:'coupon_event_z',userId:'synthetic-user',source:'coupon-history',timestamp:'2026-11-25T14:59:59Z',type:'COUPON_CHARGE',delta:1,amount:1},{id:'reference',docId:'coupon_event_a',orderId:'today',userId:'synthetic-user',source:'order-record',timestamp:'2026-11-25T14:59:59Z',type:'COUPON_ORDER_USE',delta:-1,amount:1}];
  assert.deepEqual(Array.from(context.getUserCouponLedgerDisplayRecords('synthetic-user',undefined,true),row=>row.id),['reference','charge']);
});
test('ledger event anchors survive a local record being replaced by its protected cloud copy', () => {
  for(const name of ['getCouponHistoryLinkedIdentifier','getCouponHistoryEventIdentityKey','getCouponHistoryDownloadEventKey'])vm.runInContext(extract(name),context);
  for(const type of ['COUPON_ORDER_USE','COUPON_ORDER_REFUND']){
    const local={id:'local-reference',type,orderId:'today',userId:'synthetic-user'};
    const cloud={...local,id:'server-record',docId:'coupon_event_server'};
    assert.equal(context.getCouponHistoryDownloadEventKey(local),context.getCouponHistoryDownloadEventKey(cloud));
  }
  assert.notEqual(context.getCouponHistoryDownloadEventKey({type:'COUPON_ORDER_USE',orderId:'today'}),context.getCouponHistoryDownloadEventKey({type:'COUPON_ORDER_REFUND',orderId:'today'}));
});
test('customer coupon view anchors retain event identity when the local row becomes a cloud copy', () => {
  state.orders=[order({status:'PENDING',timestamp:iso})];
  const local={id:'local-coupon',orderId:'today',userId:'synthetic-user',source:'order-record',timestamp:iso,type:'COUPON_ORDER_USE',delta:-1,amount:1};
  couponRows=[local];const before=context.getCombinedHistory('synthetic-user',undefined,true).find(row=>row.type==='COUPON_ORDER_USE');
  couponRows=[{...local,id:'cloud-coupon',docId:'coupon_event_cloud'}];const after=context.getCombinedHistory('synthetic-user',undefined,true).find(row=>row.type==='COUPON_ORDER_USE');
  assert.notEqual(before.id,after.id);assert.equal(context.getHistoryItemAnchorKey(before),context.getHistoryItemAnchorKey(after));
  assert.equal(context.getHistoryItemAnchorKey(after),'COUPON_ORDER_USE:order:today');
});
test('writer-derived completion day is not a receipt date', () => {
  const archived = context.normalizeArchivedCompletedPayloadToOrder({ orderId: 'unknown-writer-day', businessAt: iso, completedAt: iso, businessDate: '2026-11-26', orderLite: order({ timestamp: '', createdAt: '', businessAt: iso, businessDate: '2026-11-26' }) });
  assert.equal(context.formatHistoryTime(context.getOrderHistoryTimeInfo(archived)), '일시 확인 필요');
  const declared = context.normalizeArchivedCompletedPayloadToOrder({ orderId: 'known-day', completedAt: iso, businessDate: '2026-11-26', orderLite: order({ timestamp: '', createdAt: '' }) });
  assert.equal(context.formatHistoryTime(context.getOrderHistoryTimeInfo(declared)), '11/26');
});
test('recent coupon rows are sliced after resolving displayed order reference dates', () => {
  vm.runInContext(extract('getUserCouponLedgerDisplayRecords'), context);
  state.orders = [order({ timestamp: '2026-11-20T00:00:00Z' })];
  couponRows = [{ id: 'old-order-reference', orderId: 'today', userId: 'synthetic-user', source: 'order-record', type: 'COUPON_ORDER_USE', timestamp: '2026-11-30T00:00:00Z', amount: 1, delta: -1 }, ...[25,24,23,22,21].map(day => ({ id: 'charge-' + day, userId: 'synthetic-user', source: 'coupon-history', type: 'COUPON_CHARGE', timestamp: '2026-11-' + day + 'T00:00:00Z', amount: 1, delta: 1 }))];
  const before = JSON.stringify(couponRows);
  const recent = context.getUserCouponLedgerDisplayRecords('synthetic-user', 5, false);
  assert.deepEqual(Array.from(recent, row => row.id), ['charge-25','charge-24','charge-23','charge-22','charge-21']);
  assert.equal(JSON.stringify(couponRows), before);
});
test('same-order copies retain stronger server receipt evidence while latest business fields win', () => {
  const live = order({ timestamp:'2026-11-25T14:59:59Z', createdAtServer:{seconds:Date.parse('2026-11-25T15:00:01Z')/1000,nanoseconds:0}, statusRevision:1 });
  const archived = context.normalizeArchivedCompletedPayloadToOrder({ orderId:'today', orderLite:order({ timestamp:'2026-11-25T14:59:59Z', statusRevision:9, remainingCoupons:17 }) });
  const before = JSON.stringify([live,archived]);
  const merged = context.mergeOrdersByIdForCouponHistory([live],[archived])[0];
  assert.equal(context.getOrderHistoryTimeInfo(merged).timestamp.getTime(), Date.parse('2026-11-25T15:00:01Z'));
  assert.equal(merged.timestamp, archived.timestamp);
  assert.equal(merged.statusRevision,9);
  assert.equal(merged.remainingCoupons,17);
  assert.equal(JSON.stringify([live,archived]),before);
  const other = context.mergeOrdersByIdForCouponHistory([live],[{...archived,userId:'another-user'}])[0];
  assert.equal(context.getOrderHistoryTimeInfo(other).timestamp.getTime(), Date.parse('2026-11-25T14:59:59Z'));
});
test('compact processing-only copies cannot donate receipt time or change stored fields', () => {
  const raw = { id: 'compact', u: 'synthetic-user', p: iso, q: 2, r: 18 };
  const normalized = context.normalizeEmergencyCompactOrderRecord(raw);
  assert.equal(normalized.t, iso); // Preserve legacy accounting/reporting fallback; view metadata is separate.
  assert.equal(normalized.p, iso);
  assert(!Object.keys(normalized).includes('historyOriginalTimeInfo'));
  const compact = context.expandEmergencyCompactHistoryOrderRecord(normalized);
  assert.equal(context.getOrderHistoryTimeInfo(compact).timestamp, null);
  const archived = context.normalizeArchivedCompletedPayloadToOrder({ orderId: 'compact', completedAt: iso, orderLite: order({ id: 'compact' }) });
  const merged = context.mergeOrdersByIdForCouponHistory([compact], [archived]);
  assert.equal(context.getOrderHistoryTimeInfo(merged[0]).timestamp, null);
  const sameInstant = context.expandEmergencyCompactHistoryOrderRecord({ ...raw, t: iso });
  assert.equal(context.getOrderHistoryTimeInfo(sameInstant).timestamp, null); // Stored t=p cannot prove a receipt, even if it was genuine.
  const received = context.expandEmergencyCompactHistoryOrderRecord({ ...raw, t: '2026-11-25T00:00:00Z' });
  assert.equal(context.formatHistoryTime(context.getOrderHistoryTimeInfo(received)), '11/25 오전 9:00');
});
test('ambiguous compact receipt stays unknown after JSON while full original evidence restores only the view', () => {
  const compact = context.normalizeEmergencyCompactOrderRecord({id:'today',u:'synthetic-user',p:iso,q:2,r:18});
  const before = JSON.stringify(compact);
  for(const value of [compact,JSON.parse(before),context.normalizeEmergencyCompactOrderRecord(JSON.parse(before))]) assert.equal(context.getOrderHistoryTimeInfo(context.expandEmergencyCompactHistoryOrderRecord(value)).timestamp,null);
  const merged = context.mergeOrdersByIdForCouponHistory([context.expandEmergencyCompactHistoryOrderRecord(compact)],[order({timestamp:iso})])[0];
  assert.equal(context.getOrderHistoryTimeInfo(merged).timestamp.getTime(),millis);
  assert.equal(JSON.stringify(compact),before);
});
test('malformed active orders stay excluded', () => {
  state.orders = [order({ id: undefined }), order({ id: '' }), order({ timestamp: iso })];
  assert.deepEqual(Array.from(context.getCouponHistoryOrdersForUser('synthetic-user'), row => row.id), ['today']);
});
test('calendar formatting stays linear for a thousand visible history rows', () => {
  state.orders = Array.from({ length: 1000 }, (_, i) => order({ id: 'perf-' + i, timestamp: new Date(millis - i * 60000).toISOString() }));
  couponRows = [];
  let calls = 0;
  const original = context.getDateString;
  context.getDateString = value => { calls++; return original(value); };
  const rows = context.getCombinedHistory('synthetic-user');
  context.getDateString = original;
  assert.equal(rows.length, 1000);
  assert(calls <= 1000, 'Repeated calendar formatting in comparator: ' + calls);
});
test('date-only refunds preserve the previous latest-balance decision', () => {
  context.getLatestCouponRecalcOrderResult = () => null;
  context.getCouponHistoryEffectiveDelta = item => Number(item.delta);
  vm.runInContext(extract('normalizeCombinedOrderCancelReason'), context);
  vm.runInContext(extract('getCombinedOrderHistorySummary'), context);
  state.orders = [order({ id: 'balance', status: 'CANCELLED', timestamp: '2026-11-25T00:00:00Z', quantity: 1, remainingCoupons: 20 })];
  couponRows = [
    { id: 'use', orderId: 'balance', userId: 'synthetic-user', type: 'COUPON_ORDER_USE', timestamp: '2026-11-25T00:00:00Z', amount: 1, delta: -1, remainingCoupons: 19, source: 'coupon-history' },
    { id: 'refund', orderId: 'balance', userId: 'synthetic-user', type: 'COUPON_ORDER_REFUND', timestamp: '2026-11-26', amount: 1, delta: 1, remainingCoupons: 20, source: 'coupon-history' }
  ];
  const before = JSON.stringify(couponRows);
  const rows = context.getCombinedHistory('synthetic-user');
  assert.equal(rows[0].remainingCoupons, 20);
  assert.equal(rows[0].cancelledQty, 1);
  assert.equal(context.getHistoryTimeInfo(['2026-11-26']).timestamp, null);
  assert.equal(JSON.stringify(couponRows), before);
});

test('recent five unchanged coupon events reuse existing ordering without calendar conversions', () => {
  vm.runInContext(extract('getUserCouponLedgerDisplayRecords'), context);
  state.orders=[];
  couponRows=Array.from({length:1000},(_,i)=>({id:'event-'+i,userId:'synthetic-user',source:'coupon-history',timestamp:new Date(millis-i*60000).toISOString(),type:'COUPON_CHARGE',delta:1,amount:1}));
  let calls=0; const original=context.getDateString;
  context.getDateString=value=>{calls++;return original(value);};
  try {assert.deepEqual(Array.from(context.getUserCouponLedgerDisplayRecords('synthetic-user',5,false),row=>row.id),['event-0','event-1','event-2','event-3','event-4']);assert.equal(calls,0);} finally {context.getDateString=original;}
});
test('recalculation ledger keeps stored event ordering when customer history uses receipt ordering', () => {
  vm.runInContext(extract('getCouponRecalcExistingDisplayRecords'),context);
  state.couponRecalcSourceData=null;
  state.orders=[order({timestamp:'2026-11-25T14:59:59Z',createdAtServer:'2026-11-25T15:00:01Z'})];
  couponRows=[{id:'charge',userId:'synthetic-user',source:'coupon-history',timestamp:'2026-11-25T15:00:00Z',type:'COUPON_CHARGE',delta:1,amount:1},{id:'reference',orderId:'today',userId:'synthetic-user',source:'order-record',timestamp:'2026-11-25T14:59:59Z',type:'COUPON_ORDER_USE',delta:-1,amount:1}];
  assert.deepEqual(Array.from(context.getUserCouponLedgerDisplayRecords('synthetic-user'),row=>row.id),['reference','charge']);
  assert.deepEqual(Array.from(context.getCouponRecalcExistingDisplayRecords({id:'synthetic-user'}),row=>row.id),['charge','reference']);
});

vm.runInContext(extract('getCombinedHistoryForRender'), context);
vm.runInContext(extract('renderCouponHistoryPreservingViewport'), context);
function viewportFixture(options = {}) {
  Object.assign(state, { ocShowHistory: true, historyUserId: '', appRole: 'CUSTOMER', currentView: 'ORDER_COMPLETE', currentOrderId: 'a', selectedUserId: 'b:c', userCouponHistoryGeneration: 1 });
  const attributes = { 'data-action': 'show-more-own-history' };
  const body = { tagName: 'BODY' };
  const document = { body, activeElement: null };
  let focuses = 0, renders = 0, after = false;
  const button = () => ({ tagName: 'BUTTON', disabled: false, getAttribute: name => attributes[name] ?? null, focus: function () { focuses++; document.activeElement = this; } });
  const previousButton = button(), nextButton = button();
  const previousList = { scrollTop: 280, scrollLeft: 7 };
  const nextList = { scrollTop: 0, scrollLeft: 0 };
  const previousModal = { scrollTop: 35, scrollLeft: 0, contains: node => node === previousButton, querySelectorAll: () => [previousList] };
  const nextModal = { scrollTop: 0, scrollLeft: 0, querySelectorAll: selector => selector.startsWith('button') ? [nextButton] : [nextList] };
  document.activeElement = options.bodyFocus ? body : previousButton;
  context.window = { firebaseAuthUser: { uid: 'auth-one' } };
  context.document = document;
  context.app = { querySelector: () => { throw new Error('History modals are siblings of the app'); } };
  context.modalRoot = { querySelector: () => ({ closest: () => after ? nextModal : previousModal }) };
  context.render = () => {
    renders++; after = true; document.activeElement = body;
    if (options.userChange) state.selectedUserId = 'other';
    if (options.generationChange) state.userCouponHistoryGeneration++;
    if (options.authChange) context.window.firebaseAuthUser.uid = 'auth-two';
    if (options.colonCollision) { state.currentOrderId = 'a:b'; state.selectedUserId = 'c'; }
  };
  context.renderCouponHistoryPreservingViewport();
  return { renders, focuses, top: nextList.scrollTop, left: nextList.scrollLeft, modalTop: nextModal.scrollTop, active: document.activeElement, body };
}
test('late response preserves the real modal owner and focused keyboard control', () => {
  const result = viewportFixture();
  assert.equal(result.renders, 1);
  assert.equal(result.top, 280);
  assert.equal(result.left, 7);
  assert.equal(result.modalTop, 35);
  assert.equal(result.focuses, 1);
});
test('late response keeps body focus without inventing a focus target', () => {
  const result = viewportFixture({ bodyFocus: true });
  assert.equal(result.top, 280);
  assert.equal(result.focuses, 0);
  assert.equal(result.active, result.body);
});
test('inserted earlier rows retain the visible focused record even past the old page boundary', () => {
  Object.assign(state, { ocShowHistory: true, historyUserId: '', appRole: 'CUSTOMER', currentView: 'ORDER_COMPLETE', currentOrderId: 'current', selectedUserId: 'synthetic-user', ownHistoryDetailOrderId: '', ownHistoryVisibleCount: 20 });
  const body = { tagName: 'BODY' }, document = { body, activeElement: null };
  const oldIds = Array.from({ length: 20 }, (_, i) => 'row-' + i);
  const newIds = [...Array.from({ length: 10 }, (_, i) => 'new-' + i), ...oldIds];
  let current, focuses = 0, historyReads = 0;
  function surface(ids, top) {
    const modal = { scrollTop: 35, scrollLeft: 0 };
    const list = { id: 'ownHistoryList', scrollLeft: 0, closest: () => modal };
    let listTop = top;
    Object.defineProperty(list, 'scrollTop', { get: () => listTop, set: value => { listTop = Math.max(0, Math.min(ids.length * 40 - 240, value)); } });
    list.getBoundingClientRect = () => ({ top: 135 - modal.scrollTop, bottom: 375 - modal.scrollTop });
    const rows = ids.map((id, index) => ({
      getAttribute: name => name === 'data-own-history-id' ? id : null,
      hasAttribute: name => name === 'data-own-history-id',
      getBoundingClientRect: () => ({ top: list.getBoundingClientRect().top + index * 40 - list.scrollTop, bottom: list.getBoundingClientRect().top + (index + 1) * 40 - list.scrollTop })
    }));
    const button = { tagName: 'BUTTON', disabled: false, closest: () => rows[ids.indexOf('row-17')], getAttribute: name => ({ 'data-action': 'open-own-history-detail', 'data-order-id': 'row-17' })[name] ?? null, focus: function () { focuses++; document.activeElement = this; } };
    list.contains = node => node === button;
    list.querySelectorAll = () => rows;
    modal.contains = node => node === button;
    modal.querySelectorAll = selector => selector.startsWith('button') ? [button] : [list];
    return { modal, list, rows, button };
  }
  current = surface(oldIds, 560);
  const originalTop = current.button.closest().getBoundingClientRect().top;
  document.activeElement = current.button;
  context.window = { firebaseAuthUser: { uid: 'auth-one' } };
  context.document = document;
  context.modalRoot = { querySelector: () => current.list };
  context.getOrderById = () => null;
  context.getCombinedHistory = () => { historyReads++; return newIds.map(id => ({ id })); };
  context.render = () => { const reused=context.getCombinedHistoryForRender('synthetic-user'); assert.equal(reused.length,newIds.length); current = surface(newIds.slice(0, state.ownHistoryVisibleCount), 0); document.activeElement = body; };
  context.ownHistoryPageState=null;context.getOwnHistoryVisibleRows(oldIds.map(id=>({id})),'synthetic-user');
  context.renderCouponHistoryPreservingViewport();
  assert.equal(state.ownHistoryVisibleCount, 30);
  assert.equal(current.list.scrollTop, 960);
  assert.equal(current.button.closest().getBoundingClientRect().top, originalTop);
  assert.equal(document.activeElement, current.button);
  assert.equal(focuses, 1);
  assert.equal(historyReads, 1);
  assert.equal(context.couponHistoryRenderSnapshot,null);
});
test('offscreen keyboard focus stays present without becoming the visible row anchor', () => {
  Object.assign(state,{ocShowHistory:true,historyUserId:'',appRole:'CUSTOMER',currentView:'ORDER_COMPLETE',currentOrderId:'current',selectedUserId:'synthetic-user',ownHistoryDetailOrderId:'',ownHistoryVisibleCount:10});
  const oldIds=Array.from({length:10},(_,i)=>'row-'+i),newIds=[...oldIds.slice(0,5),'new-0','new-1','new-2','new-3',...oldIds.slice(5)];
  const body={tagName:'BODY'},document={body,activeElement:null};let current;
  function surface(ids){
    const modal={scrollTop:0,scrollLeft:0},list={id:'ownHistoryList',scrollLeft:0,closest:()=>modal};let top=0;
    Object.defineProperty(list,'scrollTop',{get:()=>top,set:value=>{top=Math.max(0,Math.min(ids.length*40-240,value));}});
    list.getBoundingClientRect=()=>({top:100,bottom:340});
    const rows=ids.map((id,index)=>({getAttribute:name=>name==='data-own-history-id'?id:null,hasAttribute:name=>name==='data-own-history-id',getBoundingClientRect:()=>({top:100+index*40-top,bottom:140+index*40-top})}));
    const button=ids.includes('row-8')?{tagName:'BUTTON',disabled:false,closest:()=>rows[ids.indexOf('row-8')],getAttribute:name=>({'data-action':'open-own-history-detail','data-order-id':'row-8'})[name]??null,focus:function(){document.activeElement=this;}}:null;
    list.contains=node=>node===button;list.querySelectorAll=()=>rows;modal.contains=node=>node===button;modal.querySelectorAll=selector=>selector.startsWith('button')?(button?[button]:[]):[list];
    return{modal,list,rows,button};
  }
  current=surface(oldIds);document.activeElement=current.button;
  context.document=document;context.window={firebaseAuthUser:{uid:'auth-one'}};context.modalRoot={querySelector:()=>current.list};context.getOrderById=()=>null;
  context.getCombinedHistory=()=>newIds.map(id=>({id}));context.render=()=>{current=surface(newIds.slice(0,state.ownHistoryVisibleCount));document.activeElement=body;};
  context.ownHistoryPageState=null;context.getOwnHistoryVisibleRows(oldIds.map(id=>({id})),'synthetic-user');
  context.renderCouponHistoryPreservingViewport();
  assert.equal(current.list.scrollTop,0);assert.equal(current.rows[0].getAttribute('data-own-history-id'),'row-0');assert.equal(current.rows[0].getBoundingClientRect().top,100);
  assert.equal(state.ownHistoryVisibleCount,13);assert.equal(document.activeElement,current.button);assert(current.button);
});
test('outer modal scrolling anchors a visible row even when the inner list cannot scroll', () => {
  Object.assign(state,{ocShowHistory:true,historyUserId:'',appRole:'CUSTOMER',currentView:'ORDER_COMPLETE',currentOrderId:'current',selectedUserId:'synthetic-user',ownHistoryDetailOrderId:'',ownHistoryVisibleCount:10});
  const oldIds=Array.from({length:10},(_,i)=>'row-'+i),newIds=['new-0','new-1',...oldIds];
  const body={tagName:'BODY'},document={body,activeElement:body};let current,reads=0;
  function surface(ids,modalTop){
    const modal={scrollTop:modalTop,scrollLeft:0,contains:()=>false,getBoundingClientRect:()=>({top:0,bottom:200})};
    const list={id:'ownHistoryList',scrollLeft:0,closest:()=>modal,contains:()=>false};
    Object.defineProperty(list,'scrollTop',{get:()=>0,set:()=>{}}); // Inner content expands instead of scrolling.
    list.getBoundingClientRect=()=>({top:50-modal.scrollTop,bottom:50-modal.scrollTop+ids.length*40});
    const rows=ids.map((id,index)=>({getAttribute:name=>name==='data-own-history-id'?id:null,hasAttribute:name=>name==='data-own-history-id',getBoundingClientRect:()=>({top:50-modal.scrollTop+index*40,bottom:90-modal.scrollTop+index*40})}));
    list.querySelectorAll=()=>rows;modal.querySelectorAll=selector=>selector.startsWith('button')?[]:[list];return{modal,list,rows};
  }
  current=surface(oldIds,200);const original=current.rows[3].getBoundingClientRect().top;
  context.document=document;context.window={innerHeight:200,firebaseAuthUser:{uid:'auth-one'}};context.modalRoot={querySelector:()=>current.list};context.getOrderById=()=>null;
  context.getCombinedHistory=()=>{reads++;return newIds.map(id=>({id}));};context.render=()=>{assert.equal(context.getCombinedHistoryForRender('synthetic-user').length,12);current=surface(newIds.slice(0,state.ownHistoryVisibleCount),0);};
  context.ownHistoryPageState=null;context.getOwnHistoryVisibleRows(oldIds.map(id=>({id})),'synthetic-user');
  context.renderCouponHistoryPreservingViewport();
  assert.equal(current.rows.find(row=>row.getAttribute('data-own-history-id')==='row-3').getBoundingClientRect().top,original);
  assert.equal(current.list.scrollTop,0);assert.equal(current.modal.scrollTop,280);assert.equal(reads,1);assert.equal(context.couponHistoryRenderSnapshot,null);
});
for (const key of ['userChange', 'generationChange', 'authChange', 'colonCollision']) {
  test(key + ' cannot restore another history context', () => {
    const result = viewportFixture({ [key]: true });
    assert.equal(result.top, 0);
    assert.equal(result.focuses, 0);
  });
}
function boundedHistoryFixture(oldRecords,focusedId='row-17'){
  Object.assign(state,{ocShowHistory:true,historyUserId:'',appRole:'CUSTOMER',currentView:'ORDER_COMPLETE',currentOrderId:'current',selectedUserId:'synthetic-user',userCouponHistoryGeneration:1,ownHistoryDetailOrderId:'',ownHistoryVisibleCount:20});
  const body={tagName:'BODY'},document={body,activeElement:null};let records=oldRecords,current,reads=0;
  function surface(items,top){
    const modal={scrollTop:35,scrollLeft:0,getBoundingClientRect:()=>({top:0,bottom:700})},list={id:'ownHistoryList',scrollLeft:0,closest:()=>modal};let scroll=top;
    Object.defineProperty(list,'scrollTop',{get:()=>scroll,set:value=>{scroll=Math.max(0,Math.min(Math.max(0,items.length*40-240),value));}});
    list.getBoundingClientRect=()=>({top:135-modal.scrollTop,bottom:375-modal.scrollTop});
    const rows=items.map((record,index)=>({record,getAttribute:name=>name==='data-own-history-id'?context.getHistoryItemAnchorKey(record):null,hasAttribute:name=>name==='data-own-history-id',getBoundingClientRect:()=>({top:list.getBoundingClientRect().top+index*40-list.scrollTop,bottom:list.getBoundingClientRect().top+(index+1)*40-list.scrollTop})}));
    const row=rows.find(item=>item.record.id===focusedId),button=row?{tagName:'BUTTON',disabled:false,closest:()=>row,getAttribute:name=>({'data-action':'open-own-history-detail','data-order-id':focusedId})[name]??null,focus:function(){document.activeElement=this;}}:null;
    list.contains=node=>node===button;list.querySelectorAll=()=>rows;modal.contains=node=>node===button;modal.querySelectorAll=selector=>selector.startsWith('button')?(button?[button]:[]):[list];return{modal,list,rows,button};
  }
  context.window={innerHeight:800,firebaseAuthUser:{uid:'auth-one'}};context.document=document;context.ownHistoryPageState=null;
  context.getOwnHistoryVisibleRows(records,'synthetic-user');
  current=surface(oldRecords.slice(0,20),focusedId==='row-0'?0:560);document.activeElement=current.button||body;
  context.modalRoot={querySelector:()=>current.list};context.getOrderById=()=>null;
  context.getCombinedHistory=()=>{reads++;return records;};
  context.render=()=>{const shown=context.getOwnHistoryVisibleRows(context.getCombinedHistoryForRender('synthetic-user'),'synthetic-user');current=surface(shown,0);document.activeElement=body;};
  return {get current(){return current;},get document(){return document;},apply(next){records=next;reads=0;context.renderCouponHistoryPreservingViewport();assert.equal(reads,1);assert.equal(context.couponHistoryRenderSnapshot,null);return current;},more(){state.ownHistoryVisibleCount+=15;context.getOwnHistoryPage('synthetic-user').requestedCount=state.ownHistoryVisibleCount;return this.apply(records);}};
}
test('large prepends keep twenty fresh rows and every hidden record remains reachable by explicit More', () => {
  const old=Array.from({length:40},(_,i)=>({id:'row-'+i,value:0}));const fixture=boundedHistoryFixture(old);
  const beforeTop=fixture.current.button.closest().getBoundingClientRect().top;
  const prefix=Array.from({length:1000},(_,i)=>({id:'new-'+i,value:i}));const fresh=old.map(row=>({...row,value:row.id==='row-5'?99:0}));const all=[...prefix,...fresh],before=JSON.stringify(all);
  fixture.apply(all);assert.equal(fixture.current.rows.length,20);assert.equal(state.ownHistoryVisibleCount,20);assert.equal(fixture.current.button.closest().getBoundingClientRect().top,beforeTop);assert.equal(fixture.document.activeElement,fixture.current.button);assert.equal(fixture.current.rows.find(row=>row.record.id==='row-5').record.value,99);
  assert(context.ownHistoryPageState.keys.every(key=>typeof key==='string'));
  fixture.more();assert.equal(fixture.current.rows.length,35);assert.deepEqual(fixture.current.rows.map(row=>row.record.id),old.slice(0,35).map(row=>row.id));
  fixture.more();assert.equal(fixture.current.rows.length,50);assert.deepEqual(fixture.current.rows.slice(0,10).map(row=>row.record.id),prefix.slice(0,10).map(row=>row.id));
  let clicks=2;while(fixture.current.rows.length<all.length){fixture.more();clicks++;assert(clicks<=68);assert.equal(new Set(fixture.current.rows.map(row=>row.record.id)).size,fixture.current.rows.length);}
  assert.equal(clicks,68);assert.deepEqual(fixture.current.rows.map(row=>row.record.id),all.map(row=>row.id));assert.equal(JSON.stringify(all),before);
  fixture.more();assert.equal(fixture.current.rows.length,1040);assert.equal(context.ownHistoryPageState.pending,15);
  const later=[...all,...Array.from({length:15},(_,i)=>({id:'server-later-'+i}))];fixture.apply(later);assert.equal(fixture.current.rows.length,1055);assert.equal(context.ownHistoryPageState.pending,0);assert.deepEqual(fixture.current.rows.map(row=>row.record.id),later.map(row=>row.id));
  context.window.firebaseAuthUser.uid='auth-two';const reset=context.getOwnHistoryVisibleRows(all,'synthetic-user');assert.equal(reset.length,5);assert.equal(context.ownHistoryPageState.keys,null);assert.deepEqual(Array.from(reset,row=>row.id),prefix.slice(0,5).map(row=>row.id));
});
test('small repeated insertions cannot cumulatively grow the page without a More request', () => {
  const old=Array.from({length:20},(_,i)=>({id:'row-'+i})),fixture=boundedHistoryFixture(old);let prefix=[];
  for(let batch=0;batch<10;batch++){
    prefix=[...Array.from({length:10},(_,i)=>({id:'batch-'+batch+'-'+i})),...prefix];fixture.apply([...prefix,...old]);assert(fixture.current.rows.length<=35);assert(state.ownHistoryVisibleCount<=35);
  }
  assert.equal(fixture.current.rows.length,30);assert.equal(state.ownHistoryVisibleCount,30);fixture.more();assert.equal(fixture.current.rows.length,45);
});
test('pinned reordering keeps only one page of trailing space to avoid a physical scroll clamp', () => {
  const old=Array.from({length:20},(_,i)=>({id:'row-'+i})),tail=Array.from({length:5},(_,i)=>({id:'tail-'+i})),fixture=boundedHistoryFixture([...old,...tail],'row-0');
  const top=fixture.current.button.closest().getBoundingClientRect().top,prefix=Array.from({length:1000},(_,i)=>({id:'new-'+i}));
  fixture.apply([...prefix,...old,...tail]);assert.equal(fixture.current.rows.length,20);
  fixture.apply([...prefix,...old.slice(1),old[0],...tail]);assert.equal(fixture.current.rows.length,25);assert.equal(fixture.current.button.closest().getBoundingClientRect().top,top);assert(state.ownHistoryVisibleCount<=35);
});
test('pin updates never revive a removed row or carry keys into another user generation', () => {
  const old=Array.from({length:40},(_,i)=>({id:'row-'+i})),fixture=boundedHistoryFixture(old),prefix=Array.from({length:1000},(_,i)=>({id:'new-'+i}));
  fixture.apply([...prefix,...old]);fixture.apply([...prefix,...old.filter(row=>row.id!=='row-5')]);assert.equal(fixture.current.rows.length,19);assert(!fixture.current.rows.some(row=>row.record.id==='row-5'));assert.equal(state.ownHistoryVisibleCount,20);
  state.userCouponHistoryGeneration++;const latest=context.getOwnHistoryVisibleRows([...prefix,...old],'synthetic-user');assert.equal(latest.length,5);assert.equal(context.ownHistoryPageState.keys,null);
});

test('pinned readers can explicitly return to the latest five without paging through older records', () => {
  const old=Array.from({length:40},(_,i)=>({id:'row-'+i})),fixture=boundedHistoryFixture(old),prefix=Array.from({length:1000},(_,i)=>({id:'new-'+i})),all=[...prefix,...old];fixture.apply(all);
  assert(context.hasEarlierHistoryRows(all,fixture.current.rows.map(row=>row.record)));
  const previousPage=context.ownHistoryPageState;let focusCount=0;const close={focus:options=>{assert.equal(options.preventScroll,true);focusCount++;fixture.document.activeElement=close;}};
  const render=context.render;context.render=()=>{render();fixture.current.modal.querySelector=()=>close;};
  context.showLatestOwnHistory();assert.equal(state.ownHistoryVisibleCount,5);assert.equal(fixture.current.rows.length,5);assert.deepEqual(fixture.current.rows.map(row=>row.record.id),prefix.slice(0,5).map(row=>row.id));assert.equal(context.ownHistoryPageState.keys,null);assert.notEqual(context.ownHistoryPageState,previousPage);assert(!context.hasEarlierHistoryRows(all,fixture.current.rows.map(row=>row.record)));assert.equal(focusCount,1);assert.equal(fixture.document.activeElement,close);assert.equal(fixture.current.list.scrollTop,0);assert.equal(fixture.current.modal.scrollTop,0);
});

test('lowercase RFC3339 markers retain the explicit UTC receipt time', () => {
  const info=context.getHistoryTimeInfo(['2026-11-26t00:05:00.000z']);
  assert.equal(info.timestamp.toISOString(),'2026-11-26T00:05:00.000Z');
  assert.equal(context.getDateString(info.timestamp),'2026-11-26');
});

test('copied offsetless processing clocks never establish an original receipt day', () => {
  for(const raw of ['2026-11-26T01:00:00','2026-11-26T04:00:00','2026-11-26T23:30:00']){
    for(const day of raw.includes('T01:') ? ['2026-11-25','2026-11-26'] : raw.includes('T04:') ? ['2026-11-25','2026-11-26','2026-11-27'] : ['2026-11-26','2026-11-27']){
      const archived=context.normalizeArchivedCompletedPayloadToOrder({orderId:'today',completedAt:raw,businessDate:day,orderLite:order({businessAt:raw,businessDate:day,processedAt:raw,completedAt:raw})});
      const info=context.getOrderHistoryTimeInfo(archived);assert.equal(info.timestamp,null);assert.equal(info.historyDateOnly,'');
    }
    if(raw.includes('T01:')){
      const next=context.normalizeArchivedCompletedPayloadToOrder({orderId:'today',completedAt:raw,businessDate:'2026-11-27',orderLite:order({businessAt:raw,businessDate:'2026-11-27',processedAt:raw,completedAt:raw})});
      assert.equal(context.getOrderHistoryTimeInfo(next).historyDateOnly,'2026-11-27');
    }
    if(raw.includes('T23:')){
      const prior=context.normalizeArchivedCompletedPayloadToOrder({orderId:'today',completedAt:raw,businessDate:'2026-11-25',orderLite:order({businessAt:raw,businessDate:'2026-11-25',processedAt:raw,completedAt:raw})});
      assert.equal(context.getOrderHistoryTimeInfo(prior).historyDateOnly,'2026-11-25');
    }
    const archived=context.normalizeArchivedCompletedPayloadToOrder({orderId:'today',completedAt:raw,businessDate:'2026-11-20',orderLite:order({businessAt:raw,businessDate:'2026-11-20',processedAt:raw,completedAt:raw})});
    assert.equal(context.getOrderHistoryTimeInfo(archived).historyDateOnly,'2026-11-20');
  }
});
test('ordinary compact expansion does no display-time parsing', () => {
  const parse=context.getHistoryTimeInfo;let calls=0;context.getHistoryTimeInfo=(...args)=>{calls++;return parse(...args);};
  const row={id:'lazy-history',t:iso,p:'2026-11-27T00:00:00Z',u:'synthetic-user',q:2,r:18};
  const ordinary=context.expandEmergencyCompactOrderRecord(row);assert.equal(calls,0);assert.equal(ordinary.historyOriginalTimeResolved,undefined);
  const history=context.expandEmergencyCompactHistoryOrderRecord(row);assert(calls>0);assert.equal(history.historyOriginalTimeResolved,true);assert.equal(history.timestamp,ordinary.timestamp);assert.equal(history.remainingCoupons,ordinary.remainingCoupons);
  context.getHistoryTimeInfo=parse;
});

test('ISO midnight rollover preserves a known instant and invalid rollover tries the next receipt', () => {
  for(const raw of ['2026-11-26T24:00:00+09:00','2026-11-26t24:00:00.000+09:00']){
    const time=context.getHistoryTimeInfo([raw]);assert.equal(time.timestamp.toISOString(),'2026-11-26T15:00:00.000Z');assert.equal(context.getDateString(time.timestamp),'2026-11-27');
  }
  for(const raw of ['2026-11-26T24:01:00+09:00','2026-11-26T24:00:01Z','2026-11-26T24:00:00.0001Z']){
    assert.equal(context.getHistoryTimeInfo([raw]).timestamp,null);assert.equal(context.getHistoryTimeInfo([raw,iso]).timestamp.toISOString(),iso);
  }
});

test('equivalent Timestamp epoch fields retain the true receipt day across submillisecond rollover', () => {
  const boundary=Date.parse('2026-11-25T15:00:00.000Z'),seconds=boundary/1000-1,nanoseconds=999999999;
  const sdk={seconds,nanoseconds,toDate:()=>new Date(seconds*1000+nanoseconds/1000000)};
  assert.equal(sdk.toDate().getTime(),boundary);
  for(const value of [sdk,{seconds,nanoseconds},{_seconds:seconds,_nanoseconds:nanoseconds},'Timestamp(seconds='+seconds+', nanoseconds='+nanoseconds+')']){
    const time=context.getHistoryTimeInfo([value]);assert.equal(time.timestamp.getTime(),boundary-1);assert.equal(context.getDateString(time.timestamp),'2026-11-25');assert.equal(time.value,value);
  }
  assert.equal(context.getOrderHistoryTimeInfo(order({createdAtServer:sdk})).evidenceRank,3);
  assert.equal(context.getHistoryTimeInfo([{seconds:boundary/1000,nanoseconds:0}]).timestamp.getTime(),boundary);
  assert.equal(context.getHistoryTimeInfo([{seconds:boundary/1000,nanoseconds:1000000000},iso]).timestamp.toISOString(),iso);
});

console.log(JSON.stringify({ status: 'PASS', tests: passed, scope: 'actual product date/merge/combined-history and viewport functions; financial dependencies are fixed fixtures', SDK: 0 }));
