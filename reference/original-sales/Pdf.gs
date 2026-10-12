/**
 * Pdf.gs - quotation and sales order PDFs, laid out like the Google Doc template
 * (division logos, company banner, customer block, items, totals, terms and bank details).
 * Everything is plain tables with inline styles because the HTML-to-PDF converter ignores most modern CSS.
 * A failure here never blocks saving a quote or an order.
 */

var PdfApi = {
  NAVY: '#1f3b5c',
  LOGO_W: [44, 44, 84, 130],   // printed width in px of the 4 logos (the 3rd picture has a lot of white around it)
  note: '',                    // set by make(): something worth telling the user (e.g. logos missing)

  // ---------- logos (copied from the template Google Doc, cached for 6 hours) ----------
  /** -> { items: [dataUri, ...], error }.  fresh = true skips the cache (used by runDiagnostics). */
  logos_: function (fresh) {
    var out = { items: [], error: '' }, id = CONFIG.LOGO_DOC_ID;
    if (!id) return out;
    var cache = null, key = 'hospi.logos.v1.' + id;
    try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }
    if (cache && !fresh) {
      try {
        var n = parseInt(cache.get(key + '.n'), 10);
        if (n > 0) {
          var keys = [], i;
          for (i = 0; i < n; i++) keys.push(key + '.' + i);
          var got = cache.getAll(keys), txt = '';
          for (i = 0; i < n; i++) {
            if (got[keys[i]] === undefined || got[keys[i]] === null) { txt = ''; break; }
            txt += got[keys[i]];
          }
          if (txt) { out.items = JSON.parse(txt); return out; }
        }
      } catch (e2) { out.items = []; }
    }
    try {
      var body = DocumentApp.openById(id).getBody();
      var hit = body.findElement(DocumentApp.ElementType.INLINE_IMAGE);
      while (hit && out.items.length < CONFIG.DIVISIONS.length) {
        var blob = hit.getElement().asInlineImage().getBlob();
        out.items.push('data:' + (blob.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(blob.getBytes()));
        hit = body.findElement(DocumentApp.ElementType.INLINE_IMAGE, hit);
      }
      if (!out.items.length) out.error = 'no pictures found in the template document';
    } catch (e3) {
      out.items = [];
      out.error = 'could not read the template document: ' + (e3 && e3.message ? e3.message : e3);
    }
    if (cache && out.items.length) {
      try {
        var all = JSON.stringify(out.items), parts = {}, cnt = Math.ceil(all.length / 90000);
        for (var k = 0; k < cnt; k++) parts[key + '.' + k] = all.substr(k * 90000, 90000);   // cache values are limited to 100 KB
        parts[key + '.n'] = String(cnt);
        cache.putAll(parts, 21600);
      } catch (e4) { /* the cache is only a speed-up */ }
    }
    return out;
  },

  // ---------- small formatters ----------
  date_: function (iso) {
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? (+m[3]) + ' ' + mon[+m[2] - 1] + ' ' + m[1] : '';
  },
  /** Rs amount: 2 decimals (more only if the price really has them, e.g. 41.0083). */
  money_: function (n) {
    var r = U.r4(n), d = 2;
    if (Math.abs(r * 100 - Math.round(r * 100)) > 1e-6) d = Math.abs(r * 1000 - Math.round(r * 1000)) > 1e-6 ? 4 : 3;
    return U.inr(r, d);
  },
  plain_: function (n) { return String(U.r2(n)); },       // 12 -> "12", 12.5 -> "12.5"
  qty_: function (n) { return String(U.r4(n)); },

  // ---------- html ----------
  th_: function (text, w) {
    return '<td width="' + w + '%" align="center" valign="middle" bgcolor="' + PdfApi.NAVY + '" style="background-color:' + PdfApi.NAVY +
      ';color:#ffffff;font-size:9px;font-weight:bold;padding:6px 3px;border:1px solid ' + PdfApi.NAVY + '">' + text + '</td>';
  },
  box_: function (extra) { return 'border:1px solid ' + PdfApi.NAVY + ';' + (extra || ''); },

  terms_: function (m) {
    var order = m.kind === 'order';
    var valid = PdfApi.date_(m.validUntil) || 'the validity date stated by Sales';
    var pay = m.payment || 'As agreed';
    return CONFIG.TERMS.map(function (t, i) {
      var txt = String(order && t.order ? t.order : t.quote)
        .replace(/\{validUntil\}/g, valid).replace(/\{payment\}/g, pay);
      return '<b>' + (i + 1) + '. ' + U.esc(t.t) + ':</b> ' + U.esc(txt);
    }).join('<br>');
  },

  /** m = QuoteApi.docModel_ result. logos = data URIs (may be empty). photos = { driveLink: {uri,w,h} } (quotation only). */
  html_: function (m, logos, photos) {
    var N = PdfApi.NAVY, C = CONFIG.COMPANY, B = CONFIG.BANK, P = m.party, e = U.esc, order = m.kind === 'order';
    var f = 'font-family:Arial,Helvetica,sans-serif;';

    // 1. divisions and logos
    var heads = '', pics = '';
    CONFIG.DIVISIONS.forEach(function (name, i) {
      heads += PdfApi.th_(e(name), 25);
      pics += '<td align="center" valign="middle" style="' + PdfApi.box_('padding:5px;height:58px') + '">' +
        (logos && logos[i] ? '<img src="' + logos[i] + '" width="' + (PdfApi.LOGO_W[i] || 60) + '" alt="">' : '&nbsp;') + '</td>';
    });
    var divisions = '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr>' + heads + '</tr><tr>' + pics + '</tr></table>';

    // 2. company banner
    var banner = '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr><td align="center" bgcolor="' + N +
      '" style="background-color:' + N + ';color:#ffffff;padding:12px 10px;border:1px solid ' + N + '">' +
      '<div style="font-size:22px;font-weight:bold;padding-bottom:6px">' + e(C.name) + '</div>' +
      '<div style="font-size:13px;padding-bottom:7px">' + e(C.tagline) + '</div>' +
      '<div style="font-size:9.5px;padding-bottom:5px">Address: ' + e(C.address) + '</div>' +
      '<div style="font-size:9.5px;padding-bottom:5px">Contact No-: ' + e(C.phone) + '</div>' +
      '<div style="font-size:9.5px;padding-bottom:7px">GST NO : ' + e(C.gstin) + '</div>' +
      '<div style="font-size:14px;font-weight:bold">' + (order ? 'SALES ORDER' : 'QUOTATION') + '</div>' +
      '</td></tr></table>';

    // 3. customer + document details
    var addr = [P.address, P.city].filter(function (x) { return x; }).join(', ');
    var left = '<b>Customer Name:</b> ' + e(P.name);
    if (addr) left += '<br><b>Registered Address:</b> ' + e(addr);
    if (P.phone || P.contact) left += '<br><b>Contact Number:</b> ' + e(P.phone || '-') + (P.contact ? ' (' + e(P.contact) + ')' : '');
    if (P.gstin) left += '<br><b>GST NO:</b> ' + e(P.gstin);
    var right = '<b>' + (order ? 'Order Date' : 'Quotation Date') + ' :-</b> ' + e(PdfApi.date_(m.date)) +
      '<br><b>' + (order ? 'Order No' : 'Quotation No') + ' :-</b> ' + e(m.no) +
      '<br><b>Prepared By:</b> ' + e(m.preparedBy);
    var info = '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr>' +
      '<td width="62%" valign="top" style="' + PdfApi.box_('padding:8px 9px;font-size:10px;line-height:1.7') + '">' + left + '</td>' +
      '<td width="38%" valign="top" style="' + PdfApi.box_('padding:8px 9px;font-size:10px;line-height:1.7') + '">' + right + '</td></tr></table>';

    // 4. items
    // the quotation has a Product Photo column (after Description); the sales order does not
    var cols = order
      ? [['Item Code', 8], ['Description', 26], ['Qty', 8], ['MRP', 9], ['Disc %', 6], ['Offer Price', 9], ['Taxable Value', 10], ['GST %', 6], ['GST Amount', 8], ['Total', 10]]
      : [['Item Code', 8], ['Description', 18], ['Product Photo', 11], ['Qty', 8], ['MRP', 8], ['Disc %', 5], ['Offer Price', 8], ['Taxable Value', 10], ['GST %', 5], ['GST Amount', 8], ['Total', 11]];
    var itemHead = '<tr>' + cols.map(function (c) { return PdfApi.th_(c[0], c[1]); }).join('') + '</tr>';
    var cs = PdfApi.box_('padding:5px 4px;font-size:9px;');
    var pic = function (l) {
      var ph = photos && l.photoLink ? photos[l.photoLink] : null;
      if (!ph) return '&nbsp;';
      var B = Photos.BOX, w = ph.w, hh = ph.h, k;
      if (w > 0 && hh > 0) {
        k = Math.min(B / w, B / hh);
        return '<img src="' + ph.uri + '" width="' + Math.max(1, Math.round(w * k)) + '" height="' + Math.max(1, Math.round(hh * k)) + '" alt="">';
      }
      return '<img src="' + ph.uri + '" width="' + B + '" alt="">';
    };
    var rows = m.lines.map(function (l) {
      var qty = PdfApi.qty_(l.qty) + (l.pcs > 1 ? '<br><span style="font-size:7.5px;color:#555555">' + PdfApi.qty_(l.sets) + ' sets &times; ' + PdfApi.qty_(l.pcs) + '</span>' : '');
      return '<tr>' +
        '<td valign="top" style="' + cs + '">' + (e(l.code) || '-') + '</td>' +
        '<td valign="top" style="' + cs + '">' + e(l.desc) + '</td>' +
        (order ? '' : '<td align="center" valign="middle" style="' + PdfApi.box_('padding:3px;font-size:9px;') + '">' + pic(l) + '</td>') +
        '<td valign="top" align="center" style="' + cs + '">' + qty + '</td>' +
        '<td valign="top" align="right" style="' + cs + '">' + PdfApi.money_(l.mrp) + '</td>' +
        '<td valign="top" align="center" style="' + cs + '">' + PdfApi.plain_(l.disc) + '</td>' +
        '<td valign="top" align="right" style="' + cs + '">' + PdfApi.money_(l.offer) + '</td>' +
        '<td valign="top" align="right" style="' + cs + '">' + U.inr(l.taxable) + '</td>' +
        '<td valign="top" align="center" style="' + cs + '">' + PdfApi.plain_(l.gstPct) + '</td>' +
        '<td valign="top" align="right" style="' + cs + '">' + U.inr(l.gstAmt) + '</td>' +
        '<td valign="top" align="right" style="' + cs + '">' + U.inr(l.total) + '</td></tr>';
    }).join('');
    var items = '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;table-layout:fixed">' + itemHead + rows + '</table>';

    // 5. payment / delivery notes and totals
    var T = m.totals, lab = PdfApi.box_('padding:6px 8px;font-size:10px;'), val = PdfApi.box_('padding:6px 8px;font-size:10px;text-align:right;');
    var notes = '<b>Payment terms:</b> ' + e(m.payment || 'As agreed') + '<br><b>Delivery terms:</b> ' + e(m.delivery || 'As agreed') +
      (order ? '' : '<br><b>Valid until:</b> ' + e(PdfApi.date_(m.validUntil) || '-'));
    var tot = function (label, v, bold) {
      return '<tr><td width="25%" style="' + lab + (bold ? 'font-weight:bold;' : '') + '">' + label + '</td><td width="20%" align="right" style="' + val + (bold ? 'font-weight:bold;' : '') + '">' + U.inr(v) + '</td></tr>';
    };
    var totals = '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr>' +
      '<td width="55%" valign="middle" style="' + PdfApi.box_('padding:8px 9px;font-size:10px;line-height:1.7') + '">' + notes + '</td>' +
      '<td width="45%" valign="top" style="padding:0"><table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">' +
      tot('Total at MRP', T.mrp) + tot('Discount', T.discount) + tot('Taxable Amount', T.taxable) + tot('GST Amount', T.gst) +
      tot('Total Amount After Tax', T.total, true) + '</table></td></tr></table>';

    // 6. terms and bank details
    var bank = '<div style="padding:4px 0">BANK NAME: ' + e(B.name) + '</div><div style="padding:4px 0">BRANCH: ' + e(B.branch) +
      '</div><div style="padding:4px 0">A/C: ' + e(B.account) + '</div><div style="padding:4px 0">IFSC: ' + e(B.ifsc) + '</div>';
    var terms = '<div style="page-break-inside:avoid"><table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;page-break-inside:avoid"><tr>' +
      '<td width="60%" bgcolor="' + N + '" style="background-color:' + N + ';color:#ffffff;font-size:10px;padding:6px 9px;border:1px solid ' + N + '">Terms &amp; Conditions:</td>' +
      '<td width="40%" align="center" bgcolor="' + N + '" style="background-color:' + N + ';color:#ffffff;font-size:10px;padding:6px 9px;border:1px solid ' + N + '">Banking Details</td></tr>' +
      '<tr><td rowspan="2" valign="top" style="' + PdfApi.box_('padding:7px 9px;font-size:8px;line-height:1.45') + '">' + PdfApi.terms_(m) + '</td>' +
      '<td align="center" valign="middle" style="' + PdfApi.box_('padding:8px;font-size:10px') + '">' + bank + '</td></tr>' +
      '<tr><td align="center" valign="middle" style="' + PdfApi.box_('padding:8px;font-size:10px;height:64px') + '">Authorized Stamp and Signature:</td></tr></table></div>';

    var gap = '<div style="height:10px;font-size:1px;line-height:1px">&nbsp;</div>';
    return '<html><head><meta charset="utf-8"><style>body{margin:16px;color:#1f2328;' + f + '}td,th,div,span,b{' + f + '}tr{page-break-inside:avoid}</style></head><body>' +
      divisions + gap + banner + gap + info + gap + items + gap + totals + gap + terms + '</body></html>';
  },

  folder_: function () {
    if (CONFIG.PDF_FOLDER_ID) return DriveApp.getFolderById(CONFIG.PDF_FOLDER_ID);
    var it = DriveApp.getFoldersByName(CONFIG.PDF_FOLDER_NAME);
    return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.PDF_FOLDER_NAME);
  },

  /** "A; B; C and 2 more" */
  list_: function (a) {
    var t = a.slice(0, 4).join('; ');
    return a.length > 4 ? t + ' and ' + (a.length - 4) + ' more' : t;
  },
  short_: function (x) { x = String(x || '-'); return x.length > 32 ? x.slice(0, 30) + '..' : x; },

  /** m = QuoteApi.docModel_ result. Returns the file URL; PdfApi.note says if something was left out. */
  make: function (m) {
    var notes = [];
    PdfApi.note = '';
    var lg = PdfApi.logos_(false);
    if (lg.error) notes.push('The PDF was made without the division logos (' + lg.error + ').');
    var photos = {};
    if (m.kind !== 'order') {
      var ph = Photos.embed(m.lines.map(function (l) { return l.photoLink; })), bad = [], none = [];
      photos = ph.map;
      m.lines.forEach(function (l) {
        var label = PdfApi.short_(l.code || l.desc);
        if (!l.photoLink) none.push(label);
        else if (!photos[l.photoLink]) bad.push(label + ' (' + ph.failed[l.photoLink] + ')');
      });
      if (bad.length) notes.push('Could not print the picture for: ' + PdfApi.list_(bad) + '.');
      if (none.length) notes.push('No picture for: ' + PdfApi.list_(none) + '. Add a Photo_link in Products, or upload a picture when making the quotation.');
    }
    PdfApi.note = notes.join(' ');
    var name = m.no.replace(/[\/\\:*?"<>|]/g, '-') + (m.kind === 'order' ? '-sales-order-' : '-quotation-') + m.id + '.pdf';
    var blob = Utilities.newBlob(PdfApi.html_(m, lg.items, photos), 'text/html', 'document.html').getAs('application/pdf').setName(name);
    var folder = PdfApi.folder_(), olds = folder.getFilesByName(name);
    while (olds.hasNext()) olds.next().setTrashed(true);
    var file = folder.createFile(blob);
    if (CONFIG.PDF_SHARE_LINK) file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  }
};
