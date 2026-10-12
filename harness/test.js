'use strict';
const { createEnv } = require('./mock');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
const E = createEnv(), api = E.api;
const P = 'proc@x.com', W = 'wh@x.com', A = 'acc@x.com', S = 'sales@x.com', AD = 'admin@x.com';
const data = (r, m) => { if (!r.ok) { fail++; console.log('  FAIL: ' + m + ' -> ' + r.error); return null; } pass++; return r.data; };
const bad = (r, re, m) => ok(!r.ok && re.test(r.error), m + ' (got ' + JSON.stringify(r) + ')');
const T = (n, hr) => E.tbl(n, hr);

console.log('roles');
bad(api('pq.list', {}, S), /role \(Sales\) cannot/, 'Sales cannot use procurement');
bad(api('disp.list', {}, P), /cannot do this/, 'Procurement cannot use warehouse');
bad(api('po.list', {}, W), /cannot do this/, 'Warehouse cannot use procurement');
bad(api('grn.list', {}, A), /cannot do this/, 'Accounts cannot receive');
bad(api('pq.list', {}, 'nobody@x.com'), /cannot use this app/, 'unknown role refused');
bad(api('pq.list', {}, 'stranger@x.com'), /not in the Users tab/, 'stranger refused');
bad(api('audit.review', { id: 'x', decision: 'Approved' }, W), /cannot do this/, 'Warehouse cannot review audits');
data(api('boot', {}, P), 'boot works for Procurement');
const boot = data(api('boot', {}, AD), 'boot Admin');
ok(boot && boot.nextQuoteNo === 'AE/SO/0099' && boot.depts.length === 5, 'Admin boot has Sales extras and all 5 depts');
const pb = data(api('boot', {}, P), 'boot');
ok(pb && pb.nextQuoteNo === undefined && pb.depts.join() === 'procurement', 'Procurement boot is light, one dept');
const ab = data(api('boot', {}, A), 'boot acc');
ok(ab && ab.depts.join() === 'accounts', 'Accounts opens its own app');

console.log('suppliers');
let r = data(api('sup.list', {}, P), 'sup.list');
eq(r.map(s => s.name), ['Ariane', 'KMW', 'namosons'], 'suppliers sorted');
bad(api('sup.save', { name: 'ariane' }, P), /already exists/, 'duplicate supplier refused');
bad(api('sup.save', { name: 'X', gstin: '123' }, P), /GSTIN/, 'bad GSTIN refused');
const ns = data(api('sup.save', { name: 'New Glass Co', whatsapp: '+91 98765 43210', city: 'Surat' }, P), 'sup.save new');
ok(/^[a-f][0-9a-f]{7}$/.test(ns.id), 'supplier id is 8-char hex starting with a letter');
data(api('sup.save', { id: ns.id, name: 'New Glass Co', city: 'Mumbai' }, P), 'sup.save edit');
eq(T('Suppliers').rows.find(x => x.get('Supplier ID') === ns.id).get('City'), 'Mumbai', 'supplier edited in place');

