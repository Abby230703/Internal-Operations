/**
 * Accounts.gs - backend for the Accounts screens: order receipts (billing + money received), purchase receipts
 * (supplier bills + money paid) and the payments ledger. Counts of stock are reviewed in the Audit tab (Warehouse.gs).
 *
 * Tables: Sales Orders (Tally Voucher No., Invoice Date, Due Date, Invoice Amount, Payment Cleared On), GRN (Bill Amount,
 * Tally Purchase Voucher No.), Payments (one row per receipt or payment; a part payment is another row).
 *
 * Money rules:
 *   - An order is worth "Invoice Amount" once billed, until then its value including GST (from the order lines).
 *   - Received / Paid / Balance are worked out here from the Payments rows (the sheet's own (auto) columns are never written).
 *   - Payments are added, never overwritten. A wrong entry is corrected in place (amount, date, mode, reference);
 *     only an Admin can delete one.
 *   - Typed date columns (Payment Date, Invoice Date, Due Date) are written as serial numbers: see Rows.serial in Items.gs.
 */

var AcctApi = {
  routes: function () {
    var A = ['Accounts'];
    return {
      'acc.counts':  [AcctApi.counts, false, A],
      'ord.list':    [AcctApi.ordList, false, A],
      'ord.get':     [AcctApi.ordGet, false, A],
      'ord.bill':    [AcctApi.ordBill, true, A],
      'bill.list':   [AcctApi.billList, false, A],
      'bill.get':    [AcctApi.billGet, false, A],
      'bill.save':   [AcctApi.billSave, true, A],
      'pay.add':     [AcctApi.payAdd, true, A],
      'pay.list':    [AcctApi.payList, false, A],
      'pay.save':    [AcctApi.paySave, true, A],
      'pay.delete':  [AcctApi.payDelete, true, []]        // Admin only
    };
  },

  // ---------- small helpers ----------
  /** a date cell -> 'yyyy-MM-dd' (also accepts a plain serial number, in case a date column was formatted as a number) */
  iso_: function (v) {
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return d.getUTCFullYear() + '-' + U.pad(d.getUTCMonth() + 1) + '-' + U.pad(d.getUTCDate());
    }
    return U.iso(v);
  },
  /** 'yyyy-mm-dd' from the screen, checked. blank -> '' when optional */
  date_: function (v, label, optional) {
    var t = U.s(v);
    if (!t) { if (optional) return ''; throw new Error('Enter the ' + label + '.'); }
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (!m) throw new Error('The ' + label + ' is not a valid date.');
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new Error('The ' + label + ' is not a valid date.');
    return t;
  },
  money_: function (v, label) {
    var n = U.toNum(v);
    if (isNaN(n) || !(n > 0)) throw new Error('Enter the ' + label + ' (more than 0).');
    if (n > 1e9) throw new Error('The ' + label + ' looks too large.');
    return U.r2(n);
  },
  num_: function (v) { var n = U.toNum(v); return isNaN(n) ? 0 : n; },
  addMonthsIso_: function (iso, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return '';
    var y = +m[1], mo = +m[2] - 1 + n, day = +m[3];
    var last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate(), d = new Date(Date.UTC(y, mo, Math.min(day, last)));
    return d.getUTCFullYear() + '-' + U.pad(d.getUTCMonth() + 1) + '-' + U.pad(d.getUTCDate());
  },
  /** When is money due, going by the payment terms ("30 days credit", "3 months credit period", "100% advance", "After delivery")? */
  dueFrom_: function (terms, iso) {
    var t = U.low(terms), m = /(\d+)\s*(day|month)/.exec(t);
    if (!iso) return '';
    if (/credit/.test(t) && m) return m[2] === 'month' ? AcctApi.addMonthsIso_(iso, +m[1]) : U.addDaysIso(iso, +m[1]);
    if (/advance|after delivery|cash/.test(t)) return iso;
    return '';
  },
  /** Payments grouped by what they were for: { 'Order|id': { sum (signed, in the natural direction), last (iso), rows } } */
  payIndex_: function () {
    var idx = {};
    Db.readAll('payments').forEach(function (r) {
      var type = U.s(r['Ref Type']), id = U.s(r['Ref ID']), dir = U.s(r['Direction']), amt = U.toNum(r['Amount']);
      if (!type || !id || isNaN(amt)) return;
      var natural = type === 'Order' ? 'Received' : 'Paid', k = type + '|' + id;
      var e = idx[k] || (idx[k] = { sum: 0, last: '', rows: [] }), date = AcctApi.iso_(r['Payment Date']);
      e.sum = U.r2(e.sum + (dir === natural ? amt : -amt));
      if (date > e.last) e.last = date;
      e.rows.push(r);
    });
    return idx;
  },
  payOut_: function (r, refNo, party) {
    var type = U.s(r['Ref Type']);
    return {
      id: U.s(r['Payment ID']), date: AcctApi.iso_(r['Payment Date']), direction: U.s(r['Direction']), refType: type, refId: U.s(r['Ref ID']),
      refNo: refNo || '', party: party || '', amount: U.r2(AcctApi.num_(r['Amount'])), mode: U.s(r['Mode']), referenceNo: U.s(r['Reference No.']),
      by: U.s(r['Entered By']), notes: U.s(r['Notes']), row: r._row
    };
  },

  // ---------- order receipts ----------
  /** every order with its money worked out */
  orders_: function () {
    var today = U.isoToday(), pays = AcctApi.payIndex_(), lines = Rows.group(Db.readAll('orderLines'), 'Order ID');
    var cust = {};
    Db.readCols('customers', ['Customer ID', 'Company/Brand Name']).forEach(function (c) { cust[U.s(c['Customer ID'])] = U.s(c['Company/Brand Name']); });
    return Db.readAll('orders').map(function (o) {
      var id = U.s(o['Order ID']), ls = lines[id] || [], calc = 0;
      ls.forEach(function (l) {
        var pcs = U.toNum(l['Pcs / Set']), sets = U.toNum(l['No. of set']), price = U.toNum(l['Offer Price']), g = U.frac(l['GST %']);
        if (!(pcs >= 1)) pcs = 1;
        if (!isNaN(sets) && !isNaN(price)) calc += pcs * sets * price * (1 + (isNaN(g) ? 0 : g));
      });
      var auto = U.toNum(o['Value incl. GST (auto)']), value = U.r2(!isNaN(auto) && auto > 0 ? auto : calc);
      var inv = U.toNum(o['Invoice Amount']), invoiced = !isNaN(inv) && inv > 0, status = U.s(o['Status']);
      var p = pays['Order|' + id] || { sum: 0, last: '', rows: [] };
      var basis = invoiced ? U.r2(inv) : value, received = p.sum, balance = U.r2(basis - received);
      var invDate = AcctApi.iso_(o['Invoice Date']), terms = U.s(o['Payment Terms']);
      var due = AcctApi.iso_(o['Due Date']) || (invoiced ? AcctApi.dueFrom_(terms, invDate) : '');
      var state;
      if (status === 'Cancelled') state = 'Cancelled';
      else if (!invoiced) state = 'To invoice';
      else if (balance <= 0.5) state = 'Paid';
      else state = due && due < today ? 'Overdue' : 'Awaiting payment';
      var stage = U.s(o['Stage (auto)']);
      return {
        id: id, no: U.s(o['Order No.']), date: AcctApi.iso_(o['Order Date']), customerId: U.s(o['Customer']),
        customer: U.s(o['Customer (auto)']) || cust[U.s(o['Customer'])] || U.s(o['Customer']), salesman: U.s(o['Salesman']), status: status, stage: stage,
        dispatched: status === 'Dispatched' || stage === 'Dispatched', terms: terms, lines: ls.length,
        value: value, invoiced: invoiced, invoiceAmount: invoiced ? U.r2(inv) : null, voucher: U.s(o['Tally Voucher No.']),
        invoiceDate: invDate, due: due, clearedOn: AcctApi.iso_(o['Payment Cleared On']),
        received: received, balance: balance, lastPaid: p.last, payments: p.rows.length, state: state,
        overdueDays: state === 'Overdue' ? Math.max(0, Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(due + 'T00:00:00Z')) / 86400000)) : 0,
        refundDue: status === 'Cancelled' && received > 0.5, row: o._row
      };
    });
  },

  /** args: { filter: 'To invoice' | 'To collect' | 'Paid' | 'All', search } */
  ordList: function (a) {
    var all = AcctApi.orders_(), f = U.s(a.filter) || 'To invoice', q = U.s(a.search), today = U.isoToday(), month = today.slice(0, 7);
    var counts = { toInvoice: 0, toCollect: 0, paid: 0 }, sum = { toInvoiceValue: 0, outstanding: 0, overdue: 0, overdueCount: 0, receivedMonth: 0 };
    all.forEach(function (o) {
      if (o.state === 'To invoice' && o.value > 0) { counts.toInvoice++; sum.toInvoiceValue += o.value; }
      else if (o.state === 'Awaiting payment' || o.state === 'Overdue') { counts.toCollect++; sum.outstanding += o.balance; }
      else if (o.state === 'Paid') counts.paid++;
      if (o.state === 'Overdue') { sum.overdue += o.balance; sum.overdueCount++; }
    });
    Db.readAll('payments').forEach(function (r) {
      if (U.s(r['Ref Type']) === 'Order' && U.s(r['Direction']) === 'Received' && AcctApi.iso_(r['Payment Date']).slice(0, 7) === month) sum.receivedMonth += AcctApi.num_(r['Amount']);
    });
    Object.keys(sum).forEach(function (k) { sum[k] = U.r2(sum[k]); });
    var rows = all.filter(function (o) {
      if (f === 'To invoice' && !(o.state === 'To invoice' && o.value > 0)) return false;
      if (f === 'To collect' && o.state !== 'Awaiting payment' && o.state !== 'Overdue') return false;
      if (f === 'Paid' && o.state !== 'Paid') return false;
      return !q || Rows.matches([o.no, o.customer, o.voucher, o.state, o.terms, o.stage].join(' '), q);
    });
    rows.sort(function (x, y) {
      if (f === 'To invoice') { if (x.dispatched !== y.dispatched) return x.dispatched ? -1 : 1; return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; }
      if (f === 'To collect') { if ((x.state === 'Overdue') !== (y.state === 'Overdue')) return x.state === 'Overdue' ? -1 : 1; var dx = x.due || '9999', dy = y.due || '9999'; return dx < dy ? -1 : dx > dy ? 1 : 0; }
      return x.no < y.no ? 1 : x.no > y.no ? -1 : 0;
    });
    return { shown: rows.length, rows: rows.slice(0, CONFIG.MAX_ROWS), counts: counts, sum: sum };
  },

  /** args: { id } - the order, its lines and its payments */
  ordGet: function (a) {
    var o = AcctApi.orders_().filter(function (x) { return x.id === U.s(a.id); })[0];
    if (!o) throw new Error('That order was not found.');
    var items = Items.map();
    var lines = Db.readAll('orderLines').filter(function (r) { return U.s(r['Order ID']) === o.id; }).map(function (r) {
      var code = U.s(r['Item_Code']), p = code ? items[code] : null, pcs = U.toNum(r['Pcs / Set']), sets = U.toNum(r['No. of set']), price = U.toNum(r['Offer Price']), g = U.frac(r['GST %']);
      if (!(pcs >= 1)) pcs = p ? p.pcs : 1;
      sets = isNaN(sets) ? 0 : sets; price = isNaN(price) ? 0 : price; g = isNaN(g) ? 0 : g;
      return { id: U.s(r['Line ID']), itemCode: code, name: p ? (p.name || code) : U.s(r['Description']), pcs: pcs, sets: sets, price: price, gst: g,
               amount: U.r2(pcs * sets * price * (1 + g)) };
    });
    var pays = Db.readAll('payments').filter(function (r) { return U.s(r['Ref Type']) === 'Order' && U.s(r['Ref ID']) === o.id; })
      .map(function (r) { return AcctApi.payOut_(r, o.no, o.customer); }).sort(function (x, y) { return x.row - y.row; });
    o.suggestedDue = AcctApi.dueFrom_(o.terms, o.invoiceDate || U.isoToday());
    o.lineList = lines; o.paymentList = pays;
    return o;
  },

  /**
   * Billing, after the invoice is made in Tally. args: { id, voucherNo, invoiceDate, invoiceAmount, dueDate? }
   * Sets Status to "Billing done" unless the order is already dispatched or cancelled.
   */
  ordBill: function (a) {
    var o = AcctApi.orders_().filter(function (x) { return x.id === U.s(a.id); })[0];
    if (!o) throw new Error('That order was not found.');
    if (o.status === 'Cancelled') throw new Error('This order is cancelled.');
    var voucher = U.s(a.voucherNo);
    if (!voucher) throw new Error('Enter the Tally voucher number.');
    var amount = AcctApi.money_(a.invoiceAmount, 'invoice amount'), invDate = AcctApi.date_(a.invoiceDate, 'invoice date');
    if (invDate > U.isoToday()) throw new Error('The invoice date cannot be in the future.');
    var due = AcctApi.date_(a.dueDate, 'due date', true);
    if (due && due < invDate) throw new Error('The due date cannot be before the invoice date.');
    var upd = { 'Tally Voucher No.': voucher, 'Invoice Date': Rows.serial(invDate), 'Invoice Amount': amount, 'Due Date': due ? Rows.serial(due) : '' };
    if (o.status !== 'Dispatched') upd['Status'] = 'Billing done';
    Db.update('orders', o.row, upd, { 'Tally Voucher No.': '@' });
    AcctApi.syncCleared_(o.id);
    return { id: o.id, balance: U.r2(amount - o.received) };
  },

  /** Keep "Payment Cleared On" right: the date of the last payment once the invoice is fully paid, blank otherwise. */
  syncCleared_: function (orderId) {
    var o = AcctApi.orders_().filter(function (x) { return x.id === orderId; })[0];
    if (!o) return;
    var want = o.invoiced && o.balance <= 0.5 && o.received > 0 ? o.lastPaid : '';
    if (want === o.clearedOn) return;
    Db.update('orders', o.row, { 'Payment Cleared On': want ? U.dateFromIso(want) : '' });
  },

  // ---------- purchase receipts (supplier bills) ----------
  bills_: function () {
    var today = U.isoToday(), pays = AcctApi.payIndex_(), sups = ProcApi.suppliers_();
    var allPl = Db.readAll('purchaseLines');
    var pos = Rows.by(Db.readAll('purchase'), 'Purchase ID'), pLines = Rows.by(allPl, 'Line ID'), poLines = Rows.group(allPl, 'Purchase ID');
    var gLines = Rows.group(Db.readAll('grnLines'), 'GRN ID');
    return Db.readAll('grn').map(function (g) {
      var id = U.s(g['GRN ID']), po = pos[U.s(g['Purchase ID'])], sid = U.s(g['Supplier']) || (po ? U.s(po['Supplier Company Name']) : '');
      var poValue = 0, recValue = 0, damaged = 0;
      (po ? (poLines[U.s(po['Purchase ID'])] || []) : []).forEach(function (l) {
        var pcs = U.toNum(l['Pcs / Set']), sets = U.toNum(l['No. of Set']), rate = U.toNum(l['Rate']), gs = U.frac(l['GST %']);
        if (!(pcs >= 1)) pcs = 1;
        if (!isNaN(sets) && !isNaN(rate)) poValue += pcs * sets * rate * (1 + (isNaN(gs) ? 0 : gs));
      });
      (gLines[id] || []).forEach(function (l) {
        var pl = pLines[U.s(l['Purchase Line ID'])], rec = U.toNum(l['Received No. of Sets']), per = U.toNum(l['Received pcs / set']), dm = U.toNum(l['Damaged Qty']);
        if (!(per >= 1)) per = U.toNum(l['Expected pcs / set']);
        if (!(per >= 1)) per = 1;
        if (!isNaN(dm)) damaged += dm;
        if (pl && !isNaN(rec)) {
          var rate = U.toNum(pl['Rate']), gs = U.frac(pl['GST %']);
          if (!isNaN(rate)) recValue += rec * per * rate * (1 + (isNaN(gs) ? 0 : gs));
        }
      });
      var bill = U.toNum(g['Bill Amount']), billed = !isNaN(bill) && bill > 0, p = pays['GRN|' + id] || { sum: 0, last: '', rows: [] };
      var received = U.s(g['Status']) === 'Received' || U.s(g['Received Date']) !== '';
      var paid = p.sum, balance = billed ? U.r2(bill - paid) : null, terms = po ? U.s(po['Payment Terms']) : '';
      var invDate = AcctApi.iso_(g['Invoice Date']), recDate = AcctApi.iso_(g['Received Date']);
      var due = billed ? AcctApi.dueFrom_(terms, invDate || recDate) : '';
      var state;
      if (!received && !billed) state = 'Not received';
      else if (!billed) state = 'To bill';
      else if (balance <= 0.5) state = 'Paid';
      else state = due && due < today ? 'Overdue' : 'To pay';
      return {
        id: id, no: U.s(g['GRN No']), purchaseId: U.s(g['Purchase ID']), poNo: po ? U.s(po['Purchase No']) : '', supplierId: sid,
        supplier: sups.by[sid] ? sups.by[sid].name : '', terms: terms, received: received, receivedDate: recDate,
        invoiceNo: U.s(g['Supplier Invoice No']), invoiceDate: invDate, billAmount: billed ? U.r2(bill) : null, voucher: U.s(g['Tally Purchase Voucher No.']),
        poValue: U.r2(poValue), recValue: U.r2(recValue), damaged: U.r4(damaged), paid: paid, balance: balance, due: due, lastPaid: p.last, payments: p.rows.length,
        state: state, overdueDays: state === 'Overdue' ? Math.max(0, Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(due + 'T00:00:00Z')) / 86400000)) : 0, row: g._row
      };
    });
  },

  /** args: { filter: 'To bill' | 'To pay' | 'Paid' | 'Not received' | 'All', search } */
  billList: function (a) {
    var all = AcctApi.bills_(), f = U.s(a.filter) || 'To bill', q = U.s(a.search), month = U.isoToday().slice(0, 7);
    var counts = { toBill: 0, toPay: 0, paid: 0, notReceived: 0 }, sum = { payable: 0, overdue: 0, overdueCount: 0, paidMonth: 0 };
    all.forEach(function (b) {
      if (b.state === 'To bill') counts.toBill++;
      else if (b.state === 'To pay' || b.state === 'Overdue') { counts.toPay++; sum.payable += b.balance; }
      else if (b.state === 'Paid') counts.paid++;
      else counts.notReceived++;
      if (b.state === 'Overdue') { sum.overdue += b.balance; sum.overdueCount++; }
    });
    Db.readAll('payments').forEach(function (r) {
      if (U.s(r['Ref Type']) === 'GRN' && U.s(r['Direction']) === 'Paid' && AcctApi.iso_(r['Payment Date']).slice(0, 7) === month) sum.paidMonth += AcctApi.num_(r['Amount']);
    });
    Object.keys(sum).forEach(function (k) { sum[k] = U.r2(sum[k]); });
    var rows = all.filter(function (b) {
      if (f === 'To bill' && b.state !== 'To bill') return false;
      if (f === 'To pay' && b.state !== 'To pay' && b.state !== 'Overdue') return false;
      if (f === 'Paid' && b.state !== 'Paid') return false;
      if (f === 'Not received' && b.state !== 'Not received') return false;
      return !q || Rows.matches([b.no, b.poNo, b.supplier, b.invoiceNo, b.voucher, b.state].join(' '), q);
    });
    rows.sort(function (x, y) {
      if (f === 'To pay') { if ((x.state === 'Overdue') !== (y.state === 'Overdue')) return x.state === 'Overdue' ? -1 : 1; var dx = x.due || '9999', dy = y.due || '9999'; return dx < dy ? -1 : dx > dy ? 1 : 0; }
      return x.no < y.no ? 1 : x.no > y.no ? -1 : 0;
    });
    return { shown: rows.length, rows: rows.slice(0, CONFIG.MAX_ROWS), counts: counts, sum: sum };
  },

  /** args: { id } - one delivery with its lines and payments */
  billGet: function (a) {
    var b = AcctApi.bills_().filter(function (x) { return x.id === U.s(a.id); })[0];
    if (!b) throw new Error('That delivery was not found.');
    var items = Items.map(), pLines = Rows.by(Db.readAll('purchaseLines'), 'Line ID');
    b.lineList = Db.readAll('grnLines').filter(function (r) { return U.s(r['GRN ID']) === b.id; }).map(function (r) {
      var code = U.s(r['Item Code']), p = code ? items[code] : null, pl = pLines[U.s(r['Purchase Line ID'])];
      var per = U.toNum(r['Received pcs / set']); if (!(per >= 1)) per = U.toNum(r['Expected pcs / set']); if (!(per >= 1)) per = p ? p.pcs : 1;
      var rec = U.toNum(r['Received No. of Sets']), exp = U.toNum(r['Expected No. of Sets']), rate = pl ? U.toNum(pl['Rate']) : NaN, gs = pl ? U.frac(pl['GST %']) : NaN;
      rec = isNaN(rec) ? null : rec; rate = isNaN(rate) ? 0 : rate; gs = isNaN(gs) ? 0 : gs;
      return { id: U.s(r['Line ID']), itemCode: code, name: p ? (p.name || code) : U.s(r['Description']), per: per, expSets: isNaN(exp) ? 0 : exp, recSets: rec,
               damaged: U.r4(AcctApi.num_(r['Damaged Qty'])), rate: rate, gst: gs, amount: rec === null ? 0 : U.r2(rec * per * rate * (1 + gs)) };
    });
    b.paymentList = Db.readAll('payments').filter(function (r) { return U.s(r['Ref Type']) === 'GRN' && U.s(r['Ref ID']) === b.id; })
      .map(function (r) { return AcctApi.payOut_(r, b.no, b.supplier); }).sort(function (x, y) { return x.row - y.row; });
    return b;
  },

  /** The supplier's bill. args: { id, billAmount, voucherNo, invoiceNo?, invoiceDate? } */
  billSave: function (a) {
    var b = AcctApi.bills_().filter(function (x) { return x.id === U.s(a.id); })[0];
    if (!b) throw new Error('That delivery was not found.');
    var amount = AcctApi.money_(a.billAmount, 'bill amount'), voucher = U.s(a.voucherNo);
    if (!voucher) throw new Error('Enter the Tally purchase voucher number.');
    var upd = { 'Bill Amount': amount, 'Tally Purchase Voucher No.': voucher };
    if (U.s(a.invoiceNo)) upd['Supplier Invoice No'] = U.s(a.invoiceNo);
    if (U.s(a.invoiceDate)) upd['Invoice Date'] = U.dateFromIso(AcctApi.date_(a.invoiceDate, 'supplier invoice date'));
    Db.update('grn', b.row, upd, { 'Tally Purchase Voucher No.': '@' });
    return { id: b.id, balance: U.r2(amount - b.paid) };
  },

  // ---------- payments ----------
  /**
   * Record money. args: { kind: 'Order' | 'GRN', refId, date, amount, mode, referenceNo, notes, refund?, confirmOver? }
   * An order receipt is "Received", a purchase payment is "Paid"; refund = the other way round.
   */
  payAdd: function (a, user) {
    var kind = U.s(a.kind), refId = U.s(a.refId), ref, label;
    if (kind === 'Order') {
      ref = AcctApi.orders_().filter(function (x) { return x.id === refId; })[0];
      if (!ref) throw new Error('That order was not found.');
      label = ref.no;
    } else if (kind === 'GRN') {
      ref = AcctApi.bills_().filter(function (x) { return x.id === refId; })[0];
      if (!ref) throw new Error('That delivery was not found.');
      label = ref.no;
    } else throw new Error('A payment must be for an order or a delivery.');
    var refund = a.refund === true, natural = kind === 'Order' ? 'Received' : 'Paid', dir = refund ? (natural === 'Received' ? 'Paid' : 'Received') : natural;
    var amount = AcctApi.money_(a.amount, 'amount'), date = AcctApi.date_(a.date, 'payment date'), mode = U.s(a.mode), refNo = U.s(a.referenceNo);
    if (date > U.isoToday()) throw new Error('The payment date cannot be in the future.');
    if (CONFIG.PAYMENT_MODES.indexOf(mode) < 0) throw new Error('Pick how it was paid: ' + CONFIG.PAYMENT_MODES.join(', ') + '.');
    if (kind === 'Order' && ref.status === 'Cancelled' && !refund) throw new Error(label + ' is cancelled: only a refund can be recorded.');
    var basis = kind === 'Order' ? (ref.invoiced ? ref.invoiceAmount : ref.value) : ref.billAmount;
    if (!refund && basis && amount > U.r2(basis - (kind === 'Order' ? ref.received : ref.paid)) + 0.5 && a.confirmOver !== true) {
      throw new Error('That is more than the balance (Rs ' + U.inr(Math.max(0, basis - (kind === 'Order' ? ref.received : ref.paid)), 2) + ') on ' + label + '.');
    }
    var rows = Db.readAll('payments');
    if (refNo) rows.forEach(function (r) {
      if (U.s(r['Ref Type']) === kind && U.s(r['Ref ID']) === refId && U.s(r['Reference No.']) === refNo && Math.abs(AcctApi.num_(r['Amount']) - amount) < 0.005 && AcctApi.iso_(r['Payment Date']) === date)
        throw new Error('This payment (same reference, amount and date) is already recorded on ' + label + '.');
    });
    var id = U.newId(U.idSet(rows, 'Payment ID'));
    Db.append('payments', [{
      'Payment ID': id, 'Payment Date': Rows.serial(date), 'Direction': dir, 'Ref Type': kind, 'Ref ID': refId, 'Amount': amount,
      'Mode': mode, 'Reference No.': refNo, 'Entered By': user.email, 'Notes': U.s(a.notes)
    }], { 'Reference No.': '@' });
    if (kind === 'Order') AcctApi.syncCleared_(refId);
    return { id: id };
  },

  /** args: { direction: 'All' | 'Received' | 'Paid', from?, to?, search } */
  payList: function (a) {
    var f = U.s(a.direction) || 'All', q = U.s(a.search), from = AcctApi.date_(a.from, 'from date', true), to = AcctApi.date_(a.to, 'to date', true);
    var ords = {}, grns = {};
    AcctApi.orders_().forEach(function (o) { ords[o.id] = o; });
    AcctApi.bills_().forEach(function (b) { grns[b.id] = b; });
    var rec = 0, paid = 0, rows = [];
    Db.readAll('payments').forEach(function (r) {
      var type = U.s(r['Ref Type']), id = U.s(r['Ref ID']), ref = type === 'Order' ? ords[id] : grns[id];
      var p = AcctApi.payOut_(r, ref ? ref.no : '', ref ? (type === 'Order' ? ref.customer : ref.supplier) : '');
      if (f !== 'All' && p.direction !== f) return;
      if (from && p.date < from) return;
      if (to && p.date > to) return;
      if (q && !Rows.matches([p.refNo, p.party, p.mode, p.referenceNo, p.notes, p.by, p.id].join(' '), q)) return;
      if (p.direction === 'Received') rec += p.amount; else if (p.direction === 'Paid') paid += p.amount;
      rows.push(p);
    });
    rows.sort(function (x, y) { return x.date < y.date ? 1 : x.date > y.date ? -1 : y.row - x.row; });
    return { shown: rows.length, rows: rows.slice(0, CONFIG.MAX_ROWS), totals: { received: U.r2(rec), paid: U.r2(paid), net: U.r2(rec - paid) }, modes: CONFIG.PAYMENT_MODES };
  },

  /** Correct a payment in place. args: { id, date, amount, mode, referenceNo, notes } (what it was for cannot change) */
  paySave: function (a) {
    var r = Rows.by(Db.readAll('payments'), 'Payment ID')[U.s(a.id)];
    if (!r) throw new Error('That payment was not found.');
    var amount = AcctApi.money_(a.amount, 'amount'), date = AcctApi.date_(a.date, 'payment date'), mode = U.s(a.mode);
    if (date > U.isoToday()) throw new Error('The payment date cannot be in the future.');
    if (CONFIG.PAYMENT_MODES.indexOf(mode) < 0) throw new Error('Pick how it was paid: ' + CONFIG.PAYMENT_MODES.join(', ') + '.');
    Db.update('payments', r._row, { 'Payment Date': Rows.serial(date), 'Amount': amount, 'Mode': mode, 'Reference No.': U.s(a.referenceNo), 'Notes': U.s(a.notes) }, { 'Reference No.': '@' });
    if (U.s(r['Ref Type']) === 'Order') AcctApi.syncCleared_(U.s(r['Ref ID']));
    return { id: U.s(a.id) };
  },

  /** Admin only. args: { id } */
  payDelete: function (a) {
    var r = Rows.by(Db.readAll('payments'), 'Payment ID')[U.s(a.id)];
    if (!r) throw new Error('That payment was not found.');
    var type = U.s(r['Ref Type']), ref = U.s(r['Ref ID']);
    Rows.wipe('payments', r._row);
    if (type === 'Order') AcctApi.syncCleared_(ref);
    return { id: U.s(a.id) };
  },

  // ---------- numbers for the tab badges ----------
  counts: function () {
    var today = U.isoToday(), toInvoice = 0, overdue = 0, toBill = 0, payOverdue = 0;
    AcctApi.orders_().forEach(function (o) { if (o.state === 'To invoice' && o.value > 0) toInvoice++; if (o.state === 'Overdue') overdue++; });
    AcctApi.bills_().forEach(function (b) { if (b.state === 'To bill') toBill++; if (b.state === 'Overdue') payOverdue++; });
    var audit = 0;
    Db.readAll('audit').forEach(function (r) { if ((U.s(r['Status']) || 'Pending') === 'Pending') audit++; });
    return { toInvoice: toInvoice, overdue: overdue, toBill: toBill, payOverdue: payOverdue, audit: audit, today: today };
  }
};
