/** Items.gs - the Products tab as a lookup by item code, shared by Procurement and Warehouse. Quantities are in pieces. */

var Items = {
  _m: null,
  KEY: 'hospi.items.v1',
  TTL: 120,   // seconds. Names / pieces-per-set rarely change; the stock numbers on it are for display only.

  /** Forget the product map (this run and the shared cache). Called after every write and after a new item is added. */
  dropCache: function () {
    Items._m = null;
    try {
      var c = CacheService.getScriptCache(), n = parseInt(c.get(Items.KEY + '.n'), 10) || 0, keys = [Items.KEY + '.n'];
      for (var i = 0; i < n; i++) keys.push(Items.KEY + '.' + i);
      c.removeAll(keys);
    } catch (e) { /* the cache is only a speed-up */ }
  },
  reset: function () { Items.dropCache(); },

  /** { code: { code, name, group, pcs (pieces per set, never below 1), gst (fraction), books, reserved, onOrder, avail, wh, lastRate } } */
  map: function () {
    if (Items._m) return Items._m;
    var rows = Items.fromCache_();
    if (rows) { Items._m = Items.build_(rows); Items._fromCache = true; return Items._m; }
    return Items.load_();
  },
  /** One item by code. If it is not in the (possibly cached) map, read the sheet once more before saying it is missing. */
  get: function (code) {
    var c = U.s(code);
    if (!c) return null;
    var m = Items.map();
    if (!m[c] && Items._fromCache) { Items.dropCache(); m = Items.load_(); }
    return m[c] || null;
  },

  load_: function () {
    var raw = Db.readCols('products', ['Item Code', 'Tally Name', 'Catalog Name', 'Stock Group', 'Pcs / Set', 'GST_Pct',
      'Books Qty (auto)', 'Warehouse Qty (auto)', 'Reserved (auto)', 'On Order (auto)', 'Available (auto)', 'Last Purchase Rate (auto)']);
    var n = function (v) { var x = U.toNum(v); return isNaN(x) ? 0 : x; }, rows = [];
    raw.forEach(function (r) {
      var code = U.s(r['Item Code']);
      if (!code) return;
      var pcs = U.toNum(r['Pcs / Set']), g = U.frac(r['GST_Pct']), last = U.toNum(r['Last Purchase Rate (auto)']);
      rows.push([code, U.s(r['Tally Name']) || U.s(r['Catalog Name']), U.s(r['Stock Group']), pcs >= 1 ? pcs : 1, isNaN(g) ? 0 : g,
                 n(r['Books Qty (auto)']), n(r['Warehouse Qty (auto)']), n(r['Reserved (auto)']), n(r['On Order (auto)']),
                 U.s(r['Available (auto)']) === '' ? '' : n(r['Available (auto)']), isNaN(last) ? '' : last]);
    });
    Items._fromCache = false;
    Items.toCache_(rows);
    Items._m = Items.build_(rows);
    return Items._m;
  },
  build_: function (rows) {
    var m = {};
    rows.forEach(function (a) {
      m[a[0]] = { code: a[0], name: a[1], group: a[2], pcs: a[3], gst: a[4], books: a[5], wh: a[6], reserved: a[7], onOrder: a[8], avail: a[9],
                  lastRate: a[10] === '' ? NaN : a[10] };
    });
    return m;
  },
  fromCache_: function () {
    try {
      var c = CacheService.getScriptCache(), n = parseInt(c.get(Items.KEY + '.n'), 10);
      if (!(n > 0)) return null;
      var keys = [], i, txt = '';
      for (i = 0; i < n; i++) keys.push(Items.KEY + '.' + i);
      var got = c.getAll(keys);
      for (i = 0; i < n; i++) { if (got[keys[i]] === undefined || got[keys[i]] === null) return null; txt += got[keys[i]]; }
      return JSON.parse(txt);
    } catch (e) { return null; }
  },
  toCache_: function (rows) {
    try {
      var all = JSON.stringify(rows), parts = {}, cnt = Math.ceil(all.length / 90000);      // one cache value holds at most 100 KB
      for (var k = 0; k < cnt; k++) parts[Items.KEY + '.' + k] = all.substr(k * 90000, 90000);
      parts[Items.KEY + '.n'] = String(cnt);
      CacheService.getScriptCache().putAll(parts, Items.TTL);
    } catch (e) { /* the cache is only a speed-up */ }
  },

  /** pieces per set for a code (fallback when the item is unknown) */
  pcs: function (code, fallback) {
    var p = code ? Items.map()[U.s(code)] : null;
    return p ? p.pcs : (fallback >= 1 ? fallback : 1);
  },
  /** display name: the product's name, or the free-text description for a new item */
  name: function (code, desc) {
    var p = code ? Items.map()[U.s(code)] : null;
    return p ? (p.name || p.code) : U.s(desc);
  },
  /** the item code as the sheet stores it (number or text); null when the item is not in Products */
  raw: function (code) { return Catalog.rawCode(code); }
};

/** Row helpers shared by Procurement and Warehouse. */
var Rows = {
  group: function (rows, header) {
    var m = {};
    rows.forEach(function (r) { var k = U.s(r[header]); (m[k] = m[k] || []).push(r); });
    return m;
  },
  by: function (rows, header) {
    var m = {};
    rows.forEach(function (r) { m[U.s(r[header])] = r; });
    return m;
  },
  /** "AE/PO/" + the next number (4 digits) after the highest one already in column header */
  nextNo: function (rows, header, prefix) {
    var max = 0;
    rows.forEach(function (r) {
      var v = U.s(r[header]), m;
      if (v.indexOf(prefix) === 0 && (m = /(\d+)\s*$/.exec(v))) max = Math.max(max, parseInt(m[1], 10));
    });
    var n = String(max + 1);
    while (n.length < 4) n = '0' + n;
    return prefix + n;
  },
  /** Take a row out of use: empty every column the app may write. The key column goes blank, so readers skip it. */
  wipe: function (key, rowNum) {
    var m = Db.meta(key);
    Db.clear(key, rowNum, m.names.filter(function (n) { return n && Db.writable(m, n); }));
  },
  /** sets can be a fraction (a part-set); keep enough decimals that sets x pieces-per-set gives whole pieces back */
  sets: function (n) { return Math.round((Number(n) + 1e-12) * 1e8) / 1e8; },
  /**
   * A date for a TYPED date column (Requirements > Req Date, Sales Order Lines > Dispatch Date). The sheet refuses a number
   * format on a typed column, and writing a Date object makes it try, so write the date as its serial number: the column
   * shows it in its own date format. iso = 'yyyy-mm-dd'.
   */
  serial: function (iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(U.s(iso));
    return m ? Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000) : '';
  },
  /** GRN Lines > Stickered is a Done / Left drop-down (older rows may hold TRUE / FALSE) */
  stickerOut: function (on) { return on ? 'Done' : 'Left'; },
  stickerIn: function (v) { return v === true || /^(done|true)$/i.test(U.s(v)); },
  byName: function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0; },
  matches: function (hay, q) {
    var toks = U.low(q).split(/\s+/).filter(Boolean), h = U.low(hay);
    return toks.every(function (t) { return h.indexOf(t) >= 0; });
  },
  ids: function (v) { return (Array.isArray(v) ? v : []).map(U.s).filter(Boolean); }
};