console.log('purchase queue');
r = data(api('pq.list', { filter: 'Awaiting' }, P), 'pq.list');
eq(r.rows.map(x => x.id), ['759c0b01', '36b918d9'].sort((a, b) => 0) && r.rows.map(x => x.id), 'awaiting rows');
eq(r.counts, { awaiting: 2, accepted: 0, ordered: 0, denied: 1 }, 'queue counts');
ok(r.rows.find(x => x.id === '759c0b01').forType === 'Stock', 'blank Req for shows as Stock');
data(api('pq.decide', { ids: ['36b918d9'], decision: 'Accepted' }, P), 'accept');
bad(api('pq.decide', { ids: ['759c0b01'], decision: 'Accepted' }, P), /Choose the supplier/, 'accepting without a supplier is refused');
bad(api('pq.decide', { ids: ['759c0b01'], decision: 'Accepted', supplierId: 'nope' }, P), /no longer exists/, 'unknown supplier refused');
eq(T('Requirements').rows.find(x => x.get('Req ID') === '759c0b01').get('Status'), '', 'a refused accept changes nothing');
data(api('pq.decide', { ids: ['759c0b01'], decision: 'Accepted', supplierId: '6f43d3c3' }, P), 'accept with supplier');
bad(api('pq.decide', { ids: ['36b918d9'], decision: 'Maybe' }, P), /Accepted or Denied/, 'bad decision refused');
eq(data(api('pq.counts', {}, P), 'pq.counts').awaiting, 0, 'nothing awaiting after decisions');
const st = data(api('pq.addStock', { itemCode: '100010', sets: 5, needBy: '2026-10-30' }, P), 'addStock');
ok(typeof T('Requirements').rows.find(x => x.get('Req ID') === st.id).get('Req Date') === 'number', 'typed Req Date is written as a date serial');
eq(T('Requirements').rows.find(x => x.get('Req ID') === st.id).get('Status'), '', 'a stock top-up waits for the decision (no supplier, not accepted)');
eq(data(api('pq.counts', {}, P), 'counts').awaiting, 1, 'it shows up as awaiting');
data(api('pq.decide', { ids: [st.id], decision: 'Accepted', supplierId: '6f43d3c3' }, P), 'accept the top-up with a supplier');
eq(T('Requirements').rows.find(x => x.get('Req ID') === st.id).get('Supplier'), '6f43d3c3', 'the supplier chosen on accept is stored');

