/** Items.gs - the Products tab as a lookup by item code, shared by Procurement and Warehouse. Quantities are in pieces. */

var Items = {
  _m: null,

  reset: function () { Items._m = null; },

  /** { code: { code, name, group, pcs (pieces per set, never below 1), gst (fraction), books, reserved, onOrder, avail, wh, lastRate } } */
  map: function () {
    if (Items._m) return Items._m;
    var rows = Db.readCols('products', ['Item Code', 'Tally Name', 'Catalog Name', 'Stock Group', 'Pcs / Set', 'GST_Pct',
      'Books Qty (auto)', 'Warehouse Qty (auto)', 'Reserved (auto)', 'On Order (auto)', 'Available (auto)', 'Last Purchase Rate (auto)']);
    var m = {}, n = function (v) { var x = U.toNum(v); return isNaN(x) ? 0 : x; };
    rows.forEach(function (r) {
      var code = U.s(r['Item Code']);
      if (!code) return;
      var pcs = U.toNum(r['Pcs / Set']), g = U.frac(r['GST_Pct']);
      m[code] = {
        code: code, name: U.s(r['Tally Name']) || U.s(r['Catalog Name']), group: U.s(r['Stock Group']),
        pcs: pcs >= 1 ? pcs : 1, gst: isNaN(g) ? 0 : g,
        books: n(r['Books Qty (auto)']), wh: n(r['Warehouse Qty (auto)']), reserved: n(r['Reserved (auto)']),
        onOrder: n(r['On Order (auto)']), avail: U.s(r['Available (auto)']) === '' ? '' : n(r['Available (auto)']),
        lastRate: U.toNum(r['Last Purchase Rate (auto)'])
      };
    });
    Items._m = m;
    return m;
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
  byName: function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0; },
  matches: function (hay, q) {
    var toks = U.low(q).split(/\s+/).filter(Boolean), h = U.low(hay);
    return toks.every(function (t) { return h.indexOf(t) >= 0; });
  },
  ids: function (v) { return (Array.isArray(v) ? v : []).map(U.s).filter(Boolean); }
};
