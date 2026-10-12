/** OrdersApi.gs - backend for the Orders board: convert a quote to an order, list and cancel orders. */

var OrdersApi = {
  /** Open stage names that mean the order has left the building (or never will). */
  isDone_: function (stage, status) { return stage === 'Dispatched' || status === 'Dispatched'; },
  isCancelled_: function (stage, status) { return stage === 'Cancelled' || status === 'Cancelled'; },

  lineOut_: function (r) {
    var pcs = U.toNum(r['Pcs / Set']); if (!(pcs >= 1)) pcs = 1;
    var sets = U.toNum(r['No. of set']); if (isNaN(sets)) sets = 0;
    var offer = U.toNum(r['Offer Price']); if (isNaN(offer)) offer = 0;
    var g = U.frac(r['GST %']); if (isNaN(g)) g = 0;
    var c = QuoteApi.calc_({ pcs: pcs, sets: sets, offer: offer, gst: g });
    return {
      id: U.s(r['Line ID']), orderId: U.s(r['Order ID']), code: U.s(r['Item_Code']), desc: U.s(r['Description']),
      pcs: pcs, sets: sets, offer: offer, gst: U.r2(g * 100), amount: c.amount, taxable: c.taxable, gstAmt: c.gstAmt,
      pickFrom: U.s(r['Pick From']), picked: r['Picked'] === true, packed: r['Packed'] === true, dispatched: r['Dispatched'] === true
    };
  },

  /** args: { filter: Active|All|Dispatched|Cancelled, search } */
  list: function (a) {
    var filter = U.s(a.filter) || 'Active', s = U.low(a.search);
    var cust = {}, sums = {};
    Db.readAll('customers').forEach(function (r) { cust[U.s(r['Customer ID'])] = U.s(r['Company/Brand Name']); });
    Db.readAll('orderLines').forEach(function (r) {
      var l = OrdersApi.lineOut_(r);
      if (!sums[l.orderId]) sums[l.orderId] = { n: 0, total: 0 };
      sums[l.orderId].n += 1; sums[l.orderId].total += l.amount;
    });
    var all = Db.readAll('orders').map(function (r) {
      var id = U.s(r['Order ID']), status = U.s(r['Status']) || 'Order received', sm = sums[id] || { n: 0, total: 0 };
      var stage = U.s(r['Stage (auto)']) || status;
      return {
        id: id, row: r._row, no: U.s(r['Order No.']), date: U.iso(r['Order Date']),
        customer: U.s(r['Customer (auto)']) || cust[U.s(r['Customer'])] || U.s(r['Customer']),
        lines: sm.n, total: U.r2(sm.total), billed: U.s(r['Tally Voucher No.']) !== '', voucher: U.s(r['Tally Voucher No.']),
        delivery: U.s(r['Delivery Terms']), payment: U.s(r['Payment Terms']), status: status, stage: stage,
        payStatus: U.s(r['Pay Status (auto)']), dispatchDate: U.iso(r['Dispatch Date']), pdf: QuoteApi.pdfUrl_(r['Proforma Invoice PDF'])
      };
    });
    var rows = all.filter(function (o) {
      var done = OrdersApi.isDone_(o.stage, o.status), cancelled = OrdersApi.isCancelled_(o.stage, o.status);
      if (filter === 'Active' && (done || cancelled)) return false;
      if (filter === 'Dispatched' && !done) return false;
      if (filter === 'Cancelled' && !cancelled) return false;
      if (s && (o.no + ' ' + o.customer).toLowerCase().indexOf(s) < 0) return false;
      return true;
    });
    rows.sort(function (x, y) { return y.date > x.date ? 1 : y.date < x.date ? -1 : y.row - x.row; });
    return { total: all.length, shown: rows.length, rows: rows.slice(0, CONFIG.MAX_ROWS) };
  },

  /** args: { orderId } - header + lines, for the "View" window. */
  get: function (a) {
    var o = Db.find(Db.readAll('orders'), 'Order ID', a.orderId);
    if (!o) throw new Error('Order not found.');
    var id = U.s(a.orderId);
    var lines = Db.readAll('orderLines').filter(function (r) { return U.s(r['Order ID']) === id; }).map(OrdersApi.lineOut_);
    var t = QuoteApi.totals_(lines);
    return { id: id, no: U.s(o['Order No.']), date: U.iso(o['Order Date']), lines: lines, taxable: t.taxable, gstTotal: t.gst, total: t.total };
  },

  /**
   * args: { quoteId }. Quote ID becomes the Order ID; quote lines are copied (not moved).
   * Safe to press twice: when the order already exists nothing is written and { already: true, orderNo } comes back,
   * so the screen can simply show that order instead of an error.
   */
  convert: function (a, user) {
    var quoteId = U.s(a.quoteId);
    var q = Db.find(Db.readAll('quotations'), 'Quote ID', quoteId);
    if (!q) throw new Error('Quotation not found.');
    var done = Db.find(Db.readAll('orders'), 'Order ID', quoteId);
    if (done) {
      return { already: true, orderNo: U.s(done['Order No.']) || U.s(q['Quote No']), customerCreated: false, warnings: [],
               pdfUrl: QuoteApi.pdfUrl_(done['Proforma Invoice PDF']), pdfError: '', pdfNote: '' };
    }
    if (QuoteApi.isLost_(q)) throw new Error('This quotation is marked as lost. Reopen it first (Orders tab > Quotes waiting for a decision > Lost).');
    var type = U.s(q['Quote For']), party = Parties.find(type, q['Customer / Lead ID']);
    if (!party) throw new Error('This quotation has no valid customer or lead. Please make a new quotation.');
    var qLines = Db.readAll('quoteLines').filter(function (r) { return U.s(r['Quote ID']) === quoteId; });
    if (!qLines.length) throw new Error('This quotation has no lines. Please make a new quotation.');

    // 1. customer (a lead becomes a customer the first time it orders)
    var custId = '', createdCustomer = false, customers = Db.readAll('customers');
    if (type === 'Customer') {
      custId = party.id;
    } else {
      var existing = party.customerId && Db.find(customers, 'Customer ID', party.customerId);
      if (existing) custId = party.customerId;
      else {
        custId = U.newId(U.idSet(customers, 'Customer ID', U.idSet(Db.readAll('leads'), 'Lead ID')));
        Db.append('customers', [{
          'Customer ID': custId, 'Company/Brand Name': party.nameRaw, 'Customer Name': party.contact,
          'WhatsApp No.': party.phone, 'City': party.city, 'Salesman': user.email
        }], { 'WhatsApp No.': '@' });
        Db.update('leads', party.row._row, { 'Customer ID': custId });
        createdCustomer = true;
      }
    }

    // 2. order header, 3. order lines (undo the header if the lines fail)
    var oRow = Db.append('orders', [{
      'Order ID': quoteId, 'Order No.': U.s(q['Quote No']), 'Order Date': U.today(), 'Customer': custId, 'Salesman': user.email,
      'Status': 'Order received', 'Payment Terms': U.s(q['Payment Terms']), 'Delivery Terms': U.s(q['Delivery Terms']),
      'Proforma Invoice PDF': U.s(q['Quote PDF']), 'Created At': new Date()
    }], { 'Created At': 'dd/mm/yyyy hh:mm:ss' })[0];
    try {
      var taken = U.idSet(Db.readAll('orderLines'), 'Line ID');
      Db.append('orderLines', qLines.map(function (r) {
        var l = QuoteApi.lineOut_(r);
        return {
          'Line ID': U.newId(taken), 'Req ID': l.reqId, 'Order ID': quoteId, 'Item_Code': r['Item_Code'], 'Description': l.desc,
          'Pcs / Set': l.pcs, 'No. of set': l.sets, 'Offer Price': l.offer, 'GST %': l.gst / 100
        };
      }), { 'GST %': '0.00%' });
    } catch (e) {
      Db.clear('orders', oRow, ['Order ID', 'Order No.', 'Order Date', 'Customer', 'Salesman', 'Status', 'Payment Terms',
        'Delivery Terms', 'Proforma Invoice PDF', 'Created At']);
      throw e;
    }

    // From here the order exists, so nothing below may fail the call (a retry would only say "already converted").
    var warnings = [];
    // 4. the lead is now business done
    if (type === 'Lead') {
      try { Db.update('leads', party.row._row, { 'Lead Status': 'Business Done' }); }
      catch (e4) { warnings.push('The order was created, but the lead could not be set to Business Done (' + String(e4 && e4.message ? e4.message : e4) + '). Change it in the Leads tab.'); }
    }
    try {
      var cust = Db.find(Db.readAll('customers'), 'Customer ID', custId);
      if (cust && (!U.s(cust['GSTIN']) || !U.s(cust['Address']))) warnings.push('GSTIN or address is missing for ' + party.name + ' - fill it in the Customers tab before billing.');
    } catch (e5) { /* only a reminder */ }

    // 5. the sales order PDF (replaces the quotation link in "Proforma Invoice PDF"). A failure never undoes the order.
    var out = { orderNo: U.s(q['Quote No']), customerCreated: createdCustomer, warnings: warnings, pdfUrl: '', pdfError: '', pdfNote: '' };
    try { out.pdfUrl = OrdersApi.makePdf_(quoteId, oRow); out.pdfNote = PdfApi.note; }
    catch (e2) {
      out.pdfUrl = QuoteApi.pdfUrl_(q['Quote PDF']);
      out.pdfError = String(e2 && e2.message ? e2.message : e2);
    }
    return out;
  },

  /** Make the sales order PDF and store its link in the order's "Proforma Invoice PDF" cell. */
  makePdf_: function (orderId, rowNum) {
    var o = Db.find(Db.readAll('orders'), 'Order ID', orderId);
    if (!o) throw new Error('Order not found.');
    var url = PdfApi.make(QuoteApi.docModel_(orderId, true));
    Db.update('orders', rowNum || o._row, { 'Proforma Invoice PDF': url });
    return url;
  },
  /** args: { orderId } - (re)make the sales order PDF. */
  pdf: function (a) {
    var o = Db.find(Db.readAll('orders'), 'Order ID', a.orderId);
    if (!o) throw new Error('Order not found.');
    var url = OrdersApi.makePdf_(U.s(a.orderId), o._row);
    return { url: url, note: PdfApi.note };
  },

  /** args: { orderId } */
  cancel: function (a) {
    var o = Db.find(Db.readAll('orders'), 'Order ID', a.orderId);
    if (!o) throw new Error('Order not found.');
    var status = U.s(o['Status']), stage = U.s(o['Stage (auto)']);
    if (OrdersApi.isCancelled_(stage, status)) throw new Error('This order is already cancelled.');
    if (OrdersApi.isDone_(stage, status) || stage === 'Part dispatched') throw new Error('Goods have already been dispatched, so this order cannot be cancelled here.');
    if (U.s(o['Tally Voucher No.'])) throw new Error('This order is already billed. Ask Accounts to cancel it.');
    Db.update('orders', o._row, { 'Status': 'Cancelled' });
    return { orderNo: U.s(o['Order No.']) };
  }
};