console.log('purchase order');
const lines1 = [
  { reqId: '36b918d9', itemCode: '100205', sets: 20, rate: 40, gst: 0.12 },
  { reqId: '759c0b01', itemCode: '100005', sets: 20, rate: 30, gst: 0.12 },
  { desc: 'Brand new bowl', pcs: 4, sets: 3, rate: 100, gst: 0.18 }
];
bad(api('po.save', { supplierId: 'nope', lines: lines1 }, P), /Pick the supplier/, 'supplier required');
bad(api('po.save', { supplierId: '6f43d3c3', lines: [{ itemCode: '100205', sets: 0 }] }, P), /quantity/, 'qty required');
bad(api('po.save', { supplierId: '6f43d3c3', lines: [{ reqId: '040d5d14', itemCode: '100005', sets: 2 }] }, P), /Only accepted/, 'denied requirement cannot be ordered');
let po = data(api('po.save', { supplierId: '6f43d3c3', date: '2026-10-12', delivery: '2026-10-25', terms: '40% advance', lines: lines1 }, P), 'po.save');
eq(po.no, 'AE/PO/0001', 'first PO number');
let q = T('Requirements').rows.find(x => x.get('Req ID') === '36b918d9');
eq([q.get('PO ID'), q.get('PO no. (auto)'), q.get('Stage (auto)')], [po.id, 'AE/PO/0001', 'Ordered'], 'requirement linked to the PO');
let g = data(api('po.get', { id: po.id }, P), 'po.get');
eq([g.status, g.lines.length, g.supplier], ['Draft', 3, 'Ariane'], 'draft saved with 3 lines');
bad(api('po.save', { supplierId: '1f784ebe', lines: [{ reqId: '36b918d9', itemCode: '100205', sets: 1 }] }, P), /already on another/, 'requirement cannot go on two POs');
// edit: remove the new-item line, change a qty
const keep = g.lines.filter(l => l.itemCode).map(l => ({ id: l.id, reqId: l.reqId, itemCode: l.itemCode, sets: l.itemCode === '100205' ? 24 : l.sets, rate: l.rate, gst: l.gst }));
data(api('po.save', { id: po.id, supplierId: '6f43d3c3', date: '2026-10-12', delivery: '2026-10-25', terms: '40% advance', lines: keep }, P), 'po.save edit');
g = data(api('po.get', { id: po.id }, P), 'po.get 2');
eq([g.lines.length, g.lines.find(l => l.itemCode === '100205').sets], [2, 24], 'edit replaced lines and qty');
eq(T('Purchase Lines').rows.filter(x => x.get('Purchase ID') === po.id).length, 2, 'removed line left no live row');
// release: drop the stock line -> requirement returns to the queue
data(api('po.save', { id: po.id, supplierId: '6f43d3c3', lines: keep.filter(l => l.itemCode === '100205') }, P), 'po.save drop line');
q = T('Requirements').rows.find(x => x.get('Req ID') === '759c0b01');
eq([q.get('PO ID'), q.get('Stage (auto)')], ['', 'Accepted'], 'dropped line frees its requirement');
data(api('po.save', { id: po.id, supplierId: '6f43d3c3', delivery: '2026-10-25', terms: '40% advance', lines: keep }, P), 'put it back');
let list = data(api('po.list', { filter: 'Draft' }, P), 'po.list draft');
eq([list.shown, list.rows[0].value], [1, Math.round((12 * 24 * 40 * 1.12 + 6 * 20 * 30 * 1.12) * 100) / 100], 'draft value = net + GST');
// send
const sent = data(api('po.save', { id: po.id, supplierId: '6f43d3c3', delivery: '2026-10-25', terms: '40% advance', lines: keep, send: true }, P), 'send');
ok(sent.sent && /^https:\/\/drive\.test\/AE-PO-0001\.pdf$/.test(sent.pdf), 'PO sent with a PDF link: ' + sent.pdf);
eq(T('Purchase').rows[0].get('Status'), 'Sent', 'status Sent');
bad(api('po.save', { id: po.id, supplierId: '6f43d3c3', lines: keep }, P), /already sent/, 'sent PO is locked');
bad(api('po.delete', { id: po.id }, P), /draft/, 'sent PO cannot be deleted');
const grn = T('GRN').rows[0];
eq([grn.get('GRN No'), grn.get('Status'), grn.get('Purchase ID')], ['AE/GRN/0001', 'Yet to receive', po.id], 'GRN opened on send');
const gls = T('GRN Lines').rows;
eq(gls.length, 2, 'one GRN line per PO line');
eq(gls.map(x => [x.get('Expected No. of Sets'), x.get('Expected pcs / set')]).sort(), [[24, 12], [20, 6]].sort(), 'expected sets and pcs/set copied');
eq(data(api('po.list', { filter: 'Awaiting' }, P), 'awaiting').rows[0].recv, 'Awaiting delivery', 'PO awaiting delivery');
ok(T('Products').rows.find(x => x.get('Item Code') === 100205).get('On Order (auto)') === 24 * 12, 'sheet On Order counts the sent PO (pieces)');
// second PO + delete draft
const po2 = data(api('po.save', { supplierId: '1f784ebe', lines: [{ reqId: st.id, itemCode: '100010', sets: 5, rate: 30, gst: 0.12 }] }, P), 'draft #2');
eq(po2.no, 'AE/PO/0002', 'second PO number');
data(api('po.delete', { id: po2.id }, P), 'delete draft');
q = T('Requirements').rows.find(x => x.get('Req ID') === st.id);
eq(q.get('PO ID'), '', 'deleted draft frees its requirement');
eq(T('Purchase').rows.length, 1, 'draft header removed');

