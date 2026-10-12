/**
 * Warehouse.gs - backend for the Warehouse screens: receiving (GRN), put-away, dispatch, stock, audit.
 *
 * Stock Movement is the stock ledger and is ADD-ONLY. It is written in exactly three places:
 *   put-away      +pieces at a location  (type "Put-away", Ref ID = GRN line)
 *   dispatch      -pieces at the pick location (type "Dispatch", Ref ID = sales order line)
 *   audit adj     +/- variance when Accounts approves a count (type "Audit adj", Ref ID = count)
 * Quantities in the ledger, Damaged Qty, Put_Qty and Counted Qty are PIECES; order and GRN line quantities are SETS.
 *
 * Sales order flow (the sheet's own Stage (auto) formula): To pick -> To pack -> Book transport -> Ready to dispatch -> Dispatched.
 *   Picked / Packed are line flags, Transport Booked is an order flag, Status = Dispatched closes the order.
 */

var Ledger = {
  /** { 'itemCode|location': pieces } from the whole ledger */
  balances: function () {
    var m = {};
    Db.readCols('movement', ['Item Code', 'Location', 'Qty']).forEach(function (r) {
      var k = U.s(r['Item Code']) + '|' + U.s(r['Location']), q = U.toNum(r['Qty']);
      m[k] = U.r4((m[k] || 0) + (isNaN(q) ? 0 : q));
    });
    return m;
  },
  at: function (bal, code, loc) { return bal[U.s(code) + '|' + U.s(loc)] || 0; },
  /** [{ loc, qty }] where the item sits now, biggest first */
  where: function (bal, code) {
    var out = [], pre = U.s(code) + '|';
    Object.keys(bal).forEach(function (k) { if (k.indexOf(pre) === 0 && bal[k] > 1e-9) out.push({ loc: k.slice(pre.length), qty: bal[k] }); });
    out.sort(function (a, b) { return b.qty - a.qty; });
    return out;
  },
  total: function (bal, code) {
    var t = 0, pre = U.s(code) + '|';
    Object.keys(bal).forEach(function (k) { if (k.indexOf(pre) === 0) t += bal[k]; });
    return U.r4(t);
  },
  /** entries: [{ code, loc, qty (signed pieces), type, ref }] */
  add: function (entries, user) {
    if (!entries.length) return;
    var taken = U.idSet(Db.readCols('movement', ['Move ID']), 'Move ID'), now = new Date();
    Db.append('movement', entries.map(function (e) {
      var raw = Items.raw(e.code);
      if (raw === null) throw new Error('Item ' + e.code + ' is not in Products, so its stock cannot be recorded.');
      return { 'Move ID': U.newId(taken), 'Ref ID': e.ref, 'Moved At': now, 'Item Code': raw, 'Qty': U.r4(e.qty), 'Location': e.loc, 'Type': e.type, 'Moved By': user.email };
    }), { 'Moved At': 'dd/mm/yyyy hh:mm:ss' });
  }
};

