/**
 * Procurement.gs - backend for the Procurement screens: purchase queue (accept / deny requirements),
 * purchase orders, suppliers.
 *
 * Tables: Requirements (Status, Supplier, PO ID), Suppliers, Purchase, Purchase Lines.
 * Sending a PO also opens its goods receipt (GRN header + one line per PO line, "Yet to receive") so the
 * Warehouse can see what is coming. "Open Sets (auto)" on Purchase Lines is worked out by the sheet from
 * the GRN lines, so Warehouse receiving is what closes a PO line.
 */

var ProcApi = {
  routes: function () {
    var P = ['Procurement'];
    return {
      'sup.list':       [ProcApi.supList, false, P],
      'sup.save':       [ProcApi.supSave, true, P],
      'pq.list':        [ProcApi.pqList, false, P],
      'pq.counts':      [ProcApi.pqCounts, false, P],
      'pq.decide':      [ProcApi.pqDecide, true, P],
      'pq.setSupplier': [ProcApi.pqSetSupplier, true, P],
      'pq.addStock':    [ProcApi.pqAddStock, true, P],
      'po.list':        [ProcApi.poList, false, P],
      'po.get':         [ProcApi.poGet, false, P],
      'po.save':        [ProcApi.poSave, true, P],
      'po.send':        [function (a, user) { return ProcApi.send_(U.s(a.id), user); }, true, P],
      'po.delete':      [ProcApi.poDelete, true, P],
      'po.pdf':         [ProcApi.poPdf, true, P]
    };
  },

  // ---------- suppliers ----------
  suppliers_: function () {
    var list = [], by = {};
    Db.readAll('suppliers').forEach(function (r) {
      var s = {
        id: U.s(r['Supplier ID']), name: U.s(r['Supplier Company Name']), contact: U.s(r['Contact_Name']), whatsapp: U.s(r['WhatsApp']),
        email: U.s(r['Email']), gstin: U.s(r['GSTIN']), city: U.s(r['City']), address: U.s(r['Address']),
        categories: U.s(r['Product_Categories']), row: r._row
      };
      list.push(s); by[s.id] = s;
    });
    list.sort(Rows.byName);
    return { list: list, by: by };
  },

  supList: function () {
    var sup = ProcApi.suppliers_(), count = {};
    Db.readAll('purchase').forEach(function (r) { var k = U.s(r['Supplier Company Name']); count[k] = (count[k] || 0) + 1; });
    return sup.list.map(function (s) {
      return { id: s.id, name: s.name, contact: s.contact, whatsapp: s.whatsapp, email: s.email, gstin: s.gstin, city: s.city,
               address: s.address, categories: s.categories, pos: count[s.id] || 0 };
    });
  },

  /** args: { id?, name*, contact, whatsapp, email, gstin, city, address, categories } */
  supSave: function (a) {
    var name = U.s(a.name).replace(/\s+/g, ' '), sup = ProcApi.suppliers_(), id = U.s(a.id);
    if (!name) throw new Error('Enter the supplier company name.');
    sup.list.forEach(function (s) { if (s.id !== id && U.low(s.name) === U.low(name)) throw new Error('A supplier called "' + name + '" already exists.'); });
    var email = U.s(a.email), gstin = U.s(a.gstin).toUpperCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That email address does not look right.');
    if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) throw new Error('GSTIN must be 15 letters and digits.');
    var obj = {
      'Supplier Company Name': name, 'Contact_Name': U.s(a.contact), 'WhatsApp': U.s(a.whatsapp), 'Email': email, 'GSTIN': gstin,
      'City': U.s(a.city), 'Address': U.s(a.address), 'Product_Categories': U.s(a.categories)
    };
    var fmt = { 'WhatsApp': '@' };
    if (id) {
      if (!sup.by[id]) throw new Error('That supplier no longer exists.');
      Db.update('suppliers', sup.by[id].row, obj, fmt);
      return { id: id };
    }
    var taken = U.idSet(Db.readAll('suppliers'), 'Supplier ID');
    obj['Supplier ID'] = U.newId(taken);
    Db.append('suppliers', [obj], fmt);
    return { id: obj['Supplier ID'] };
  },

  // ---------- purchase queue (Requirements) ----------
  reqRow_: function (r, items, sups, poNos) {
    var code = U.s(r['Item Code']), p = code ? items[code] : null, sid = U.s(r['Supplier']), poId = U.s(r['PO ID']);
    var sets = U.toNum(r['No. of Set']);
    return {
      id: U.s(r['Req ID']), date: U.iso(r['Req Date']), forType: U.s(r['Req for']) || 'Stock',
      party: U.s(r['Party (auto)']) || U.s(r['Customer / Lead Name']), salesman: U.s(r['Salesman']),
      itemCode: code, item: p ? (p.name || code) : U.s(r['Item Description']), isNew: !p,
      pcs: p ? p.pcs : 1, sets: isNaN(sets) ? 0 : sets, needBy: U.iso(r['Need By']), notes: U.s(r['Notes']),
      supplierId: sid, supplier: sups.by[sid] ? sups.by[sid].name : '', state: ReqApi.statusOf_(r),
      poId: poId, poNo: U.s(r['PO no. (auto)']) || poNos[poId] || '', quoteNo: U.s(r['Quote no. (auto)']),
      stock: p ? { wh: p.wh, books: p.books, reserved: p.reserved, onOrder: p.onOrder, avail: p.avail } : null
    };
  },

  /** args: { filter: Awaiting|Accepted|Ordered|Denied|All, search } */
  pqList: function (a) {
    var items = Items.map(), sups = ProcApi.suppliers_(), poNos = {};
    Db.readAll('purchase').forEach(function (r) { poNos[U.s(r['Purchase ID'])] = U.s(r['Purchase No']); });
    var all = Db.readAll('requirements').map(function (r) { return ProcApi.reqRow_(r, items, sups, poNos); });
    var counts = { awaiting: 0, accepted: 0, ordered: 0, denied: 0 };
    all.forEach(function (r) { counts[{ '': 'awaiting', Accepted: 'accepted', Ordered: 'ordered', Denied: 'denied' }[r.state]]++; });
    var want = { Awaiting: '', Accepted: 'Accepted', Ordered: 'Ordered', Denied: 'Denied' }, f = U.s(a.filter) || 'All', q = U.s(a.search);
    var rows = all.filter(function (r) {
      if (want[f] !== undefined && r.state !== want[f]) return false;
      return !q || Rows.matches([r.party, r.item, r.itemCode, r.notes, r.supplier, r.poNo, r.quoteNo, r.forType].join(' '), q);
    });
    rows.sort(function (x, y) {
      if (!x.needBy !== !y.needBy) return x.needBy ? -1 : 1;
      return x.needBy < y.needBy ? -1 : x.needBy > y.needBy ? 1 : (x.date < y.date ? 1 : x.date > y.date ? -1 : 0);
    });
    return { shown: rows.length, rows: rows.slice(0, CONFIG.MAX_ROWS), counts: counts };
  },

  /** Cheap numbers for the tab badge and the bell. */
  pqCounts: function () {
    var c = { awaiting: 0, accepted: 0 };
    Db.readAll('requirements').forEach(function (r) {
      var s = ReqApi.statusOf_(r);
      if (s === '') c.awaiting++; else if (s === 'Accepted') c.accepted++;
    });
    var draft = 0;
    Db.readAll('purchase').forEach(function (r) { if ((U.s(r['Status']) || 'Draft') === 'Draft') draft++; });
    c.draft = draft;
    return c;
  },

  reqsByIds_: function (ids) {
    var by = Rows.by(Db.readAll('requirements'), 'Req ID');
    return ids.filter(function (id) { return by[id]; }).map(function (id) { return by[id]; });
  },

  /**
   * The purchase manager's call. args: { ids, decision: Accepted|Denied|'' (back to the queue), supplierId }
   * Accepting needs a supplier: choosing the supplier is what confirms the acceptance. A requirement that already
   * has a supplier keeps it when none is sent.
   */
  pqDecide: function (a) {
    var d = U.s(a.decision), ids = Rows.ids(a.ids), sid = U.s(a.supplierId);
    if (['Accepted', 'Denied', ''].indexOf(d) < 0) throw new Error('Decision must be Accepted or Denied.');
    if (!ids.length) throw new Error('Pick at least one requirement.');
    if (sid && !ProcApi.suppliers_().by[sid]) throw new Error('That supplier no longer exists.');
    var rows = ProcApi.reqsByIds_(ids).filter(function (r) { return !U.s(r['PO ID']); }), skipped = ids.length - rows.length;
    if (d === 'Accepted') {
      rows.forEach(function (r) { if (!sid && !U.s(r['Supplier'])) throw new Error('Choose the supplier to accept this requirement.'); });
    }
    rows.forEach(function (r) {                       // a requirement already on a purchase order cannot change (skipped above)
      var upd = { 'Status': d };
      if (d === 'Accepted' && sid) upd['Supplier'] = sid;
      Db.update('requirements', r._row, upd);
    });
    return { done: rows.length, skipped: skipped };
  },

  /** args: { ids, supplierId ('' clears) } */
  pqSetSupplier: function (a) {
    var ids = Rows.ids(a.ids), sid = U.s(a.supplierId), done = 0;
    if (!ids.length) throw new Error('Pick at least one requirement.');
    if (sid && !ProcApi.suppliers_().by[sid]) throw new Error('That supplier no longer exists.');
    ProcApi.reqsByIds_(ids).forEach(function (r) {
      if (U.s(r['PO ID'])) return;
      Db.update('requirements', r._row, { 'Supplier': sid }); done++;
    });
    return { done: done };
  },

  /** A stock need raised by Procurement itself (no customer or lead). It joins the queue and waits for the decision like any other. */
  pqAddStock: function (a, user) {
    var code = U.s(a.itemCode), desc = U.s(a.itemDesc), sets = U.toNum(a.sets), raw = '';
    if (code) { raw = Items.raw(code); if (raw === null) throw new Error('Item ' + code + ' is not in Products.'); desc = ''; }
    else if (!desc) throw new Error('Pick an item, or type the name of a new item.');
    if (!(sets > 0)) throw new Error('Enter the quantity.');
    var need = '';
    if (U.s(a.needBy)) { need = U.dateFromIso(a.needBy); if (!need) throw new Error('"Need by" date is not valid.'); }
    var id = U.newId(U.idSet(Db.readAll('requirements'), 'Req ID'));
    Db.append('requirements', [{
      'Req ID': id, 'Req Date': Rows.serial(U.isoToday()), 'Salesman': user.email, 'Need By': need,
      'Notes': U.s(a.notes), 'Item Code': raw, 'Item Description': desc, 'No. of Set': U.r4(sets)
    }]);
    return { id: id };
  },

  // ---------- purchase orders ----------
  lineOut_: function (r, items, reqs, draft) {
    var code = U.s(r['Item Code']), p = code ? items[code] : null, rq = reqs ? reqs[U.s(r['Req ID'])] : null;
    var pcs = U.toNum(r['Pcs / Set']); if (!(pcs >= 1)) pcs = p ? p.pcs : 1;
    var sets = U.toNum(r['No. of Set']); if (isNaN(sets)) sets = 0;
    var rate = U.toNum(r['Rate']); if (isNaN(rate)) rate = 0;
    var g = U.frac(r['GST %']); if (isNaN(g)) g = 0;
    var open = U.s(r['Open Sets (auto)']) === '' || draft ? sets : U.toNum(r['Open Sets (auto)']);
    return {
      id: U.s(r['Line ID']), reqId: U.s(r['Req ID']), itemCode: code, desc: U.s(r['Description']), name: p ? (p.name || code) : U.s(r['Description']),
      supItemCode: U.s(r['Supplier Item Code']), supItemName: U.s(r['Supplier Item Name']), pcs: pcs, sets: sets, rate: rate, gst: g, open: isNaN(open) ? sets : open,
      party: rq ? (U.s(rq['Party (auto)']) || U.s(rq['Customer / Lead Name'])) : ''
    };
  },
  value_: function (l) { var net = l.pcs * l.sets * l.rate; return { net: net, gst: net * l.gst }; },

  /** args: { filter: All|Draft|Sent|Awaiting|Received, search } */
  poList: function (a) {
    var sups = ProcApi.suppliers_(), items = Items.map(), lines = Rows.group(Db.readAll('purchaseLines'), 'Purchase ID');
    var f = U.s(a.filter) || 'All', q = U.s(a.search), today = U.isoToday(), counts = { draft: 0, awaiting: 0, received: 0 };
    var all = Db.readAll('purchase').map(function (r) {
      var id = U.s(r['Purchase ID']), status = U.s(r['Status']) || 'Draft', draft = status === 'Draft';
      var ls = (lines[id] || []).map(function (x) { return ProcApi.lineOut_(x, items, null, draft); });
      var sets = 0, open = 0, net = 0, gst = 0, recv = '';
      ls.forEach(function (l) { sets += l.sets; open += l.open; var v = ProcApi.value_(l); net += v.net; gst += v.gst; });
      var delivery = U.iso(r['Delivery Date']);
      if (!draft) recv = sets > 0 && open <= 1e-9 ? 'Received' : (open < sets - 1e-9 ? 'Part received' : 'Awaiting delivery');
      var sid = U.s(r['Supplier Company Name']);
      return {
        id: id, no: U.s(r['Purchase No']), date: U.iso(r['Purchase Date']), supplierId: sid, supplier: sups.by[sid] ? sups.by[sid].name : '',
        delivery: delivery, terms: U.s(r['Payment Terms']), status: status, recv: recv, pdf: /^https?:\/\//i.test(U.s(r['PO PDF'])) ? U.s(r['PO PDF']) : '',
        lines: ls.length, sets: U.r4(sets), open: U.r4(open), value: U.r2(net + gst),
        late: !!(recv && recv !== 'Received' && delivery && delivery < today), createdBy: U.s(r['Created By'])
      };
    });
    all.forEach(function (p) { if (p.status === 'Draft') counts.draft++; else if (p.recv === 'Received') counts.received++; else counts.awaiting++; });
    var rows = all.filter(function (p) {
      if (f === 'Draft' && p.status !== 'Draft') return false;
      if (f === 'Sent' && p.status !== 'Sent') return false;
      if (f === 'Awaiting' && !(p.status === 'Sent' && p.recv !== 'Received')) return false;
      if (f === 'Received' && p.recv !== 'Received') return false;
      return !q || Rows.matches([p.no, p.supplier, p.terms, p.status, p.recv].join(' '), q);
    });
    rows.sort(function (x, y) { return x.no < y.no ? 1 : x.no > y.no ? -1 : 0; });
    return { shown: rows.length, rows: rows.slice(0, CONFIG.MAX_ROWS), counts: counts };
  },

  find_: function (id) {
    var po = Rows.by(Db.readAll('purchase'), 'Purchase ID')[U.s(id)];
    if (!po) throw new Error('That purchase order was not found.');
    return po;
  },

  /** args: { id } */
  poGet: function (a) {
    var po = ProcApi.find_(a.id), items = Items.map(), sups = ProcApi.suppliers_(), id = U.s(po['Purchase ID']);
    var reqs = Rows.by(Db.readAll('requirements'), 'Req ID'), status = U.s(po['Status']) || 'Draft';
    var lines = Db.readAll('purchaseLines').filter(function (r) { return U.s(r['Purchase ID']) === id; })
      .map(function (r) { return ProcApi.lineOut_(r, items, reqs, status === 'Draft'); });
    var grn = null;
    Db.readAll('grn').forEach(function (g) { if (U.s(g['Purchase ID']) === id) grn = { id: U.s(g['GRN ID']), no: U.s(g['GRN No']), status: U.s(g['Status']) }; });
    var sid = U.s(po['Supplier Company Name']);
    return {
      id: id, no: U.s(po['Purchase No']), date: U.iso(po['Purchase Date']), supplierId: sid, supplier: sups.by[sid] ? sups.by[sid].name : '',
      delivery: U.iso(po['Delivery Date']), terms: U.s(po['Payment Terms']), status: status,
      pdf: /^https?:\/\//i.test(U.s(po['PO PDF'])) ? U.s(po['PO PDF']) : '', lines: lines, grn: grn
    };
  },

  clean_: function (raw, items) {
    if (!Array.isArray(raw) || !raw.length) throw new Error('Add at least one item.');
    if (raw.length > 80) throw new Error('Too many lines (max 80).');
    return raw.map(function (l, i) {
      var n = 'Line ' + (i + 1) + ': ', code = U.s(l.itemCode), desc = U.s(l.desc);
      if (!code && !desc) throw new Error(n + 'pick an item, or type the name of a new item.');
      var prod = code ? Items.get(code) : null;
      if (code && !prod) throw new Error(n + 'item ' + code + ' is not in Products.');
      var pcs = U.toNum(l.pcs); if (!(pcs >= 1)) pcs = prod ? prod.pcs : 1;
      var sets = U.toNum(l.sets), rate = U.toNum(l.rate), g = U.s(l.gst) === '' ? (prod ? prod.gst : 0) : U.frac(l.gst);
      if (!(sets > 0)) throw new Error(n + 'enter the quantity in sets.');
      if (isNaN(rate)) rate = 0;
      if (rate < 0) throw new Error(n + 'the rate cannot be negative.');
      if (isNaN(g) || g < 0 || g > 1) throw new Error(n + 'GST must be between 0 and 100 %.');
      return { id: U.s(l.id), reqId: U.s(l.reqId), code: code, desc: code ? '' : desc, supCode: U.s(l.supItemCode), supName: U.s(l.supItemName),
               pcs: pcs, sets: Rows.sets(sets), rate: U.r4(rate), gst: g };
    });
  },

  /**
   * Create or change a DRAFT purchase order. args: { id?, supplierId, date, delivery, terms, lines: [{ id?, reqId?, itemCode, desc,
   * supItemCode, supItemName, pcs, sets, rate, gst (fraction) }], send }
   */
  poSave: function (a, user) {
    var sid = U.s(a.supplierId), sups = ProcApi.suppliers_(), items = Items.map();
    if (!sups.by[sid]) throw new Error('Pick the supplier from the list.');
    var clean = ProcApi.clean_(a.lines, items), poRows = Db.readAll('purchase'), po = null, id, no;
    var delivery = '', date = U.today();
    if (U.s(a.delivery)) { delivery = U.dateFromIso(a.delivery); if (!delivery) throw new Error('The delivery date is not valid.'); }
    if (U.s(a.date)) { date = U.dateFromIso(a.date); if (!date) throw new Error('The PO date is not valid.'); }
    if (a.id) {
      po = Rows.by(poRows, 'Purchase ID')[U.s(a.id)];
      if (!po) throw new Error('That purchase order was not found.');
      if ((U.s(po['Status']) || 'Draft') !== 'Draft') throw new Error('A purchase order that is already sent cannot be changed.');
      id = U.s(po['Purchase ID']); no = U.s(po['Purchase No']);
    } else { id = U.newId(U.idSet(poRows, 'Purchase ID')); no = Rows.nextNo(poRows, 'Purchase No', CONFIG.PO_PREFIX); }

    var reqRows = Db.readAll('requirements'), reqs = Rows.by(reqRows, 'Req ID'), seen = {};
    clean.forEach(function (l) {
      if (!l.reqId) return;
      var rq = reqs[l.reqId];
      if (!rq) throw new Error('A requirement on this order no longer exists. Remove that line and add it again.');
      if (seen[l.reqId]) throw new Error('The same requirement is on this order twice.');
      seen[l.reqId] = true;
      if (U.s(rq['PO ID']) && U.s(rq['PO ID']) !== id) throw new Error('A requirement on this order is already on another purchase order.');
      if (!U.s(rq['PO ID']) && U.s(rq['Status']) !== 'Accepted') throw new Error('Only accepted requirements can be ordered. Accept it in the Purchase queue first.');
    });

    var head = { 'Supplier Company Name': sid, 'Delivery Date': delivery, 'Payment Terms': U.s(a.terms), 'Purchase Date': date };
    if (po) Db.update('purchase', po._row, head);
    else {
      head['Purchase ID'] = id; head['Purchase No'] = no; head['Status'] = 'Draft'; head['Created By'] = user.email; head['Created At'] = new Date();
      Db.append('purchase', [head], { 'Created At': 'dd/mm/yyyy hh:mm:ss' });
    }

    var tL = Db.readAll('purchaseLines'), old = tL.filter(function (r) { return U.s(r['Purchase ID']) === id; });
    var oldBy = Rows.by(old, 'Line ID'), taken = U.idSet(tL, 'Line ID'), keep = {}, fresh = [];
    clean.forEach(function (l) {
      var row = {
        'Req ID': l.reqId, 'Purchase ID': id, 'Item Code': l.code ? Items.raw(l.code) : '', 'Description': l.desc, 'Supplier Item Code': l.supCode,
        'Supplier Item Name': l.supName, 'Pcs / Set': l.pcs, 'No. of Set': l.sets, 'Rate': l.rate, 'GST %': l.gst
      };
      if (l.id && oldBy[l.id]) { keep[l.id] = true; Db.update('purchaseLines', oldBy[l.id]._row, row, { 'GST %': '0.00%' }); }
      else { row['Line ID'] = U.newId(taken); fresh.push(row); }
    });
    if (fresh.length) Db.append('purchaseLines', fresh, { 'GST %': '0.00%' });

    var gone = old.filter(function (r) { return !keep[U.s(r['Line ID'])]; });
    gone.forEach(function (r) {                                 // a removed line puts its requirement back in the queue
      var rq = reqs[U.s(r['Req ID'])];
      if (rq && U.s(rq['PO ID']) === id) { Db.update('requirements', rq._row, { 'PO ID': '' }); rq['PO ID'] = ''; }
    });
    clean.forEach(function (l) { if (l.reqId) Db.update('requirements', reqs[l.reqId]._row, { 'PO ID': id, 'Supplier': sid }); });
    gone.forEach(function (r) { Rows.wipe('purchaseLines', r._row); });

    var out = { id: id, no: no, sent: false, warning: '', pdf: '' };
    if (a.send) { var s = ProcApi.send_(id, user); out.sent = true; out.warning = s.warning; out.pdf = s.pdf; }
    return out;
  },

  /** Draft -> Sent. Only Sent POs count as On Order. Also opens the GRN the Warehouse will receive against. */
  send_: function (id, user) {
    var po = ProcApi.find_(id);
    if ((U.s(po['Status']) || 'Draft') !== 'Draft') throw new Error('This purchase order is already sent.');
    var lines = Db.readAll('purchaseLines').filter(function (r) { return U.s(r['Purchase ID']) === id; });
    if (!lines.length) throw new Error('Add at least one item before sending.');
    if (!ProcApi.suppliers_().by[U.s(po['Supplier Company Name'])]) throw new Error('Pick the supplier before sending.');
    var grns = Db.readAll('grn');
    if (!grns.some(function (g) { return U.s(g['Purchase ID']) === id; })) {
      var gid = U.newId(U.idSet(grns, 'GRN ID')), glRows = Db.readAll('grnLines'), taken = U.idSet(glRows, 'Line ID');
      Db.append('grn', [{ 'GRN ID': gid, 'GRN No': Rows.nextNo(grns, 'GRN No', CONFIG.GRN_PREFIX), 'Purchase ID': id,
                          'Supplier': U.s(po['Supplier Company Name']), 'Status': 'Yet to receive' }]);
      Db.append('grnLines', lines.map(function (r) {
        var code = U.s(r['Item Code']);
        return {
          'Line ID': U.newId(taken), 'GRN ID': gid, 'Purchase Line ID': U.s(r['Line ID']), 'Item Code': code ? Items.raw(code) : '',
          'Description': U.s(r['Description']), 'Supplier item code': U.s(r['Supplier Item Code']),
          'Expected pcs / set': U.toNum(r['Pcs / Set']) >= 1 ? U.toNum(r['Pcs / Set']) : Items.pcs(code, 1),
          'Expected No. of Sets': U.toNum(r['No. of Set']), 'Damaged Qty': 0, 'Stickered': Rows.stickerOut(false), 'Put Away': false
        };
      }));
    }
    Db.update('purchase', po._row, { 'Status': 'Sent' });
    var out = { id: id, no: U.s(po['Purchase No']), pdf: '', warning: '' };
    try { out.pdf = ProcApi.makePdf_(id, po._row); }
    catch (e) { out.warning = 'The order is sent, but its PDF could not be made: ' + (e && e.message ? e.message : e); }
    return out;
  },

  /** args: { id } - a draft only; its requirements go back to the queue */
  poDelete: function (a) {
    var po = ProcApi.find_(a.id), id = U.s(po['Purchase ID']);
    if ((U.s(po['Status']) || 'Draft') !== 'Draft') throw new Error('Only a draft purchase order can be deleted.');
    Db.readAll('requirements').forEach(function (r) { if (U.s(r['PO ID']) === id) Db.update('requirements', r._row, { 'PO ID': '' }); });
    Db.readAll('purchaseLines').forEach(function (r) { if (U.s(r['Purchase ID']) === id) Rows.wipe('purchaseLines', r._row); });
    Rows.wipe('purchase', po._row);
    return { id: id };
  },

  // ---------- PO PDF ----------
  folder_: function () {
    if (CONFIG.PO_PDF_FOLDER_ID) return DriveApp.getFolderById(CONFIG.PO_PDF_FOLDER_ID);
    var it = DriveApp.getFoldersByName(CONFIG.PO_PDF_FOLDER_NAME);
    return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.PO_PDF_FOLDER_NAME);
  },
  html_: function (po) {
    var N = PdfApi.NAVY, C = CONFIG.COMPANY, e = U.esc, sup = ProcApi.suppliers_().by[po.supplierId] || {}, f = 'font-family:Arial,Helvetica,sans-serif;';
    var net = 0, gst = 0, cs = PdfApi.box_('padding:5px 4px;font-size:9px;');
    var rows = po.lines.map(function (l) {
      var v = ProcApi.value_(l); net += v.net; gst += v.gst;
      return '<tr><td valign="top" style="' + cs + '">' + (e(l.itemCode) || '-') + '</td>' +
        '<td valign="top" style="' + cs + '">' + e(l.name) + (l.supItemCode ? '<br><span style="font-size:7.5px;color:#555555">Supplier code: ' + e(l.supItemCode) + '</span>' : '') + '</td>' +
        '<td valign="top" align="center" style="' + cs + '">' + U.r4(l.pcs) + '</td><td valign="top" align="center" style="' + cs + '">' + U.r4(l.sets) + '</td>' +
        '<td valign="top" align="center" style="' + cs + '">' + U.r4(l.pcs * l.sets) + '</td><td valign="top" align="right" style="' + cs + '">' + PdfApi.money_(l.rate) + '</td>' +
        '<td valign="top" align="center" style="' + cs + '">' + PdfApi.plain_(l.gst * 100) + '</td><td valign="top" align="right" style="' + cs + '">' + U.inr(v.net + v.gst) + '</td></tr>';
    }).join('');
    var cols = [['Item Code', 11], ['Description', 31], ['Pcs / Set', 8], ['Sets', 8], ['Total Pcs', 9], ['Rate / pc', 12], ['GST %', 7], ['Amount', 14]];
    var banner = '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr><td align="center" bgcolor="' + N + '" style="background-color:' + N +
      ';color:#ffffff;padding:12px 10px;border:1px solid ' + N + '"><div style="font-size:22px;font-weight:bold;padding-bottom:6px">' + e(C.name) + '</div>' +
      '<div style="font-size:9.5px;padding-bottom:5px">Address: ' + e(C.address) + '</div><div style="font-size:9.5px;padding-bottom:5px">Contact No-: ' + e(C.phone) + '</div>' +
      '<div style="font-size:9.5px;padding-bottom:7px">GST NO : ' + e(C.gstin) + '</div><div style="font-size:14px;font-weight:bold">PURCHASE ORDER</div></td></tr></table>';
    var to = '<b>To:</b> ' + e(sup.name || po.supplier) + (sup.address ? '<br>' + e(sup.address) : '') + (sup.city ? '<br>' + e(sup.city) : '') +
      (sup.gstin ? '<br><b>GST NO:</b> ' + e(sup.gstin) : '') + (sup.contact ? '<br><b>Attn:</b> ' + e(sup.contact) + (sup.whatsapp ? ' (' + e(sup.whatsapp) + ')' : '') : '');
    var right = '<b>PO No :-</b> ' + e(po.no) + '<br><b>PO Date :-</b> ' + e(PdfApi.date_(po.date)) + '<br><b>Delivery by :-</b> ' + e(PdfApi.date_(po.delivery) || 'as agreed') +
      '<br><b>Payment terms :-</b> ' + e(po.terms || 'As agreed');
    var info = '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr><td width="62%" valign="top" style="' + PdfApi.box_('padding:8px 9px;font-size:10px;line-height:1.7') + '">' + to +
      '</td><td width="38%" valign="top" style="' + PdfApi.box_('padding:8px 9px;font-size:10px;line-height:1.7') + '">' + right + '</td></tr></table>';
    var head = '<tr>' + cols.map(function (c) { return PdfApi.th_(c[0], c[1]); }).join('') + '</tr>';
    var lab = PdfApi.box_('padding:6px 8px;font-size:10px;font-weight:bold;');
    var totals = '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr><td width="75%" style="' + lab + 'text-align:right">Total Amount (incl. GST)</td><td width="25%" align="right" style="' + lab + '">' + U.inr(net + gst) + '</td></tr></table>';
    var note = '<div style="font-size:9px;padding:6px 0">Rates are per piece and exclude GST unless stated. Please quote this PO number on your invoice, packing list and delivery challan.</div>';
    var gap = '<div style="height:10px;font-size:1px;line-height:1px">&nbsp;</div>';
    return '<html><head><meta charset="utf-8"><style>body{margin:16px;color:#1f2328;' + f + '}td,th,div,span,b{' + f + '}tr{page-break-inside:avoid}</style></head><body>' +
      banner + gap + info + gap + '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;table-layout:fixed">' + head + rows + '</table>' + gap + totals + note + '</body></html>';
  },
  /** Make the PO PDF, store its link on the Purchase row, return the link. */
  makePdf_: function (id, rowNum) {
    var po = ProcApi.poGet({ id: id }), name = po.no.replace(/[\/\\:*?"<>|]/g, '-') + '.pdf';
    var blob = Utilities.newBlob(ProcApi.html_(po), 'text/html', 'po.html').getAs('application/pdf').setName(name);
    var folder = ProcApi.folder_(), olds = folder.getFilesByName(name);
    while (olds.hasNext()) olds.next().setTrashed(true);
    var file = folder.createFile(blob);
    if (CONFIG.PDF_SHARE_LINK) file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = file.getUrl();
    Db.update('purchase', rowNum || ProcApi.find_(id)._row, { 'PO PDF': url });
    return url;
  },
  /** args: { id } - (re)make the PDF and return its link */
  poPdf: function (a) {
    var po = ProcApi.find_(a.id);
    if ((U.s(po['Status']) || 'Draft') === 'Draft') throw new Error('Send the purchase order first - the PDF is made when it is sent.');
    return { url: ProcApi.makePdf_(U.s(po['Purchase ID']), po._row) };
  }
};