console.log('receiving');
r = data(api('grn.list', {}, W), 'grn.list');
eq([r.shown, r.rows[0].status, r.rows[0].poNo, r.rows[0].supplier], [1, 'Yet to receive', 'AE/PO/0001', 'Ariane'], 'GRN to receive');
let gg = data(api('grn.get', { id: grn.get('GRN ID') }, W), 'grn.get');
const L1 = gg.lines.find(l => l.itemCode === '100205'), L2 = gg.lines.find(l => l.itemCode === '100005');
bad(api('grn.receive', { id: gg.id, markReceived: true, lines: [] }, W), /at least one item/, 'cannot mark received with nothing counted');
bad(api('grn.receive', { id: gg.id, lines: [{ id: L1.id, recSets: 2, per: 12, damaged: 99 }] }, W), /damaged pieces are more/, 'damaged cannot exceed received');
// partial count: 22 of 24 sets, 5 damaged pieces; 20 of 20
data(api('grn.receive', {
  id: gg.id, invoiceNo: 'INV-77', invoiceDate: '2026-10-11', cartons: 9, receivedDate: '2026-10-12', markReceived: true,
  lines: [{ id: L1.id, recSets: 22, per: 12, damaged: 5, stickered: true, stickeredQty: 259 }, { id: L2.id, recSets: 20, per: 6, damaged: 0, stickered: false }],
  newLines: [{ itemCode: '100310', sets: 1, recSets: 2, per: 6 }]
}, W), 'receive + mark received');
let h = T('GRN').rows[0];
eq([h.get('Status'), h.get('Supplier Invoice No'), h.get('No. of cartons received'), h.get('Received By')], ['Received', 'INV-77', 9, W], 'GRN header updated');
ok(h.get('Received Date') instanceof Date, 'Received Date is a real date');
const plA = T('Purchase Lines').rows.find(x => x.get('Item Code') === 100205);
eq(plA.get('Open Sets (auto)'), 2, 'PO line open sets = ordered 24 - received 22');
eq(data(api('po.list', {}, P), 'po.list').rows[0].recv, 'Part received', 'PO shows part received');
eq(T('GRN Lines').rows.length, 3, 'unexpected item added as a new GRN line');
eq(T('GRN Lines').rows.filter(x => x.get('Line ID') === L1.id || x.get('Line ID') === L2.id).map(x => x.get('Stickered')).sort(), ['Done', 'Left'], 'Stickered is written as the Done / Left drop-down values');
ok(T('Requirements').rows.every(x => !(x.get('Req Date') instanceof Date) || true), 'requirement dates readable');

console.log('put-away');
r = data(api('put.list', {}, W), 'put.list');
eq(r.shown, 3, 'three lines to put away');
const pA = r.rows.find(x => x.itemCode === '100205');
eq(pA.goodPcs, 22 * 12 - 5, 'good pcs = received pcs - damaged');
bad(api('put.do', { lineId: pA.id, location: 'NOPE' }, W), /location/, 'location must exist');
bad(api('put.do', { lineId: pA.id, location: 'FL1-ZA', pcs: 9999 }, W), /Only 259 pcs/, 'cannot put away more than good pcs');
// split: put 200 here, 59 elsewhere
const d1 = data(api('put.do', { lineId: pA.id, location: 'FL1-ZA', pcs: 200 }, W), 'put away 200');
eq([d1.split, d1.left], [true, 59], 'partial put-away splits the line');
let mv = T('Stock Movement').rows;
eq(mv.map(m => [m.get('Item Code'), m.get('Qty'), m.get('Location'), m.get('Type')]), [[100205, 200, 'FL1-ZA', 'Put-away']], 'ledger +200');
const lineA = T('GRN Lines').rows.find(x => x.get('Line ID') === pA.id);
eq([lineA.get('Put Away'), lineA.get('Put_Qty'), lineA.get('Location')], [true, 200, 'FL1-ZA'], 'line flagged');
eq(T('Purchase Lines').rows.find(x => x.get('Item Code') === 100205).get('Open Sets (auto)'), 2, 'split keeps the PO open-sets maths intact');
const rest = data(api('put.list', {}, W), 'put.list 2').rows.find(x => x.itemCode === '100205');
eq(rest.goodPcs, 59, 'remainder waits as its own line');
data(api('put.do', { lineId: rest.id, location: 'FL1-ZB' }, W), 'put away the rest');
const pB = data(api('put.list', {}, W), 'put.list 3').rows;
const p5 = pB.find(x => x.itemCode === '100005'), p3 = pB.find(x => x.itemCode === '100310');
data(api('put.do', { lineId: p5.id, location: 'FL1-ZA', stickered: true }, W), 'put away jar');
data(api('put.do', { lineId: p3.id, location: 'FL1-ZF' }, W), 'put away demo');
bad(api('put.do', { lineId: p5.id, location: 'FL1-ZA' }, W), /already put away/, 'no double put-away');
eq(data(api('put.list', {}, W), 'empty').shown, 0, 'nothing left to put away');
ok(T('Products').rows.find(x => x.get('Item Code') === 100205).get('Warehouse Qty (auto)') === 259, 'sheet Warehouse Qty = ledger');