var WhApi = {
  routes: function () {
    var W = ['Warehouse'], WA = ['Warehouse', 'Accounts'];
    return {
      'loc.list':        [WhApi.locList, false, '*'],
      'wh.counts':       [WhApi.counts, false, W],
      'grn.list':        [WhApi.grnList, false, W],
      'grn.get':         [WhApi.grnGet, false, W],
      'grn.receive':     [WhApi.grnReceive, true, W],
      'put.list':        [WhApi.putList, false, W],
      'put.do':          [WhApi.putDo, true, W],
      'stock.list':      [WhApi.stockList, false, W],
      'stock.history':   [WhApi.stockHistory, false, W],
      'prod.create':     [WhApi.prodCreate, true, W],
      'audit.list':      [WhApi.auditList, false, WA],
      'audit.create':    [WhApi.auditCreate, true, W],
      'audit.review':    [WhApi.auditReview, true, ['Accounts']],
      'disp.list':       [WhApi.dispList, false, W],
      'disp.get':        [WhApi.dispGet, false, W],
      'disp.save':       [WhApi.dispSave, true, W],
      'disp.book':       [WhApi.dispBook, true, W],
      'disp.dispatch':   [WhApi.dispDispatch, true, W]
    };
  },

  // ---------- locations ----------
  locList: function () {
    return Db.readAll('locations').map(function (r) {
      return { code: U.s(r['Location Code']), desc: U.s(r['Description']), floor: U.s(r['Floor']), zone: U.s(r['Zone']) };
    }).filter(function (l) { return l.code; });
  },
  locSet_: function () { var m = {}; WhApi.locList().forEach(function (l) { m[l.code] = l; }); return m; },
  stamp_: function (v) {            // a date-time cell -> 'yyyy-MM-dd HH:mm'
    return v instanceof Date && !isNaN(v.getTime()) ? Utilities.formatDate(v, Db.tz(), 'yyyy-MM-dd HH:mm') : U.iso(v);
  },

  // ---------- receiving (GRN) ----------
  grnStatus_: function (g) { return U.s(g['Status']) === 'Received' || U.s(g['Received Date']) !== '' ? 'Received' : 'Yet to receive'; },

  lineOut_: function (r, items) {
    var code = U.s(r['Item Code']), p = code ? items[code] : null;
    var expPer = U.toNum(r['Expected pcs / set']), recPer = U.toNum(r['Received pcs / set']);
    var per = recPer >= 1 ? recPer : (expPer >= 1 ? expPer : (p ? p.pcs : 1));
    var expSets = U.toNum(r['Expected No. of Sets']), recRaw = U.s(r['Received No. of Sets']);
    var rec = recRaw === '' ? '' : U.toNum(recRaw), dmg = U.toNum(r['Damaged Qty']), sq = U.toNum(r['Stickered Qty']), pq = U.toNum(r['Put_Qty']);
    if (rec !== '' && isNaN(rec)) rec = '';
    return {
      id: U.s(r['Line ID']), grnId: U.s(r['GRN ID']), purchaseLineId: U.s(r['Purchase Line ID']), itemCode: code, desc: U.s(r['Description']),
      name: p ? (p.name || code) : U.s(r['Description']), supItemCode: U.s(r['Supplier item code']), per: per,
      expSets: isNaN(expSets) ? 0 : expSets, recSets: rec, damaged: isNaN(dmg) ? 0 : dmg,
      stickered: r['Stickered'] === true, stickeredQty: isNaN(sq) ? 0 : sq, putAway: r['Put Away'] === true, putQty: isNaN(pq) ? 0 : pq,
      location: U.s(r['Location']), goodPcs: rec === '' ? 0 : Math.max(0, U.r4(rec * per - (isNaN(dmg) ? 0 : dmg))), unplanned: !U.s(r['Purchase Line ID']), row: r._row
    };
  },

  /** args: { filter: 'To receive' | 'Received' | 'All', search } */
  grnList: function (a) {
    var sups = ProcApi.suppliers_(), items = Items.map(), today = U.isoToday();
    var pos = Rows.by(Db.readAll('purchase'), 'Purchase ID'), lines = Rows.group(Db.readAll('grnLines'), 'GRN ID');
    var f = U.s(a.filter) || 'To receive', q = U.s(a.search), counts = { toReceive: 0, received: 0 };
    var all = Db.readAll('grn').map(function (g) {
      var id = U.s(g['GRN ID']), ls = (lines[id] || []).map(function (r) { return WhApi.lineOut_(r, items); });
      var expPcs = 0, recPcs = 0, pending = 0, po = pos[U.s(g['Purchase ID'])], sid = U.s(g['Supplier']) || (po ? U.s(po['Supplier Company Name']) : '');
      ls.forEach(function (l) {
        expPcs += l.expSets * l.per;
        if (l.recSets !== '') recPcs += l.recSets * l.per;
        if (l.recSets !== '' && l.recSets > 0 && !l.putAway) pending++;
      });
      var status = WhApi.grnStatus_(g), delivery = po ? U.iso(po['Delivery Date']) : '';
      return {
        id: id, no: U.s(g['GRN No']), purchaseId: U.s(g['Purchase ID']), poNo: po ? U.s(po['Purchase No']) : '', supplierId: sid,
        supplier: sups.by[sid] ? sups.by[sid].name : '', invoiceNo: U.s(g['Supplier Invoice No']), invoiceDate: U.iso(g['Invoice Date']),
        receivedDate: U.iso(g['Received Date']), cartons: U.s(g['No. of cartons received']), status: status, lines: ls.length,
        expPcs: U.r4(expPcs), recPcs: U.r4(recPcs), pending: pending, delivery: delivery, late: status !== 'Received' && !!delivery && delivery < today
      };
    });
    all.forEach(function (g) { if (g.status === 'Received') counts.received++; else counts.toReceive++; });
    var rows = all.filter(function (g) {
      if (f === 'To receive' && g.status === 'Received') return false;
      if (f === 'Received' && g.status !== 'Received') return false;
      return !q || Rows.matches([g.no, g.poNo, g.supplier, g.invoiceNo].join(' '), q);
    });
    rows.sort(function (x, y) {
      if (f !== 'Received' && !x.delivery !== !y.delivery) return x.delivery ? -1 : 1;     // soonest expected first
      return x.no < y.no ? 1 : x.no > y.no ? -1 : 0;
    });
    return { shown: rows.length, rows: rows.slice(0, CONFIG.MAX_ROWS), counts: counts };
  },

  /** args: { id } */
  grnGet: function (a) {
    var g = Rows.by(Db.readAll('grn'), 'GRN ID')[U.s(a.id)];
    if (!g) throw new Error('That goods receipt was not found.');
    var items = Items.map(), id = U.s(g['GRN ID']), po = Rows.by(Db.readAll('purchase'), 'Purchase ID')[U.s(g['Purchase ID'])];
    var sups = ProcApi.suppliers_(), sid = U.s(g['Supplier']) || (po ? U.s(po['Supplier Company Name']) : '');
    var lines = Db.readAll('grnLines').filter(function (r) { return U.s(r['GRN ID']) === id; }).map(function (r) { return WhApi.lineOut_(r, items); });
    return {
      id: id, no: U.s(g['GRN No']), poNo: po ? U.s(po['Purchase No']) : '', supplier: sups.by[sid] ? sups.by[sid].name : '',
      delivery: po ? U.iso(po['Delivery Date']) : '', invoiceNo: U.s(g['Supplier Invoice No']), invoiceDate: U.iso(g['Invoice Date']),
      receivedDate: U.iso(g['Received Date']), cartons: U.s(g['No. of cartons received']), status: WhApi.grnStatus_(g), lines: lines
    };
  },

  /**
   * Save the count. args: { id, invoiceNo, invoiceDate, cartons, receivedDate, markReceived,
   *   lines: [{ id, recSets ('' = not counted), per, damaged, stickered, stickeredQty, itemCode? }],
   *   newLines: [{ itemCode?, desc, supItemCode, per, recSets, damaged }] (an item that arrived but was not on the PO) }
   * "Fill Received Date only when goods arrive": markReceived sets Received Date + Status = Received.
   */
  grnReceive: function (a, user) {
    var g = Rows.by(Db.readAll('grn'), 'GRN ID')[U.s(a.id)];
    if (!g) throw new Error('That goods receipt was not found.');
    var id = U.s(g['GRN ID']), items = Items.map(), all = Db.readAll('grnLines'), mine = all.filter(function (r) { return U.s(r['GRN ID']) === id; });
    var by = Rows.by(mine, 'Line ID'), invDate = '', recDate = '';
    if (U.s(a.invoiceDate)) { invDate = U.dateFromIso(a.invoiceDate); if (!invDate) throw new Error('The invoice date is not valid.'); }
    if (a.markReceived) { recDate = U.dateFromIso(U.s(a.receivedDate) || U.isoToday()); if (!recDate) throw new Error('The received date is not valid.'); }

    // 1. check everything first, so nothing is half-saved
    var updates = {}, counted = {};
    (a.lines || []).forEach(function (l, i) {
      var r = by[U.s(l.id)], n = 'Line ' + (i + 1) + ': ';
      if (!r) throw new Error(n + 'this line is not on this goods receipt any more. Close and open it again.');
      if (r['Put Away'] === true) return;                                  // already in a location: the count is final
      var sets = U.s(l.recSets) === '' ? '' : U.toNum(l.recSets);
      if (sets !== '' && !(sets >= 0)) throw new Error(n + 'enter the received quantity.');
      var cur = WhApi.lineOut_(r, items), per = U.toNum(l.per); if (!(per >= 1)) per = cur.per;
      var dmg = U.toNum(l.damaged); if (isNaN(dmg)) dmg = 0;
      if (dmg < 0) throw new Error(n + 'damaged quantity cannot be negative.');
      if (sets !== '' && dmg > sets * per + 1e-9) throw new Error(n + 'damaged pieces are more than the pieces received.');
      var sq = U.toNum(l.stickeredQty); if (isNaN(sq) || sq < 0) sq = 0;
      var obj = {
        'Received No. of Sets': sets === '' ? '' : Rows.sets(sets), 'Received pcs / set': per, 'Damaged Qty': U.r4(dmg),
        'Stickered': l.stickered === true, 'Stickered Qty': l.stickered === true ? U.r4(sq) : 0
      };
      if (!U.s(r['Item Code']) && U.s(l.itemCode)) {
        var raw = Items.raw(U.s(l.itemCode));
        if (raw === null) throw new Error(n + 'item ' + U.s(l.itemCode) + ' is not in Products.');
        obj['Item Code'] = raw;
      }
      updates[U.s(l.id)] = { row: r._row, obj: obj };
      counted[U.s(l.id)] = sets === '' ? 0 : sets;
    });
    var fresh = (a.newLines || []).map(function (l, i) {
      var n = 'New item ' + (i + 1) + ': ', code = U.s(l.itemCode), desc = U.s(l.desc), sets = U.toNum(l.recSets), per = U.toNum(l.per), dmg = U.toNum(l.damaged);
      if (code && Items.raw(code) === null) throw new Error(n + 'item ' + code + ' is not in Products.');
      if (!code && !desc) throw new Error(n + 'pick the item, or type its name.');
      if (!(sets > 0)) throw new Error(n + 'enter the received quantity.');
      if (!(per >= 1)) per = code ? Items.pcs(code, 1) : 1;
      if (isNaN(dmg) || dmg < 0) dmg = 0;
      if (dmg > sets * per + 1e-9) throw new Error(n + 'damaged pieces are more than the pieces received.');
      return { code: code, desc: code ? '' : desc, sup: U.s(l.supItemCode), per: per, sets: U.r4(sets), dmg: U.r4(dmg) };
    });
    if (a.markReceived) {
      var any = fresh.length > 0;
      mine.forEach(function (r) {
        var cs = counted[U.s(r['Line ID'])];
        var sets = cs !== undefined ? cs : (U.s(r['Received No. of Sets']) === '' ? 0 : U.toNum(r['Received No. of Sets']));
        if (sets > 0) any = true;
      });
      if (!any) throw new Error('Enter the received quantity of at least one item before marking the goods as received.');
    }

    // 2. write
    var ct = U.toNum(a.cartons);
    Db.update('grn', g._row, { 'Supplier Invoice No': U.s(a.invoiceNo), 'Invoice Date': invDate, 'No. of cartons received': isNaN(ct) ? U.s(a.cartons) : ct });
    Object.keys(updates).forEach(function (k) { Db.update('grnLines', updates[k].row, updates[k].obj); });
    if (fresh.length) {
      var taken = U.idSet(all, 'Line ID');
      Db.append('grnLines', fresh.map(function (l) {
        return {
          'Line ID': U.newId(taken), 'GRN ID': id, 'Item Code': l.code ? Items.raw(l.code) : '', 'Description': l.desc, 'Supplier item code': l.sup,
          'Received pcs / set': l.per, 'Received No. of Sets': l.sets, 'Damaged Qty': l.dmg, 'Stickered': false, 'Put Away': false
        };
      }));
    }
    if (a.markReceived) Db.update('grn', g._row, { 'Received Date': recDate, 'Received By': user.email, 'Status': 'Received' });
    return { id: id, status: a.markReceived ? 'Received' : WhApi.grnStatus_(g) };
  },

  // ---------- put-away ----------
  /** Lines of received goods that still need a location. args: { search } */
  putList: function (a) {
    var items = Items.map(), bal = Ledger.balances(), grns = Rows.by(Db.readAll('grn'), 'GRN ID'), sups = ProcApi.suppliers_(), q = U.s(a.search);
    var rows = [];
    Db.readAll('grnLines').forEach(function (r) {
      var l = WhApi.lineOut_(r, items), g = grns[l.grnId];
      if (!g || WhApi.grnStatus_(g) !== 'Received' || l.putAway || !(l.recSets > 0) || !(l.goodPcs > 0)) return;
      var sid = U.s(g['Supplier']), out = {
        id: l.id, grnId: l.grnId, grnNo: U.s(g['GRN No']), supplier: sups.by[sid] ? sups.by[sid].name : '', receivedDate: U.iso(g['Received Date']),
        itemCode: l.itemCode, name: l.name, per: l.per, goodPcs: l.goodPcs, damaged: l.damaged, stickered: l.stickered, stickeredQty: l.stickeredQty,
        planned: l.location, where: l.itemCode ? Ledger.where(bal, l.itemCode).slice(0, 3) : []
      };
      if (!q || Rows.matches([out.grnNo, out.supplier, out.itemCode, out.name].join(' '), q)) rows.push(out);
    });
    rows.sort(function (x, y) { return x.receivedDate < y.receivedDate ? -1 : x.receivedDate > y.receivedDate ? 1 : (x.grnNo < y.grnNo ? -1 : 1); });
    return { shown: rows.length, rows: rows.slice(0, CONFIG.MAX_ROWS) };
  },

  /**
   * Put goods in a location. args: { lineId, location, pcs ('' = all), itemCode? (when the line has none), stickered? }
   * Putting away only part of a line SPLITS it: this line keeps what was put away, a new line carries the rest
   * (the received sets add up to the same total, so the PO line's Open Sets does not change).
   */
  putDo: function (a, user) {
    var tbl = Db.readAll('grnLines'), r = Rows.by(tbl, 'Line ID')[U.s(a.lineId)];
    if (!r) throw new Error('That line was not found.');
    if (r['Put Away'] === true) throw new Error('This line is already put away.');
    var g = Rows.by(Db.readAll('grn'), 'GRN ID')[U.s(r['GRN ID'])];
    if (!g || WhApi.grnStatus_(g) !== 'Received') throw new Error('Mark the goods as received first (Receiving tab).');
    var items = Items.map(), code = U.s(r['Item Code']) || U.s(a.itemCode);
    if (!code) throw new Error('This line has no item code yet. Pick the item first.');
    if (!items[code]) throw new Error('Item ' + code + ' is not in Products. Add it first (Stock tab > New item).');
    var loc = U.s(a.location);
    if (!WhApi.locSet_()[loc]) throw new Error('Pick a location from the list.');
    var L = WhApi.lineOut_(r, items);
    if (!(L.recSets > 0)) throw new Error('Count the goods first (Receiving tab).');
    var good = L.goodPcs, put = U.s(a.pcs) === '' ? good : U.toNum(a.pcs);
    if (!(put > 0)) throw new Error('Enter how many pieces to put away.');
    if (put > good + 1e-6) throw new Error('Only ' + good + ' pcs can be put away on this line.');
    var per = L.per, split = good - put > 1e-6;
    var upd = { 'Put Away': true, 'Put Away By': user.email, 'Put_Qty': U.r4(put), 'Location': loc };
    if (!U.s(r['Item Code'])) upd['Item Code'] = Items.raw(code);
    if (a.stickered === true) upd['Stickered'] = true;
    var newRow = 0;
    if (split) {
      upd['Received No. of Sets'] = Rows.sets((put + L.damaged) / per);        // the damaged pieces stay with the part that is put away
      upd['Received pcs / set'] = per;
      newRow = Db.append('grnLines', [{
        'Line ID': U.newId(U.idSet(tbl, 'Line ID')), 'GRN ID': U.s(r['GRN ID']), 'Purchase Line ID': U.s(r['Purchase Line ID']), 'Item Code': Items.raw(code),
        'Description': U.s(r['Description']), 'Supplier item code': U.s(r['Supplier item code']), 'Expected pcs / set': r['Expected pcs / set'],
        'Received pcs / set': per, 'Received No. of Sets': Rows.sets((good - put) / per), 'Damaged Qty': 0,
        'Stickered': L.stickered || a.stickered === true, 'Put Away': false
      }])[0];
    }
    try {
      Ledger.add([{ code: code, loc: loc, qty: put, type: 'Put-away', ref: U.s(r['Line ID']) }], user);
      Db.update('grnLines', r._row, upd);
    } catch (e) {
      if (newRow) Rows.wipe('grnLines', newRow);                            // undo the split; nothing else has changed yet
      throw e;
    }
    return { putAway: U.r4(put), location: loc, split: split, left: split ? U.r4(good - put) : 0 };
  },

  // ---------- stock (read-only view of the ledger) ----------
  /** args: { filter: 'In warehouse' | 'Mismatch' | 'Short' | 'All', search } */
  stockList: function (a) {
    var items = Items.map(), bal = Ledger.balances(), at = {}, f = U.s(a.filter) || 'In warehouse', q = U.s(a.search), maxCode = 0;
    Object.keys(bal).forEach(function (k) {
      var i = k.indexOf('|'), code = k.slice(0, i);
      if (Math.abs(bal[k]) > 1e-9) (at[code] = at[code] || []).push({ loc: k.slice(i + 1), qty: bal[k] });
    });
    var counts = { inWh: 0, mismatch: 0, short: 0 }, rows = [];
    Object.keys(items).forEach(function (code) {
      var p = items[code], locs = (at[code] || []).sort(function (x, y) { return y.qty - x.qty; }), wh = 0;
      locs.forEach(function (l) { wh += l.qty; });
      wh = U.r4(wh);
      if (/^\d+$/.test(code)) maxCode = Math.max(maxCode, parseInt(code, 10));
      var mismatch = Math.abs(p.books - wh) > 0.5 && (p.books > 0 || wh !== 0), short = p.avail !== '' && p.avail < 0;
      if (wh !== 0) counts.inWh++;
      if (mismatch) counts.mismatch++;
      if (short) counts.short++;
      if (f === 'In warehouse' && wh === 0) return;
      if (f === 'Mismatch' && !mismatch) return;
      if (f === 'Short' && !short) return;
      var hay = [code, p.name, p.group, locs.map(function (l) { return l.loc; }).join(' ')].join(' ');
      if (q && !Rows.matches(hay, q)) return;
      rows.push({ code: code, name: p.name, group: p.group, pcs: p.pcs, books: p.books, wh: wh, reserved: p.reserved, onOrder: p.onOrder,
                  avail: p.avail, locs: locs });
    });
    rows.sort(function (x, y) { return x.code.length - y.code.length || (x.code < y.code ? -1 : x.code > y.code ? 1 : 0); });
    return { shown: rows.length, rows: rows.slice(0, 200), counts: counts, nextCode: String(maxCode + 1) };
  },

  /** args: { code } - the ledger lines of one item, newest first */
  stockHistory: function (a) {
    var code = U.s(a.code), rows = [];
    Db.readAll('movement').forEach(function (r) {
      if (U.s(r['Item Code']) !== code) return;
      rows.push({ at: WhApi.stamp_(r['Moved At']), qty: U.toNum(r['Qty']), loc: U.s(r['Location']), type: U.s(r['Type']), by: U.s(r['Moved By']), ref: U.s(r['Ref ID']), row: r._row });
    });
    rows.sort(function (x, y) { return y.row - x.row; });
    return { code: code, name: Items.name(code, ''), rows: rows.slice(0, 80), total: rows.length };
  },

  /** A new item, so goods that are not in Products yet can be put away. args: { code, name, pcs, group, gst (percent) } */
  prodCreate: function (a) {
    var code = U.s(a.code), name = U.s(a.name).replace(/\s+/g, ' ');
    if (!code) throw new Error('Enter the item code.');
    if (!name) throw new Error('Enter the item name.');
    if (Items.raw(code) !== null) throw new Error('Item code ' + code + ' already exists.');
    var pcs = U.toNum(a.pcs); if (!(pcs >= 1)) pcs = 1;
    var gst = U.toNum(a.gst), obj = {
      'Item Code': /^\d+$/.test(code) ? Number(code) : code, 'Tally Name': name, 'Stock Group': U.s(a.group) || 'Uncategorised', 'Pcs / Set': pcs
    };
    if (!isNaN(gst)) { if (gst < 0 || gst > 100) throw new Error('GST must be between 0 and 100 %.'); obj['GST_Pct'] = gst / 100; }
    Db.append('products', [obj], { 'GST_Pct': '0.00%' });
    Catalog._codes = null; Items.reset();
    return { code: code };
  },

  // ---------- audit counts ----------
  /** args: { filter: Pending|Approved|Rejected|All, search } */
  auditList: function (a) {
    var items = Items.map(), bal = Ledger.balances(), f = U.s(a.filter) || 'Pending', q = U.s(a.search), counts = { pending: 0 };
    var all = Db.readAll('audit').map(function (r) {
      var code = U.s(r['Item Code']), loc = U.s(r['Location']), st = U.s(r['Status']) || 'Pending', counted = U.toNum(r['Counted Qty']), photo = U.s(r['Photo']);
      var sys = code && st === 'Pending' ? Ledger.at(bal, code, loc) : null;
      return {
        id: U.s(r['Count ID']), at: WhApi.stamp_(r['Counted At']), itemCode: code, desc: U.s(r['Description']), name: Items.name(code, r['Description']),
        loc: loc, counted: isNaN(counted) ? 0 : counted, by: U.s(r['Counted By']), status: st,
        system: sys, variance: sys === null ? null : U.r4((isNaN(counted) ? 0 : counted) - sys),
        photo: /^https?:\/\//i.test(photo) ? photo : '', hasPhoto: !!photo, reviewedBy: U.s(r['Reviewed By']), reviewedOn: U.iso(r['Reviewed On']), row: r._row
      };
    });
    all.forEach(function (c) { if (c.status === 'Pending') counts.pending++; });
    var rows = all.filter(function (c) {
      if (f !== 'All' && c.status !== f) return false;
      return !q || Rows.matches([c.itemCode, c.name, c.loc, c.by].join(' '), q);
    });
    rows.sort(function (x, y) { return y.row - x.row; });
    return { shown: rows.length, rows: rows.slice(0, CONFIG.MAX_ROWS), counts: counts };
  },

  /** args: { itemCode?, desc?, location, qty (pieces), photo: { name, data (base64 JPEG) }? } */
  auditCreate: function (a, user) {
    var code = U.s(a.itemCode), desc = U.s(a.desc), loc = U.s(a.location), qty = U.toNum(a.qty), raw = '';
    if (code) { raw = Items.raw(code); if (raw === null) throw new Error('Item ' + code + ' is not in Products.'); desc = Items.name(code, ''); }
    else if (!desc) throw new Error('Pick the item, or type what you counted.');
    if (!WhApi.locSet_()[loc]) throw new Error('Pick the location from the list.');
    if (isNaN(qty) || qty < 0) throw new Error('Enter the counted quantity in pieces (0 if the shelf is empty).');
    var id = U.newId(U.idSet(Db.readAll('audit'), 'Count ID')), photo = '';
    if (a.photo && U.s(a.photo.data)) photo = WhApi.savePhoto_(id, a.photo);
    Db.append('audit', [{
      'Count ID': id, 'Counted At': new Date(), 'Item Code': raw, 'Description': desc, 'Location': loc, 'Counted Qty': U.r4(qty),
      'Photo': photo, 'Counted By': user.email, 'Status': 'Pending'
    }], { 'Counted At': 'dd/mm/yyyy hh:mm:ss' });
    return { id: id };
  },
  savePhoto_: function (id, p) {
    var data = U.s(p.data).replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    if (data.length > 5500000) throw new Error('That picture is too large (limit about 4 MB).');
    var bytes = Utilities.base64Decode(data);
    if (Photos.sniff_(bytes) === '') throw new Error('Please use a JPG, PNG or GIF picture.');
    var folder;
    if (CONFIG.AUDIT_PHOTO_FOLDER_ID) folder = DriveApp.getFolderById(CONFIG.AUDIT_PHOTO_FOLDER_ID);
    else { var it = DriveApp.getFoldersByName(CONFIG.AUDIT_PHOTO_FOLDER_NAME); folder = it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.AUDIT_PHOTO_FOLDER_NAME); }
    var name = id + '.' + U.s(p.name).replace(/[^\w.-]+/g, '_').slice(-40);
    return folder.createFile(Utilities.newBlob(bytes, Photos.sniff_(bytes), name)).getUrl();
  },

  /** Accounts' decision. args: { id, decision: Approved|Rejected, itemCode? (when the count has none) } */
  auditReview: function (a, user) {
    var r = Rows.by(Db.readAll('audit'), 'Count ID')[U.s(a.id)], d = U.s(a.decision);
    if (!r) throw new Error('That count was not found.');
    if (['Approved', 'Rejected'].indexOf(d) < 0) throw new Error('Decision must be Approved or Rejected.');
    if ((U.s(r['Status']) || 'Pending') !== 'Pending') throw new Error('This count has already been reviewed.');
    var code = U.s(r['Item Code']) || U.s(a.itemCode), loc = U.s(r['Location']), upd = { 'Status': d, 'Reviewed By': user.email, 'Reviewed On': U.today() };
    var out = { status: d, adjusted: 0, system: null };
    if (d === 'Approved') {
      if (!code) throw new Error('This count has no item code. Pick the item before approving.');
      if (Items.raw(code) === null) throw new Error('Item ' + code + ' is not in Products.');
      if (!WhApi.locSet_()[loc]) throw new Error('The location on this count is not in the Locations tab.');
      var sys = Ledger.at(Ledger.balances(), code, loc), counted = U.toNum(r['Counted Qty']), diff = U.r4((isNaN(counted) ? 0 : counted) - sys);
      if (!U.s(r['Item Code'])) upd['Item Code'] = Items.raw(code);
      if (Math.abs(diff) > 1e-9) Ledger.add([{ code: code, loc: loc, qty: diff, type: 'Audit adj', ref: U.s(r['Count ID']) }], user);
      out.adjusted = diff; out.system = sys;
    }
    Db.update('audit', r._row, upd);
    return out;
  },

  // ---------- dispatch (pick, pack, book transport, dispatch) ----------
  line2_: function (r, items) {
    var code = U.s(r['Item_Code']), p = code ? items[code] : null, pcs = U.toNum(r['Pcs / Set']);
    if (!(pcs >= 1)) pcs = p ? p.pcs : 1;
    var sets = U.toNum(r['No. of set']); if (isNaN(sets)) sets = 0;
    var dq = U.toNum(r['Dispatched Qty']); if (isNaN(dq)) dq = 0;
    var done = r['Dispatched'] === true, open = done ? 0 : Math.max(0, U.r4(sets - dq));
    return {
      id: U.s(r['Line ID']), orderId: U.s(r['Order ID']), itemCode: code, desc: U.s(r['Description']), name: p ? (p.name || code) : U.s(r['Description']),
      pcs: pcs, sets: sets, dispatchedSets: done ? sets : dq, open: open, pickFrom: U.s(r['Pick From']), picked: r['Picked'] === true,
      packed: r['Packed'] === true, dispatched: done, dispatchDate: U.iso(r['Dispatch Date']), row: r._row
    };
  },
  /** the sheet's Stage (auto), worked out here too in case the cell has not recalculated yet */
  stage_: function (order, ls) {
    var st = U.s(order['Status']);
    if (st === 'Cancelled' || st === 'Dispatched') return st;
    if (!ls.length) return 'No lines';
    var picked = ls.filter(function (l) { return l.picked; }).length, packed = ls.filter(function (l) { return l.packed; }).length;
    if (picked < ls.length) return 'To pick';
    if (packed < ls.length) return 'To pack';
    return order['Transport Booked'] === true ? 'Ready to dispatch' : 'Book transport';
  },

  /** args: { filter: 'Open' | 'Ready' | 'Dispatched' | 'All', search } */
  dispList: function (a) {
    var items = Items.map(), lines = Rows.group(Db.readAll('orderLines'), 'Order ID'), f = U.s(a.filter) || 'Open', q = U.s(a.search);
    var stages = {}, all = Db.readAll('orders').map(function (o) {
      var id = U.s(o['Order ID']), ls = (lines[id] || []).map(function (r) { return WhApi.line2_(r, items); });
      var stage = U.s(o['Stage (auto)']) || WhApi.stage_(o, ls), sets = 0, open = 0;
      ls.forEach(function (l) { sets += l.sets; open += l.open; });
      return {
        id: id, no: U.s(o['Order No.']), date: U.iso(o['Order Date']), customer: U.s(o['Customer (auto)']), delivery: U.s(o['Delivery Terms']),
        status: U.s(o['Status']), stage: stage, lines: ls.length, picked: ls.filter(function (l) { return l.picked; }).length,
        packed: ls.filter(function (l) { return l.packed; }).length, done: ls.filter(function (l) { return l.dispatched || (l.sets > 0 && l.open <= 0); }).length,
        booked: o['Transport Booked'] === true, transporter: U.s(o['Transporter']), lr: U.s(o['LR No.']), dispatchDate: U.iso(o['Dispatch Date']),
        sets: U.r4(sets), openSets: U.r4(open), row: o._row
      };
    });
    all.forEach(function (o) { if (o.stage !== 'Dispatched' && o.stage !== 'Cancelled') stages[o.stage] = (stages[o.stage] || 0) + 1; });
    var rows = all.filter(function (o) {
      var closed = o.stage === 'Dispatched' || o.stage === 'Cancelled';
      if (f === 'Open' && closed) return false;
      if (f === 'Ready' && o.stage !== 'Ready to dispatch') return false;
      if (f === 'Dispatched' && o.stage !== 'Dispatched') return false;
      return !q || Rows.matches([o.no, o.customer].join(' '), q);
    });
    rows.sort(function (x, y) { return y.date > x.date ? 1 : y.date < x.date ? -1 : y.row - x.row; });
    return { shown: rows.length, rows: rows.slice(0, CONFIG.MAX_ROWS), stages: stages };
  },

  order_: function (id) {
    var o = Rows.by(Db.readAll('orders'), 'Order ID')[U.s(id)];
    if (!o) throw new Error('Order not found.');
    return o;
  },

  /** args: { orderId } */
  dispGet: function (a) {
    var o = WhApi.order_(a.orderId), items = Items.map(), id = U.s(o['Order ID']), bal = Ledger.balances();
    var ls = Db.readAll('orderLines').filter(function (r) { return U.s(r['Order ID']) === id; }).map(function (r) {
      var l = WhApi.line2_(r, items);
      l.stock = l.itemCode ? Ledger.where(bal, l.itemCode) : [];
      l.onHand = l.itemCode ? Ledger.total(bal, l.itemCode) : 0;
      l.atPick = l.pickFrom && l.itemCode ? Ledger.at(bal, l.itemCode, l.pickFrom) : 0;
      return l;
    });
    return {
      id: id, no: U.s(o['Order No.']), date: U.iso(o['Order Date']), customer: U.s(o['Customer (auto)']), delivery: U.s(o['Delivery Terms']),
      status: U.s(o['Status']), stage: U.s(o['Stage (auto)']) || WhApi.stage_(o, ls), booked: o['Transport Booked'] === true,
      transporter: U.s(o['Transporter']), lr: U.s(o['LR No.']), dispatchDate: U.iso(o['Dispatch Date']), lines: ls
    };
  },

  mustBeOpen_: function (o) {
    var st = U.s(o['Status']);
    if (st === 'Cancelled') throw new Error('This order was cancelled.');
    if (st === 'Dispatched') throw new Error('This order is already dispatched.');
  },

  /** Pick / pack. args: { orderId, lines: [{ id, pickFrom, picked, packed }] } */
  dispSave: function (a) {
    var o = WhApi.order_(a.orderId), items = Items.map(), id = U.s(o['Order ID']), locs = WhApi.locSet_(), bal = Ledger.balances();
    WhApi.mustBeOpen_(o);
    var mine = Rows.by(Db.readAll('orderLines').filter(function (r) { return U.s(r['Order ID']) === id; }), 'Line ID'), ups = [], warnings = [];
    (a.lines || []).forEach(function (x) {
      var r = mine[U.s(x.id)];
      if (!r) throw new Error('A line on this screen is not on this order any more. Close and open it again.');
      var l = WhApi.line2_(r, items), from = U.s(x.pickFrom), picked = x.picked === true, packed = x.packed === true;
      if (l.dispatched || (l.sets > 0 && l.open <= 0)) return;                // already shipped: leave it alone
      var n = (l.name || 'Item') + ': ';
      if (from && !locs[from]) throw new Error(n + 'pick-from "' + from + '" is not in the Locations tab.');
      if (picked && !from) throw new Error(n + 'choose where it is picked from.');
      if (packed && !picked) throw new Error(n + 'pick it before packing it.');
      if (!picked && packed) packed = false;
      if (picked && l.itemCode && from) {
        var have = Ledger.at(bal, l.itemCode, from), need = U.r4(l.open * l.pcs);
        if (have + 1e-9 < need) warnings.push(n + 'only ' + have + ' pcs recorded at ' + from + ' (needs ' + need + ').');
      }
      ups.push({ row: r._row, obj: { 'Pick From': from, 'Picked': picked, 'Packed': packed } });
    });
    ups.forEach(function (u) { Db.update('orderLines', u.row, u.obj); });
    return { saved: ups.length, warnings: warnings };
  },

  /** Book (or un-book) the transport. args: { orderId, booked, transporter, lrNo } */
  dispBook: function (a) {
    var o = WhApi.order_(a.orderId), items = Items.map(), id = U.s(o['Order ID']), booked = a.booked !== false, tr = U.s(a.transporter);
    WhApi.mustBeOpen_(o);
    var ls = Db.readAll('orderLines').filter(function (r) { return U.s(r['Order ID']) === id; }).map(function (r) { return WhApi.line2_(r, items); });
    if (booked) {
      if (!ls.length) throw new Error('This order has no lines.');
      if (ls.some(function (l) { return !l.packed && !(l.dispatched || (l.sets > 0 && l.open <= 0)); })) throw new Error('Pick and pack every item before booking the transport.');
      if (!tr) throw new Error('Enter the transporter you booked.');
    } else if (ls.some(function (l) { return l.dispatchedSets > 0; })) throw new Error('Part of this order has already gone out, so the booking cannot be undone.');
    var upd = { 'Transport Booked': booked, 'Transporter': booked ? tr : '' };
    if (U.s(a.lrNo) !== '' || !booked) upd['LR No.'] = booked ? U.s(a.lrNo) : '';
    Db.update('orders', o._row, upd);
    return { booked: booked };
  },

  /**
   * Hand the goods over. args: { orderId, lines: [{ id, sets }], lrNo, transporter, date }
   * Needs: every shipped line picked + packed, transport booked, enough stock at the pick location.
   * Writes a negative "Dispatch" movement per line; the line's Dispatched Qty adds up (partial shipments), and when
   * nothing is left on the order its Status becomes Dispatched.
   */
  dispDispatch: function (a, user) {
    var o = WhApi.order_(a.orderId), items = Items.map(), id = U.s(o['Order ID']);
    WhApi.mustBeOpen_(o);
    if (o['Transport Booked'] !== true) throw new Error('Book the transport first.');
    var date = U.dateFromIso(U.s(a.date) || U.isoToday());
    if (!date) throw new Error('The dispatch date is not valid.');
    var allRows = Db.readAll('orderLines').filter(function (r) { return U.s(r['Order ID']) === id; }), mine = Rows.by(allRows, 'Line ID');
    var bal = Ledger.balances(), need = {}, plan = [], warnings = [];
    (a.lines || []).forEach(function (x) {
      var sets = U.toNum(x.sets);
      if (!(sets > 0)) return;
      var r = mine[U.s(x.id)];
      if (!r) throw new Error('A line on this screen is not on this order any more. Close and open it again.');
      var l = WhApi.line2_(r, items), n = (l.name || 'Item') + ': ';
      if (l.dispatched || l.open <= 0) throw new Error(n + 'already dispatched.');
      if (!l.picked || !l.packed) throw new Error(n + 'pick and pack it first.');
      if (sets > l.open + 1e-9) throw new Error(n + 'only ' + l.open + ' sets are left to dispatch.');
      var pcs = U.r4(sets * l.pcs);
      if (l.itemCode) {
        if (!l.pickFrom) throw new Error(n + 'choose where it is picked from.');
        var k = l.itemCode + '|' + l.pickFrom;
        need[k] = U.r4((need[k] || 0) + pcs);
        if (need[k] > (bal[k] || 0) + 1e-9) throw new Error(n + 'only ' + (bal[k] || 0) + ' pcs are recorded at ' + l.pickFrom + ', but ' + need[k] + ' are going out. Fix the stock first (put-away or audit).');
      } else warnings.push(n + 'no item code, so no stock was reduced.');
      plan.push({ l: l, sets: U.r4(sets), pcs: pcs });
    });
    if (!plan.length) throw new Error('Enter how many sets to dispatch on at least one line.');

    var entries = [];
    plan.forEach(function (p) { if (p.l.itemCode) entries.push({ code: p.l.itemCode, loc: p.l.pickFrom, qty: -p.pcs, type: 'Dispatch', ref: p.l.id }); });
    Ledger.add(entries, user);
    plan.forEach(function (p) {
      var total = U.r4(p.l.dispatchedSets + p.sets), full = total >= p.l.sets - 1e-9;
      Db.update('orderLines', p.l.row, { 'Dispatched Qty': total, 'Dispatched': full, 'Dispatch Date': date, 'Dispatched By': user.email });
      p.l.dispatchedSets = total; p.l.open = full ? 0 : U.r4(p.l.sets - total); p.l.dispatched = full;
    });
    var left = allRows.some(function (r) {
      var l = WhApi.line2_(r, items), p = plan.filter(function (x) { return x.l.id === l.id; })[0];
      return (p ? p.l.open : l.open) > 1e-9;
    });
    var head = { 'Dispatch Date': date, 'Dispatched By': user.email };
    if (U.s(a.lrNo)) head['LR No.'] = U.s(a.lrNo);
    if (U.s(a.transporter)) head['Transporter'] = U.s(a.transporter);
    if (!left) head['Status'] = 'Dispatched';
    Db.update('orders', o._row, head);
    return { dispatched: plan.length, complete: !left, warnings: warnings };
  },

  // ---------- numbers for tab badges ----------
  counts: function () {
    var toReceive = 0, pend = 0, items = Items.map();
    var grns = Db.readAll('grn'), by = Rows.by(grns, 'GRN ID');
    grns.forEach(function (g) { if (WhApi.grnStatus_(g) !== 'Received') toReceive++; });
    Db.readAll('grnLines').forEach(function (r) {
      var g = by[U.s(r['GRN ID'])];
      if (g && WhApi.grnStatus_(g) === 'Received' && r['Put Away'] !== true && U.toNum(r['Received No. of Sets']) > 0) pend++;
    });
    var lines = Rows.group(Db.readAll('orderLines'), 'Order ID'), toShip = 0, ready = 0;
    Db.readAll('orders').forEach(function (o) {
      var st = U.s(o['Stage (auto)']) || WhApi.stage_(o, (lines[U.s(o['Order ID'])] || []).map(function (r) { return WhApi.line2_(r, items); }));
      if (['To pick', 'To pack', 'Book transport', 'Ready to dispatch'].indexOf(st) >= 0) toShip++;
      if (st === 'Ready to dispatch') ready++;
    });
    var audit = 0;
    Db.readAll('audit').forEach(function (r) { if ((U.s(r['Status']) || 'Pending') === 'Pending') audit++; });
    return { receiving: toReceive, putaway: pend, dispatch: toShip, ready: ready, audit: audit };
  }
};
