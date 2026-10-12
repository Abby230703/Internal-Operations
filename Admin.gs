/**
 * Admin.gs - backend for the Admin screens: overview (what needs attention in every department), users, product master data,
 * storage locations and a sheet check. Everything here is Admin only.
 *
 * Tables: Users (Email, Name, Role), Locations, Products (attributes; the (auto) stock columns are formulas and are never written).
 * Safety rules for Users: you cannot remove or demote yourself, and there is always at least one Admin.
 */

var AdminApi = {
  routes: function () {
    var N = [];       // no role listed = only Admin passes the check in Main.api
    return {
      'adm.overview': [AdminApi.overview, false, N],
      'adm.check':    [AdminApi.check, false, N],
      'usr.list':     [AdminApi.usrList, false, N],
      'usr.save':     [AdminApi.usrSave, true, N],
      'usr.delete':   [AdminApi.usrDelete, true, N],
      'loc.admin':    [AdminApi.locAdmin, false, N],
      'loc.save':     [AdminApi.locSave, true, N],
      'prd.list':     [AdminApi.prdList, false, N],
      'prd.save':     [AdminApi.prdSave, true, N],
      'prd.verify':   [AdminApi.prdVerify, true, N]
    };
  },

  // ---------- small helpers ----------
  /** "2026-10-12" -> "12 Oct 2026" for the sentences the overview builds on the server */
  fmt_: function (iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''), mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return m ? (+m[3]) + ' ' + mon[+m[2] - 1] + ' ' + m[1] : '';
  },
  qty_: function (n) { n = Number(n); return isFinite(n) ? String(Math.round(n * 10000) / 10000) : ''; },

  // ---------- users ----------
  deptsOf_: function (role) {
    return Main.allowedDepts(role).map(function (k) { return CONFIG.DEPARTMENTS[k].label; });
  },
  usrList: function (a, user) {
    var rows = Db.readAll('users').map(function (r) {
      var email = U.low(r['Email']), role = U.s(r['Role']);
      return { email: email, name: U.s(r['Name']), role: role, valid: CONFIG.ALLOWED_ROLES.indexOf(role) >= 0, depts: CONFIG.ALLOWED_ROLES.indexOf(role) >= 0 ? AdminApi.deptsOf_(role) : [], you: email === user.email, row: r._row };
    });
    var order = CONFIG.ALLOWED_ROLES, counts = {};
    CONFIG.ALLOWED_ROLES.forEach(function (r) { counts[r] = 0; });
    rows.forEach(function (u) { if (counts[u.role] !== undefined) counts[u.role]++; });
    rows.sort(function (x, y) {
      var ix = order.indexOf(x.role), iy = order.indexOf(y.role);
      if (ix !== iy) return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
      return x.name.toLowerCase() < y.name.toLowerCase() ? -1 : x.name.toLowerCase() > y.name.toLowerCase() ? 1 : 0;
    });
    return { rows: rows, roles: CONFIG.ALLOWED_ROLES, counts: counts };
  },
  adminCount_: function (rows, exceptEmail) {
    var n = 0;
    rows.forEach(function (r) { if (U.s(r['Role']) === 'Admin' && U.low(r['Email']) !== exceptEmail) n++; });
    return n;
  },
  /** args: { originalEmail? (when editing), email, name, role } */
  usrSave: function (a, user) {
    var email = U.low(a.email), name = U.s(a.name).replace(/\s+/g, ' '), role = U.s(a.role), orig = U.low(a.originalEmail);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid Google email address.');
    if (!name) throw new Error('Enter the person\'s name.');
    if (CONFIG.ALLOWED_ROLES.indexOf(role) < 0) throw new Error('Pick a role: ' + CONFIG.ALLOWED_ROLES.join(', ') + '.');
    var rows = Db.readAll('users'), mine = null;
    rows.forEach(function (r) { if (orig && U.low(r['Email']) === orig) mine = r; });
    rows.forEach(function (r) {
      if (U.low(r['Email']) === email && (!mine || r._row !== mine._row)) throw new Error(email + ' is already in the list.');
    });
    if (orig && !mine) throw new Error('That user no longer exists.');
    if (mine) {
      if (orig === user.email && email !== user.email) throw new Error('You cannot change your own email address here.');
      if (orig === user.email && role !== 'Admin') throw new Error('You cannot take the Admin role away from yourself. Ask another Admin.');
      if (U.s(mine['Role']) === 'Admin' && role !== 'Admin' && AdminApi.adminCount_(rows, orig) < 1) throw new Error('There must always be at least one Admin.');
      Db.update('users', mine._row, { 'Email': email, 'Name': name, 'Role': role });
      return { email: email };
    }
    Db.append('users', [{ 'Email': email, 'Name': name, 'Role': role }]);
    return { email: email };
  },
  /** args: { email } */
  usrDelete: function (a, user) {
    var email = U.low(a.email), rows = Db.readAll('users'), mine = null;
    rows.forEach(function (r) { if (U.low(r['Email']) === email) mine = r; });
    if (!mine) throw new Error('That user no longer exists.');
    if (email === user.email) throw new Error('You cannot remove yourself.');
    if (U.s(mine['Role']) === 'Admin' && AdminApi.adminCount_(rows, email) < 1) throw new Error('There must always be at least one Admin.');
    Rows.wipe('users', mine._row);
    return { email: email };
  },

  // ---------- locations ----------
  locAdmin: function () {
    var bal = Ledger.balances(), pcs = {}, items = {};
    Object.keys(bal).forEach(function (k) {
      var i = k.indexOf('|'), loc = k.slice(i + 1);
      if (bal[k] > 1e-9) { pcs[loc] = U.r4((pcs[loc] || 0) + bal[k]); items[loc] = (items[loc] || 0) + 1; }
    });
    var rows = Db.readAll('locations').filter(function (r) { return U.s(r['Location Code']); }).map(function (r) {
      var c = U.s(r['Location Code']);
      return { code: c, floor: U.s(r['Floor']), zone: U.s(r['Zone']), shelf: U.s(r['Shelf']), desc: U.s(r['Description']), pcs: pcs[c] || 0, items: items[c] || 0 };
    });
    rows.sort(function (x, y) { return x.code < y.code ? -1 : x.code > y.code ? 1 : 0; });
    return rows;
  },
  /** args: { code, floor, zone, shelf, desc, isNew }. A code never changes once it exists: stock and orders refer to it. */
  locSave: function (a) {
    var code = U.s(a.code).toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9][A-Z0-9._-]{0,29}$/.test(code)) throw new Error('A location code uses letters, digits, - . _ only (for example FL2-ZB-S2).');
    var rows = Db.readAll('locations'), hit = null;
    rows.forEach(function (r) { if (U.s(r['Location Code']).toUpperCase() === code) hit = r; });
    var obj = { 'Floor': U.s(a.floor), 'Zone': U.s(a.zone), 'Shelf': U.s(a.shelf), 'Description': U.s(a.desc) };
    if (a.isNew === true) {
      if (hit) throw new Error('The location ' + code + ' already exists.');
      obj['Location Code'] = code;
      Db.append('locations', [obj], { 'Location Code': '@' });
    } else {
      if (!hit) throw new Error('That location no longer exists.');
      Db.update('locations', hit._row, obj);
    }
    return { code: code };
  },

  // ---------- product master data ----------
  PRD_COLS_: ['Item Code', 'Tally Name', 'Stock Group', 'Catalog Name', 'Pcs / Set', 'List Price', 'Customisation', 'Product Type', 'Material', 'Size', 'Colour',
              'Brand', 'HSN', 'GST_Pct', 'Photo_link', 'Verified', 'Verified_By', 'Verified_On'],
  prdOut_: function (r, items) {
    var code = U.s(r['Item Code']), g = U.frac(r['GST_Pct']), lp = U.toNum(r['List Price']), pcs = U.toNum(r['Pcs / Set']), p = items[code];
    var o = {
      code: code, tallyName: U.s(r['Tally Name']), group: U.s(r['Stock Group']), catalogName: U.s(r['Catalog Name']), pcs: pcs >= 1 ? pcs : 1,
      listPrice: isNaN(lp) ? '' : lp, customisation: U.s(r['Customisation']), productType: U.s(r['Product Type']), material: U.s(r['Material']), size: U.s(r['Size']),
      colour: U.s(r['Colour']), brand: U.s(r['Brand']), hsn: U.s(r['HSN']), gst: U.s(r['GST_Pct']) === '' || isNaN(g) ? '' : U.r4(g * 100),
      photoLink: U.s(r['Photo_link']), verified: r['Verified'] === true || /^true$/i.test(U.s(r['Verified'])), verifiedBy: U.s(r['Verified_By']), verifiedOn: AcctApi.iso_(r['Verified_On']),
      wh: p ? p.wh : 0, avail: p ? p.avail : '', row: r._row
    };
    o.missing = [];
    if (!o.catalogName) o.missing.push('Catalog name');
    if (!o.hsn) o.missing.push('HSN');
    if (o.gst === '') o.missing.push('GST');
    if (o.listPrice === '') o.missing.push('List price');
    return o;
  },
  /** args: { filter: 'Needs details' | 'Unverified' | 'All', search } */
  prdList: function (a) {
    var items = Items.map(), f = U.s(a.filter) || 'Needs details', q = U.s(a.search);
    var all = Db.readCols('products', AdminApi.PRD_COLS_).map(function (r) { return AdminApi.prdOut_(r, items); });
    var counts = { total: all.length, needs: 0, unverified: 0 }, lists = { groups: {}, types: {}, materials: {}, brands: {}, colours: {}, sizes: {} };
    all.forEach(function (p) {
      if (p.missing.length) counts.needs++;
      if (!p.verified) counts.unverified++;
      if (p.group) lists.groups[p.group] = 1; if (p.productType) lists.types[p.productType] = 1; if (p.material) lists.materials[p.material] = 1;
      if (p.brand) lists.brands[p.brand] = 1; if (p.colour) lists.colours[p.colour] = 1; if (p.size) lists.sizes[p.size] = 1;
    });
    var rows = all.filter(function (p) {
      if (f === 'Needs details' && !p.missing.length) return false;
      if (f === 'Unverified' && p.verified) return false;
      return !q || Rows.matches([p.code, p.tallyName, p.catalogName, p.group, p.productType, p.material, p.brand, p.colour, p.hsn].join(' '), q);
    });
    rows.sort(function (x, y) { return x.code.length - y.code.length || (x.code < y.code ? -1 : x.code > y.code ? 1 : 0); });
    var out = {};
    Object.keys(lists).forEach(function (k) { out[k] = Object.keys(lists[k]).sort().slice(0, 300); });
    return { shown: rows.length, rows: rows.slice(0, CONFIG.MAX_ROWS), counts: counts, lists: out };
  },
  prdRow_: function (code) {
    var c = U.s(code), hit = null;
    if (!c) throw new Error('Pick an item.');
    Db.readCols('products', ['Item Code']).forEach(function (r) { if (U.s(r['Item Code']) === c) hit = r; });
    if (!hit) throw new Error('Item ' + c + ' was not found in Products.');
    return hit;
  },
  /**
   * Change an item's details. args: { code, catalogName, group, pcs, listPrice, customisation, productType, material, size, colour, brand,
   * hsn, gst (percent), photoLink }. The Tally name is imported from Tally and is not changed here.
   */
  prdSave: function (a) {
    var hit = AdminApi.prdRow_(a.code), pcs = U.toNum(a.pcs), lp = U.s(a.listPrice) === '' ? '' : U.toNum(a.listPrice), gst = U.s(a.gst) === '' ? '' : U.toNum(a.gst);
    if (!(pcs >= 1) || pcs !== Math.floor(pcs)) throw new Error('Pieces per set must be a whole number, 1 or more.');
    if (lp !== '' && (isNaN(lp) || lp < 0)) throw new Error('The list price must be 0 or more (Rs per piece, GST excluded).');
    if (gst !== '' && (isNaN(gst) || gst < 0 || gst > 100)) throw new Error('GST must be between 0 and 100 %.');
    var link = U.s(a.photoLink);
    if (link && !/^https?:\/\//i.test(link)) throw new Error('The photo link must start with https://');
    var hsn = U.s(a.hsn).replace(/\s+/g, '');
    if (hsn && !/^\d{4,8}$/.test(hsn)) throw new Error('HSN is 4 to 8 digits.');
    Db.update('products', hit._row, {
      'Catalog Name': U.s(a.catalogName).replace(/\s+/g, ' '), 'Stock Group': U.s(a.group) || 'Uncategorised', 'Pcs / Set': pcs, 'List Price': lp,
      'Customisation': U.s(a.customisation), 'Product Type': U.s(a.productType), 'Material': U.s(a.material), 'Size': U.s(a.size), 'Colour': U.s(a.colour),
      'Brand': U.s(a.brand), 'HSN': hsn, 'GST_Pct': gst === '' ? '' : gst / 100, 'Photo_link': link
    }, { 'HSN': '@', 'GST_Pct': '0.00%' });
    Catalog._codes = null;
    return { code: U.s(a.code) };
  },
  /** args: { codes: [..], verified: true|false } */
  prdVerify: function (a, user) {
    var codes = Rows.ids(a.codes), on = a.verified !== false, want = {}, done = 0;
    if (!codes.length) throw new Error('Pick at least one item.');
    codes.forEach(function (c) { want[c] = 1; });
    Db.readCols('products', ['Item Code']).forEach(function (r) {
      if (!want[U.s(r['Item Code'])]) return;
      Db.update('products', r._row, on ? { 'Verified': true, 'Verified_By': user.email, 'Verified_On': U.today() } : { 'Verified': false, 'Verified_By': '', 'Verified_On': '' });
      done++;
    });
    return { done: done };
  },

  // ---------- sheet check ----------
  /** The same check as runDiagnostics in the editor, for every tab the app uses. */
  check: function () {
    var out = [];
    Object.keys(TABLES).forEach(function (key) {
      try {
        var m = Db.meta(key), missing = (REQUIRED_HEADERS[key] || []).filter(function (h) { return !m.cols[Db.norm(h)]; });
        out.push({ sheet: m.def.sheet, ok: !missing.length, rows: Math.max(0, Db.lastDataRow(m) - m.def.headerRow), missing: missing, error: '' });
      } catch (e) { out.push({ sheet: TABLES[key].sheet, ok: false, rows: 0, missing: [], error: String(e.message || e) }); }
    });
    return { tables: out };
  },

  // ---------- overview ----------
  /** What needs attention, department by department, plus the things that look wrong. */
  overview: function () {
    var today = U.isoToday(), week = U.addDaysIso(today, -7), pq = ProcApi.pqCounts(), po = ProcApi.poList({ filter: 'All' }), wh = WhApi.counts();
    var ord = AcctApi.ordList({ filter: 'All' }), bills = AcctApi.billList({ filter: 'All' }), orders = AcctApi.orders_(), grns = AcctApi.bills_();
    var cards = [
      { dept: 'Procurement', title: 'Requirements waiting for a decision', value: pq.awaiting, sub: pq.accepted + ' accepted, not on a PO yet' },
      { dept: 'Procurement', title: 'Purchase orders', value: po.counts.draft, sub: 'draft · ' + po.counts.awaiting + ' sent, awaiting delivery' },
      { dept: 'Warehouse', title: 'Deliveries to receive', value: wh.receiving, sub: wh.putaway + (wh.putaway === 1 ? ' line' : ' lines') + ' to put away' },
      { dept: 'Warehouse', title: 'Orders to ship', value: wh.dispatch, sub: wh.ready + ' ready to dispatch' },
      { dept: 'Warehouse', title: 'Stock counts to review', value: wh.audit, sub: 'waiting for Accounts' },
      { dept: 'Accounts', title: 'Orders to invoice', value: ord.counts.toInvoice, sub: 'Rs ' + U.inr(ord.sum.toInvoiceValue, 0) + ' not yet billed' },
      { dept: 'Accounts', title: 'To collect from customers', value: ord.sum.outstanding, money: true, sub: ord.sum.overdueCount + ' overdue (Rs ' + U.inr(ord.sum.overdue, 0) + ')' },
      { dept: 'Accounts', title: 'To pay to suppliers', value: bills.sum.payable, money: true, sub: bills.counts.toBill + ' deliveries not billed yet' }
    ];
    var ex = [];
    function add(sev, dept, title, list) { if (list.length) ex.push({ sev: sev, dept: dept, title: list.length + ' ' + title, items: list.slice(0, 5), more: Math.max(0, list.length - 5) }); }

    add('high', 'Procurement', po.rows.filter(function (p) { return p.late; }).length === 1 ? 'purchase order is past its delivery date' : 'purchase orders are past their delivery date',
      po.rows.filter(function (p) { return p.late; }).map(function (p) { return p.no + ' · ' + (p.supplier || 'no supplier') + ' · due ' + AdminApi.fmt_(p.delivery); }));
    var accepted = ProcApi.pqList({ filter: 'Accepted' }).rows.filter(function (r) { return r.needBy && r.needBy < today; });
    add('high', 'Procurement', accepted.length === 1 ? 'accepted requirement is past its need-by date and not ordered' : 'accepted requirements are past their need-by date and not ordered',
      accepted.map(function (r) { return r.item + ' · needed by ' + AdminApi.fmt_(r.needBy); }));
    var unbilled = orders.filter(function (o) { return o.state === 'To invoice' && o.dispatched && o.value > 0; });
    add('high', 'Accounts', unbilled.length === 1 ? 'order was dispatched but not invoiced' : 'orders were dispatched but not invoiced',
      unbilled.map(function (o) { return o.no + ' · ' + o.customer + ' · Rs ' + U.inr(o.value, 0); }));
    var late = orders.filter(function (o) { return o.state === 'Overdue'; });
    add('high', 'Accounts', late.length === 1 ? 'customer payment is overdue' : 'customer payments are overdue',
      late.map(function (o) { return o.no + ' · ' + o.customer + ' · Rs ' + U.inr(o.balance, 0) + ' · ' + o.overdueDays + ' days late'; }));
    var latePay = grns.filter(function (b) { return b.state === 'Overdue'; });
    add('med', 'Accounts', latePay.length === 1 ? 'supplier bill is overdue' : 'supplier bills are overdue',
      latePay.map(function (b) { return b.no + ' · ' + b.supplier + ' · Rs ' + U.inr(b.balance, 0) + ' · ' + b.overdueDays + ' days late'; }));
    var unb = grns.filter(function (b) { return b.state === 'To bill' && b.receivedDate && b.receivedDate <= week; });
    add('med', 'Accounts', unb.length === 1 ? 'delivery was received over a week ago and is not billed' : 'deliveries were received over a week ago and are not billed',
      unb.map(function (b) { return b.no + ' · ' + b.supplier + ' · received ' + AdminApi.fmt_(b.receivedDate); }));
    var old = [];
    Db.readAll('audit').forEach(function (r) {
      var d = AcctApi.iso_(r['Counted At']);
      if ((U.s(r['Status']) || 'Pending') === 'Pending' && d && d <= week) old.push(U.s(r['Description']) || U.s(r['Item Code']) || 'Unnamed item');
    });
    add('med', 'Accounts', old.length === 1 ? 'stock count has waited over a week for review' : 'stock counts have waited over a week for review', old.map(function (n) { return n; }));
    var short = WhApi.stockList({ filter: 'Short' });
    add('high', 'Warehouse', short.rows.length === 1 ? 'item is promised to customers beyond the stock in the warehouse' : 'items are promised to customers beyond the stock in the warehouse',
      short.rows.map(function (r) { return r.name + ' · available ' + AdminApi.qty_(r.avail) + ' pcs'; }));
    var mism = WhApi.stockList({ filter: 'Mismatch' });
    add('info', 'Warehouse', mism.rows.length === 1 ? 'item where the warehouse count differs from the Tally books' : 'items where the warehouse count differs from the Tally books',
      mism.rows.map(function (r) { return r.name + ' · books ' + AdminApi.qty_(r.books) + ' vs warehouse ' + AdminApi.qty_(r.wh); }));
    var noTax = [];
    Db.readCols('products', ['Item Code', 'Tally Name', 'GST_Pct', 'HSN']).forEach(function (r) {
      var p = Items.map()[U.s(r['Item Code'])];
      if (p && p.wh !== 0 && (U.s(r['GST_Pct']) === '' || U.s(r['HSN']) === '')) noTax.push(p.name + ' · ' + p.code);
    });
    add('info', 'Admin', noTax.length === 1 ? 'item in the warehouse has no GST rate or HSN' : 'items in the warehouse have no GST rate or HSN', noTax);
    var users = AdminApi.usrList({}, { email: '' });
    var noRole = ['Sales', 'Procurement', 'Warehouse', 'Accounts'].filter(function (r) { return !users.counts[r]; });
    add('info', 'Admin', noRole.length === 1 ? 'role has nobody in it' : 'roles have nobody in them', noRole.map(function (r) { return r + ' - add people on the Users tab'; }));
    var bad = users.rows.filter(function (u) { return !u.valid; });
    add('high', 'Admin', bad.length === 1 ? 'user has a role the app does not know' : 'users have a role the app does not know', bad.map(function (u) { return u.name + ' · ' + u.email + ' · "' + u.role + '"'; }));
    var order = { high: 0, med: 1, info: 2 };
    ex.sort(function (x, y) { return order[x.sev] - order[y.sev]; });
    return { today: today, cards: cards, exceptions: ex };
  }
};