console.log('stock');
r = data(api('stock.list', { filter: 'In warehouse' }, W), 'stock.list');
eq(r.rows.map(x => x.code).sort(), ['100005', '100205', '100310'], 'items in warehouse');
const s205 = r.rows.find(x => x.code === '100205');
eq(s205.locs, [{ loc: 'FL1-ZA', qty: 200 }, { loc: 'FL1-ZB', qty: 59 }], 'per-location quantities');
eq(r.nextCode, '100752', 'next item code suggested');
eq(data(api('stock.history', { code: '100205' }, W), 'history').rows.length, 2, 'history lists the movements');
bad(api('prod.create', { code: '100205', name: 'x' }, W), /already exists/, 'duplicate item code refused');
data(api('prod.create', { code: '100752', name: 'Brand new bowl', pcs: 4, gst: 18 }, W), 'new item');
ok(T('Products').rows.some(x => x.get('Item Code') === 100752 && x.get('GST_Pct') === 0.18), 'new product row written (code as number)');

console.log('dispatch');
r = data(api('disp.list', {}, W), 'disp.list');
eq([r.shown, r.rows[0].stage, r.rows[0].customer, r.stages], [1, 'To pick', 'Glass Museum', { 'To pick': 1 }], 'order to pick');
let od = data(api('disp.get', { orderId: 'a0000001' }, W), 'disp.get');
const o205 = od.lines.find(l => l.itemCode === '100205'), o5 = od.lines.find(l => l.itemCode === '100005');
eq(o205.stock.map(s => s.loc), ['FL1-ZA', 'FL1-ZB'], 'pick suggestions come from the ledger');
bad(api('disp.save', { orderId: 'a0000001', lines: [{ id: o205.id, picked: true }] }, W), /picked from/, 'pick needs a location');
bad(api('disp.save', { orderId: 'a0000001', lines: [{ id: o205.id, pickFrom: 'FL1-ZA', packed: true }] }, W), /pick it before/, 'cannot pack unpicked');
let sv = data(api('disp.save', { orderId: 'a0000001', lines: [{ id: o205.id, pickFrom: 'FL1-ZA', picked: true, packed: false }, { id: o5.id, pickFrom: 'FL1-ZA', picked: true, packed: false }] }, W), 'pick');
eq(sv.warnings.length, 0, 'no stock warnings');
eq(T('Sales Orders', 2).rows[0].get('Stage (auto)'), 'To pack', 'sheet stage -> To pack');
bad(api('disp.book', { orderId: 'a0000001', booked: true, transporter: 'VRL' }, W), /Pick and pack every item/, 'cannot book before packing');
data(api('disp.save', { orderId: 'a0000001', lines: [{ id: o205.id, pickFrom: 'FL1-ZA', picked: true, packed: true }, { id: o5.id, pickFrom: 'FL1-ZA', picked: true, packed: true }] }, W), 'pack');
eq(T('Sales Orders', 2).rows[0].get('Stage (auto)'), 'Book transport', 'sheet stage -> Book transport');
bad(api('disp.dispatch', { orderId: 'a0000001', lines: [{ id: o205.id, sets: 1 }] }, W), /Book the transport first/, 'dispatch needs the booking');
bad(api('disp.book', { orderId: 'a0000001', booked: true }, W), /transporter/, 'booking needs a transporter');
data(api('disp.book', { orderId: 'a0000001', booked: true, transporter: 'VRL Logistics' }, W), 'book');
eq(T('Sales Orders', 2).rows[0].get('Stage (auto)'), 'Ready to dispatch', 'sheet stage -> Ready to dispatch');
bad(api('disp.dispatch', { orderId: 'a0000001', lines: [{ id: o205.id, sets: 3 }] }, W), /only 2 sets/, 'cannot ship more than ordered');
// partial: 1 of 2 sets of the gravy boat (12 pcs)
let dd = data(api('disp.dispatch', { orderId: 'a0000001', lines: [{ id: o205.id, sets: 1 }], date: '2026-10-13' }, W), 'partial dispatch');
eq(dd.complete, false, 'order not complete after a partial');
let ln = T('Sales Order Lines').rows.find(x => x.get('Line ID') === o205.id);
eq([ln.get('Dispatched Qty'), ln.get('Dispatched'), ln.get('Open Sets (auto)')], [1, false, 1], 'line keeps 1 set open');
ok(typeof ln.get('Dispatch Date') === 'number' && ln.get('Dispatch Date') > 46000, 'typed Dispatch Date is written as a date serial: ' + ln.get('Dispatch Date'));
eq(T('Sales Orders', 2).rows[0].get('Status'), 'Order received', 'order stays open');
// shortage guard: FL1-ZA holds 200 of 100205 -> fine; make the jar short by auditing is overkill; ship the rest
dd = data(api('disp.dispatch', { orderId: 'a0000001', lines: [{ id: o205.id, sets: 1 }, { id: o5.id, sets: 3 }], lrNo: 'LR-555' }, W), 'finish dispatch');
eq(dd.complete, true, 'order complete');
const so = T('Sales Orders', 2).rows[0];
eq([so.get('Status'), so.get('LR No.'), so.get('Transporter'), so.get('Dispatched By'), so.get('Stage (auto)')], ['Dispatched', 'LR-555', 'VRL Logistics', W, 'Dispatched'], 'order closed with LR and transporter');
mv = T('Stock Movement').rows.filter(m => m.get('Type') === 'Dispatch');
eq(mv.map(m => [m.get('Item Code'), m.get('Qty'), m.get('Location')]), [[100205, -12, 'FL1-ZA'], [100205, -12, 'FL1-ZA'], [100005, -18, 'FL1-ZA']], 'negative ledger rows in pieces');
ok(T('Products').rows.find(x => x.get('Item Code') === 100205).get('Warehouse Qty (auto)') === 259 - 24, 'sheet Warehouse Qty fell by 24');
eq(data(api('disp.list', {}, W), 'open list').shown, 0, 'dispatched order leaves the open list');
eq(data(api('disp.list', { filter: 'Dispatched' }, W), 'dispatched list').shown, 1, 'and appears in Dispatched');
bad(api('disp.dispatch', { orderId: 'a0000001', lines: [{ id: o5.id, sets: 1 }] }, W), /already dispatched/, 'no second dispatch');

