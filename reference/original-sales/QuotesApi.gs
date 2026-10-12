/** QuotesApi.gs - backend for the Make Quote board, and for the quote list (convert / lost) and New order form on the Orders board. */

var QuoteApi = {
  // ---------- numbering ----------
  nextNo: function () {
    var max = 0, re = /(\d+)\s*$/;
    var scan = function (rows, h) {
      rows.forEach(function (r) {
        var v = U.s(r[h]), m;
        if (v.indexOf(CONFIG.QUOTE_PREFIX) === 0 && (m = re.exec(v))) max = Math.max(max, parseInt(m[1], 10));
      });
    };
    scan(Db.readAll('quotations'), 'Quote No');
    scan(Db.readAll('orders'), 'Order No.');
    var n = String(max + 1);
    while (n.length < 4) n = '0' + n;
    return CONFIG.QUOTE_PREFIX + n;
  },

  // ---------- maths (prices are Rs per piece, GST-exclusive; gst is a fraction here) ----------
  calc_: function (l) {
    var taxable = U.r2(l.pcs * l.sets * l.offer), gst = U.r2(taxable * l.gst);
    return { taxable: taxable, gstAmt: gst, amount: U.r2(taxable + gst) };
  },
  totals_: function (lines) {
    var t = 0, g = 0;
    lines.forEach(function (l) { t += l.taxable; g += l.gstAmt; });
    return { taxable: U.r2(t), gst: U.r2(g), total: U.r2(t + g) };
  },
  lineOut_: function (r) {
    var pcs = U.toNum(r['Qty/Set']); if (!(pcs >= 1)) pcs = 1;
    var sets = U.toNum(r['Set']); if (isNaN(sets)) sets = 0;
    var offer = U.toNum(r['Offer Price']); if (isNaN(offer)) offer = 0;
    var g = U.frac(r['GST %']); if (isNaN(g)) g = 0;
    var list = U.toNum(r['List Price']), disc = U.frac(r['Discount %']);
    var c = QuoteApi.calc_({ pcs: pcs, sets: sets, offer: offer, gst: g });
    return {
      id: U.s(r['Line ID']), quoteId: U.s(r['Quote ID']), code: U.s(r['Item_Code']), desc: U.s(r['Description']),
      pcs: pcs, sets: sets, list: isNaN(list) ? '' : list, disc: isNaN(disc) ? 0 : U.r2(disc * 100),
      offer: offer, gst: U.r2(g * 100), reqId: U.s(r['Req ID']), photo: U.s(r['Photo Link']),
      taxable: c.taxable, gstAmt: c.gstAmt, amount: c.amount
    };
  },
  linesOf_: function (quoteId) {
    return Db.readAll('quoteLines').filter(function (r) { return U.s(r['Quote ID']) === quoteId; }).map(QuoteApi.lineOut_);
  },
  pdfUrl_: function (v) { v = U.s(v); return /^https?:\/\//i.test(v) ? v : ''; },

  /** Full quote (header + lines + totals) from a Quotations row. */
  build_: function (q, lines) {
    var type = U.s(q['Quote For']), pid = U.s(q['Customer / Lead ID']);
    var party = type && pid ? Parties.find(type, pid) : null;
    var t = QuoteApi.totals_(lines);
    return {
      id: U.s(q['Quote ID']), no: U.s(q['Quote No']), date: U.iso(q['Quote Date']), validUntil: U.iso(q['Valid Until']),
      forType: type, partyId: pid,
      party: party ? party.name : (U.s(q['Party (auto)']) || U.s(q['Customer / Lead Name'])),
      partyInfo: party ? { contact: party.contact, phone: party.phone, city: party.city, gstin: party.gstin, address: party.address } : {},
      payment: U.s(q['Payment Terms']), delivery: U.s(q['Delivery Terms']), salesman: U.s(q['Salesman']),
      pdf: QuoteApi.pdfUrl_(q['Quote PDF']), lines: lines, taxable: t.taxable, gstTotal: t.gst, total: t.total,
      lostOn: U.iso(q['Lost On']), lostReason: U.s(q['Lost Reason'])
    };
  },
  isLost_: function (q) { return U.s(q['Lost On']) !== '' || U.s(q['Lost Reason']) !== ''; },

  // ---------- board actions ----------
  /** Open requirements of one customer/lead that have not been quoted yet. args: { forType, partyId } */
  openReqs: function (a) {
    var type = U.s(a.forType), party = Parties.find(type, a.partyId);
    if (!party) throw new Error('Pick the ' + (type ? type.toLowerCase() : 'customer or lead') + ' first.');
    return Db.readAll('requirements').filter(function (r) {
      if (ReqApi.statusOf_(r) === 'Denied' || U.s(r['SO ID'])) return false;     // denied by the purchase manager, or already quoted
      var rid = U.s(r['Customer / Lead ID']);
      if (rid) return rid === party.id;
      return U.s(r['Req for']) === type && U.low(r['Customer / Lead Name']) === U.low(party.name);
    }).map(ReqApi.out_).map(function (r) {
      return { reqId: r.id, itemCode: r.itemCode, itemDesc: r.itemDesc, item: r.item, sets: r.sets, needBy: r.needBy, notes: r.notes };
    });
  },

  normLine_: function (l, i) {
    var n = 'Line ' + (i + 1) + ': ';
    var code = U.s(l.itemCode), desc = U.s(l.desc), raw = '';
    if (code) {
      raw = Catalog.rawCode(code);
      if (raw === null) throw new Error(n + 'item code ' + code + ' is not in Products.');
      if (!desc) desc = Catalog.name(code);
    }
    if (!desc) throw new Error(n + 'pick an item.');
    var pcs = U.toNum(l.pcs); if (!(pcs >= 1)) pcs = 1;
    var sets = U.toNum(l.sets);
    if (!(sets > 0)) throw new Error(n + 'enter the quantity (pieces or sets).');
    var list = U.toNum(l.list); if (!(list >= 0)) list = NaN;
    var disc = U.toNum(l.disc); if (isNaN(disc)) disc = 0;
    if (disc < 0 || disc > 100) throw new Error(n + 'discount must be between 0 and 100.');
    var offer = U.toNum(l.offer);
    if (!(offer > 0)) {
      if (list > 0) offer = U.r4(list * (1 - disc / 100));
      else throw new Error(n + 'enter a price.');
    }
    var gst = U.toNum(l.gst);
    if (isNaN(gst) || gst < 0 || gst > 100) throw new Error(n + 'enter GST % (0 if none).');
    var photo = U.s(l.photo);
    if (photo && !Photos.parse_(photo)) throw new Error(n + 'the picture link is not a Google Drive link.');
    var line = { code: code, raw: raw, desc: desc, pcs: pcs, sets: sets, list: list, disc: disc, offer: U.r4(offer), gst: gst / 100, reqId: U.s(l.reqId), photo: photo };
    var c = QuoteApi.calc_(line);
    line.taxable = c.taxable; line.gstAmt = c.gstAmt; line.amount = c.amount;
    return line;
  },

  /**
   * args: { forType, partyId, validUntil, paymentTerms, deliveryTerms,
   *         lines: [{ itemCode, desc, pcs, sets, list, disc, offer, gst, reqId, photo }], skipPdf }  (disc and gst in percent)
   * photo = Drive link of a picture uploaded for that line (the product's own Photo_link is used when this is blank).
   * skipPdf is used by direct orders: only the sales order PDF is made, not a quotation PDF.
   */
  create: function (a, user) {
    var type = U.s(a.forType);
    if (type !== 'Customer' && type !== 'Lead') throw new Error('Choose Customer or Lead.');
    var party = Parties.find(type, a.partyId);
    if (!party) throw new Error('Pick the ' + type.toLowerCase() + ' from the list.');
    var today = U.isoToday(), validIso = U.s(a.validUntil) || U.addDaysIso(today, CONFIG.QUOTE_VALID_DAYS);
    var valid = U.dateFromIso(validIso);
    if (!valid) throw new Error('"Valid until" is not a valid date.');
    if (validIso < today) throw new Error('"Valid until" cannot be in the past.');
    var payment = U.s(a.paymentTerms), delivery = U.s(a.deliveryTerms);
    var input = a.lines || [];
    if (!input.length) throw new Error('Add at least one line.');
    if (input.length > 60) throw new Error('Too many lines (max 60).');
    var lines = input.map(QuoteApi.normLine_);

    var quotes = Db.readAll('quotations');
    var taken = U.idSet(Db.readAll('orders'), 'Order ID', U.idSet(quotes, 'Quote ID'));
    var quoteId = U.newId(taken), quoteNo = QuoteApi.nextNo();
    var lineTaken = U.idSet(Db.readAll('quoteLines'), 'Line ID');
    var reqs = Db.readAll('requirements'), now = new Date();
    var photoCol = !!Db.meta('quoteLines').cols['Photo Link'];     // older copies of the sheet may not have the column yet

    var qRow = Db.append('quotations', [{
      'Quote ID': quoteId, 'Quote No': quoteNo, 'Quote Date': U.today(), 'Salesman': user.email, 'Quote For': type,
      'Customer / Lead ID': party.id, 'Customer / Lead Name': party.nameRaw, 'Valid Until': valid,
      'Payment Terms': payment, 'Delivery Terms': delivery, 'Created_At': now
    }], { 'Created_At': 'dd/mm/yyyy hh:mm:ss' })[0];

    try {
      Db.append('quoteLines', lines.map(function (l) {
        var row = {
          'Line ID': U.newId(lineTaken), 'Quote ID': quoteId, 'Item_Code': l.raw, 'Description': l.desc,
          'Qty/Set': l.pcs, 'Set': l.sets, 'List Price': isNaN(l.list) ? '' : l.list, 'Discount %': l.disc / 100,
          'Offer Price': l.offer, 'GST %': l.gst, 'Req ID': l.reqId
        };
        if (photoCol && l.photo) row['Photo Link'] = l.photo;
        return row;
      }), { 'Discount %': '0.00%', 'GST %': '0.00%' });
    } catch (e) {
      Db.clear('quotations', qRow, ['Quote ID', 'Quote No', 'Quote Date', 'Salesman', 'Quote For', 'Customer / Lead ID',
        'Customer / Lead Name', 'Valid Until', 'Payment Terms', 'Delivery Terms', 'Created_At']);
      throw e;
    }

    // link the requirements that went into this quote
    lines.forEach(function (l) {
      if (!l.reqId) return;
      var r = Db.find(reqs, 'Req ID', l.reqId);
      if (r && !U.s(r['SO ID'])) { Db.update('requirements', r._row, { 'SO ID': quoteId }); r['SO ID'] = quoteId; }
    });
    // a lead that gets a quote moves on from Inquiry / Sampling
    if (type === 'Lead' && ['', 'Inquiry', 'Sampling'].indexOf(party.status) >= 0) {
      Db.update('leads', party.row._row, { 'Lead Status': 'Quotation' });
    }

    var t = QuoteApi.totals_(lines), out = { quoteId: quoteId, quoteNo: quoteNo, taxable: t.taxable, gst: t.gst, total: t.total, pdfUrl: '', pdfError: '', pdfNote: '' };
    if (!a.skipPdf) {
      try { out.pdfUrl = QuoteApi.makePdf_(quoteId, qRow); out.pdfNote = PdfApi.note; }
      catch (e2) { out.pdfError = String(e2 && e2.message ? e2.message : e2); }
    }
    return out;
  },

  /**
   * Direct order (customer said yes straight away): same inputs as create(). Saves the document and
   * turns it into an order in one step; the sales order PDF is made by the conversion.
   * The number comes from the same AE/SO series.
   */
  createOrder: function (a, user) {
    var args = {};
    Object.keys(a || {}).forEach(function (k) { args[k] = a[k]; });
    args.skipPdf = true;
    var out = QuoteApi.create(args, user), o;
    try { o = OrdersApi.convert({ quoteId: out.quoteId }, user); }
    catch (e) {
      throw new Error('Saved as quotation ' + out.quoteNo + ', but it could not be turned into an order: ' + e.message +
        ' You can convert it from the Orders tab.');
    }
    out.orderNo = o.orderNo; out.customerCreated = o.customerCreated; out.warnings = o.warnings;
    out.pdfUrl = o.pdfUrl; out.pdfError = o.pdfError; out.pdfNote = o.pdfNote;
    return out;
  },

  // ---------- PDF ----------
  /**
   * Everything the PDF prints. asOrder = the sales order (order date, customer record and terms of the order row),
   * otherwise the quotation. Prices and quantities always come from the quotation lines, which the order was copied from.
   * Quantity is printed in pieces (price is per piece); MRP is the list price and Disc % is worked out from the offer price.
   * photoLink (quotation only) = the picture saved on the quote line, else the product's Photo_link.
   */
  docModel_: function (quoteId, asOrder) {
    var q = Db.find(Db.readAll('quotations'), 'Quote ID', quoteId);
    if (!q) throw new Error('Quotation not found.');
    var lines = QuoteApi.linesOf_(quoteId);
    if (!lines.length) throw new Error('This quotation has no lines.');
    var type = U.s(q['Quote For']), party = type ? Parties.find(type, q['Customer / Lead ID']) : null;
    var date = U.iso(q['Quote Date']), by = U.s(q['Salesman']), payment = U.s(q['Payment Terms']), delivery = U.s(q['Delivery Terms']);
    if (asOrder) {
      var o = Db.find(Db.readAll('orders'), 'Order ID', quoteId);
      if (!o) throw new Error('Order not found.');
      date = U.iso(o['Order Date']) || date;
      by = U.s(o['Salesman']) || by;
      payment = U.s(o['Payment Terms']);
      delivery = U.s(o['Delivery Terms']);
      party = Parties.find('Customer', o['Customer']) || party;
    }
    var name = party ? party.name : (U.s(q['Party (auto)']) || U.s(q['Customer / Lead Name']));
    var prep = by;
    Db.readAll('users').forEach(function (r) { if (U.low(r['Email']) === U.low(by) && U.s(r['Name'])) prep = U.s(r['Name']); });

    var mrpTotal = 0, pics = asOrder ? {} : Catalog.photoLinks();   // sales orders carry no photos
    var outLines = lines.map(function (l) {
      var qty = U.r4(l.pcs * l.sets);
      var mrp = l.list > 0 ? l.list : l.offer;
      if (l.offer > mrp) mrp = l.offer;
      var amt = U.r2(qty * mrp);
      mrpTotal += amt;
      return {
        code: l.code, desc: l.desc, qty: qty, pcs: l.pcs, sets: l.sets, mrp: mrp, disc: mrp > 0 ? U.r2((1 - l.offer / mrp) * 100) : 0,
        offer: l.offer, taxable: l.taxable, gstPct: l.gst, gstAmt: l.gstAmt, total: U.r2(l.taxable + l.gstAmt),
        photoLink: asOrder ? '' : (l.photo || pics[l.code] || '')
      };
    });
    var t = QuoteApi.totals_(lines);
    mrpTotal = U.r2(mrpTotal);
    return {
      kind: asOrder ? 'order' : 'quote', id: quoteId, no: U.s(q['Quote No']), date: date, validUntil: U.iso(q['Valid Until']),
      party: { name: name, contact: party ? party.contact : '', phone: party ? party.phone : '', address: party ? party.address : '',
               city: party ? party.city : '', gstin: party ? party.gstin : '' },
      preparedBy: prep, payment: payment, delivery: delivery, lines: outLines,
      totals: { mrp: mrpTotal, discount: U.r2(mrpTotal - t.taxable), taxable: t.taxable, gst: t.gst, total: t.total }
    };
  },

  /** Make the quotation PDF, store its link on the Quotations row, return the link. */
  makePdf_: function (quoteId, rowNum) {
    var q = Db.find(Db.readAll('quotations'), 'Quote ID', quoteId);
    if (!q) throw new Error('Quotation not found.');
    var url = PdfApi.make(QuoteApi.docModel_(quoteId, false));
    Db.update('quotations', rowNum || q._row, { 'Quote PDF': url });
    return url;
  },
  /** args: { quoteId } - (re)make the quotation PDF. */
  pdf: function (a) {
    var q = Db.find(Db.readAll('quotations'), 'Quote ID', a.quoteId);
    if (!q) throw new Error('Quotation not found.');
    var url = QuoteApi.makePdf_(U.s(a.quoteId), q._row);
    return { url: url, note: PdfApi.note };
  },

  /**
   * Quotes that have not become orders. args: { view: 'Waiting' (default) | 'Lost', search }
   * Waiting = still open or expired; Lost = closed as business lost.
   */
  list: function (a) {
    var s = U.low(a.search), today = U.isoToday(), lostView = U.s(a.view) === 'Lost';
    var orderIds = U.idSet(Db.readAll('orders'), 'Order ID');
    var sums = {};
    Db.readAll('quoteLines').forEach(function (r) {
      var l = QuoteApi.lineOut_(r), k = l.quoteId;
      if (!sums[k]) sums[k] = { n: 0, total: 0 };
      sums[k].n += 1; sums[k].total += l.amount;
    });
    var rows = [];
    Db.readAll('quotations').forEach(function (r) {
      var id = U.s(r['Quote ID']), auto = U.s(r['Status (auto)']);
      if (orderIds[id] || auto === 'Converted') return;
      var lost = QuoteApi.isLost_(r);
      if (lost !== lostView) return;
      var valid = U.iso(r['Valid Until']), sm = sums[id] || { n: 0, total: 0 };
      var party = U.s(r['Party (auto)']) || U.s(r['Customer / Lead Name']);
      if (s && (party + ' ' + U.s(r['Quote No'])).toLowerCase().indexOf(s) < 0) return;
      rows.push({
        id: id, no: U.s(r['Quote No']), date: U.iso(r['Quote Date']), party: party, forType: U.s(r['Quote For']),
        lines: sm.n, total: U.r2(sm.total), validUntil: valid,
        status: lost ? 'Lost' : (valid && valid < today ? 'Expired' : 'Open'),
        lostOn: U.iso(r['Lost On']), lostReason: U.s(r['Lost Reason']),
        payment: U.s(r['Payment Terms']), delivery: U.s(r['Delivery Terms']), pdf: QuoteApi.pdfUrl_(r['Quote PDF']), row: r._row
      });
    });
    var key = lostView ? 'lostOn' : 'date';
    rows.sort(function (x, y) { return y[key] > x[key] ? 1 : y[key] < x[key] ? -1 : y.row - x.row; });
    return { shown: rows.length, rows: rows.slice(0, CONFIG.MAX_ROWS) };
  },

  /**
   * Close an unanswered quotation as business lost.
   * args: { quoteId, reason (one of CONFIG.LOST_REASONS), note, markLead }
   * The items go back to "open requirements" so they can be quoted again; markLead sets a lead to Business Lost.
   */
  lose: function (a) {
    var id = U.s(a.quoteId), q = Db.find(Db.readAll('quotations'), 'Quote ID', id);
    if (!q) throw new Error('Quotation not found.');
    if (Db.find(Db.readAll('orders'), 'Order ID', id)) throw new Error('This quotation is already an order, so it cannot be marked as lost.');
    if (QuoteApi.isLost_(q)) throw new Error('This quotation is already marked as lost.');
    var reason = U.s(a.reason);
    if (CONFIG.LOST_REASONS.indexOf(reason) < 0) throw new Error('Choose a reason.');
    var note = U.s(a.note).replace(/\s+/g, ' ').slice(0, 200);
    Db.update('quotations', q._row, { 'Lost On': U.today(), 'Lost Reason': note ? reason + ' - ' + note : reason });

    var released = 0;
    Db.readAll('requirements').forEach(function (r) {
      if (U.s(r['SO ID']) === id) { Db.update('requirements', r._row, { 'SO ID': '' }); released++; }
    });
    var leadLost = false, type = U.s(q['Quote For']);
    if (a.markLead && type === 'Lead') {
      var lead = Parties.find('Lead', q['Customer / Lead ID']);
      if (lead && CONFIG.LEAD_CLOSED.indexOf(lead.status) < 0) {
        Db.update('leads', lead.row._row, { 'Lead Status': 'Business Lost' });
        leadLost = true;
      }
    }
    return { quoteNo: U.s(q['Quote No']), released: released, leadLost: leadLost };
  },

  /** args: { quoteId } - bring a lost quotation back to "waiting". */
  reopen: function (a) {
    var id = U.s(a.quoteId), q = Db.find(Db.readAll('quotations'), 'Quote ID', id);
    if (!q) throw new Error('Quotation not found.');
    if (!QuoteApi.isLost_(q)) throw new Error('This quotation is not marked as lost.');
    Db.clear('quotations', q._row, ['Lost On', 'Lost Reason']);
    var reqs = Db.readAll('requirements');
    QuoteApi.linesOf_(id).forEach(function (l) {
      if (!l.reqId) return;
      var r = Db.find(reqs, 'Req ID', l.reqId);
      if (r && !U.s(r['SO ID']) && ReqApi.statusOf_(r) !== 'Denied') { Db.update('requirements', r._row, { 'SO ID': id }); r['SO ID'] = id; }
    });
    var type = U.s(q['Quote For']);
    if (type === 'Lead') {
      var lead = Parties.find('Lead', q['Customer / Lead ID']);
      if (lead && lead.status === 'Business Lost') Db.update('leads', lead.row._row, { 'Lead Status': 'Quotation' });
    }
    return { quoteNo: U.s(q['Quote No']) };
  },

  /** args: { quoteId } */
  get: function (a) {
    var q = Db.find(Db.readAll('quotations'), 'Quote ID', a.quoteId);
    if (!q) throw new Error('Quote not found.');
    return QuoteApi.build_(q, QuoteApi.linesOf_(U.s(a.quoteId)));
  }
};