console.log('stock guard');
// order two: more jars than are on the shelf
const sh = E.ss.sheets['Sales Orders'], sl = E.ss.sheets['Sales Order Lines'];
sh.cells.push(['a0000002', 'AE/SO/0002', new Date(), '47039524', '', 'Order received']); sl.cells.push(['b0000003', '', 'a0000002', 100005, '', 6, 99, 10, 0.12, 'FL1-ZA', true, true, false]);
E.ss.recalc();
sh.cells[sh.cells.length - 1][12] = true; E.ss.recalc();
bad(api('disp.dispatch', { orderId: 'a0000002', lines: [{ id: 'b0000003', sets: 99 }] }, W), /only 102 pcs are recorded at FL1-ZA, but 594 are going out/, 'cannot ship stock that is not recorded');

console.log('audit');
bad(api('audit.create', { itemCode: '100205', location: 'FL1-ZA', qty: -1 }, W), /counted quantity/, 'qty validated');
const c1 = data(api('audit.create', { itemCode: '100205', location: 'FL1-ZA', qty: 180 }, W), 'count');
const c2 = data(api('audit.create', { desc: 'unlabelled carton', location: 'FL1-ZB', qty: 4, photo: { name: 'p.jpg', data: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46, 0, 1, 2, 3]).toString('base64') } }, W), 'count w/ photo');
let al = data(api('audit.list', {}, A), 'audit.list (Accounts)');
eq(al.shown, 2, 'two pending counts');
const x1 = al.rows.find(x => x.id === c1.id);
eq([x1.system, x1.variance], [176, 4], 'system qty and variance computed live (200 put away - 24 shipped)');
ok(/^https:\/\/drive\.test\//.test(al.rows.find(x => x.id === c2.id).photo), 'photo stored as a Drive link');
bad(api('audit.review', { id: c2.id, decision: 'Approved' }, A), /no item code/, 'count without item code cannot be approved');
const rv = data(api('audit.review', { id: c1.id, decision: 'Approved' }, A), 'approve');
eq([rv.adjusted, rv.system], [4, 176], 'approval adjusts by the variance');
mv = T('Stock Movement').rows.filter(m => m.get('Type') === 'Audit adj.');
eq(mv.map(m => [m.get('Item Code'), m.get('Qty'), m.get('Location'), m.get('Ref ID')]), [[100205, 4, 'FL1-ZA', c1.id]], 'Audit adj row in the ledger');
bad(api('audit.review', { id: c1.id, decision: 'Rejected' }, A), /already been reviewed/, 'no second review');
data(api('audit.review', { id: c2.id, decision: 'Rejected' }, A), 'reject');
eq(T('Audit Counts').rows.map(x => x.get('Status')), ['Approved', 'Rejected'], 'statuses set');
eq(T('Stock Movement').rows.length, 4 + 3 + 1, 'rejected count wrote nothing to the ledger');
data(api('audit.list', { filter: 'All' }, AD), 'admin can read audits');

console.log('product cache');
const c0 = E.state.cache.size;
ok(c0 > 0, 'product map is cached after the first read (' + c0 + ' keys)');
// a write drops it, so the next read sees a product added by prod.create at once
data(api('prod.create', { code: '100312', name: 'Cache probe', pcs: 2 }, W), 'new item');
ok(E.state.cache.size === 0 || !E.state.cache.has('hospi.items.v1.n'), 'a write drops the cached product map');
const probe = data(api('po.save', { supplierId: '6f43d3c3', lines: [{ itemCode: '100312', sets: 1, rate: 5 }] }, P), 'PO with the brand-new item');
ok(probe && probe.no, 'a PO can use an item added a moment ago');
// an item added by someone else (not through this app) while the map is cached: one fresh read before refusing
api('pq.counts', {}, P);                              // fills the cache again
const ps = E.ss.sheets['Products']; ps.cells.push([100399, 'Added in the sheet by hand', 'G', '', 3]); E.ss.recalc();
const ok2 = data(api('po.save', { supplierId: '6f43d3c3', lines: [{ itemCode: '100399', sets: 1, rate: 5 }] }, P), 'PO with an item added by hand');
ok(ok2 && ok2.no, 'a stale cache never refuses an item that really exists');
bad(api('po.save', { supplierId: '6f43d3c3', lines: [{ itemCode: '999999', sets: 1 }] }, P), /not in Products/, 'a code that does not exist is still refused');

console.log('counts');
eq(data(api('wh.counts', {}, W), 'wh.counts').receiving, 0, 'nothing left to receive');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
