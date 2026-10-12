/** Util.gs - small helpers: text, numbers, dates, ids. */

var U = {
  s: function (v) { return v === null || v === undefined ? '' : String(v).trim(); },
  low: function (v) { return U.s(v).toLowerCase(); },
  pad: function (n) { n = String(n); return n.length < 2 ? '0' + n : n; },

  /** Number from a cell or text ("1,200", "12%"). NaN when blank or not a number. */
  toNum: function (v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var t = U.s(v).replace(/[,\s\u20b9]/g, '').replace(/%$/, '');
    if (t === '') return NaN;
    var n = Number(t);
    return isFinite(n) ? n : NaN;
  },
  r2: function (n) { return Math.round((Number(n) + 1e-9) * 100) / 100; },
  r4: function (n) { return Math.round((Number(n) + 1e-9) * 10000) / 10000; },
  /** GST / discount stored as 0.12 or 12 or "12%" -> always a fraction (0.12). */
  frac: function (v) {
    var n = U.toNum(v);
    if (isNaN(n)) return NaN;
    return n > 1 ? n / 100 : n;
  },

  /** 8-char lowercase hex id. First char is always a-f so Sheets can never read it as a number. */
  newId: function (taken) {
    var hex = '0123456789abcdef', lead = 'abcdef';
    for (var t = 0; t < 500; t++) {
      var id = lead.charAt(Math.floor(Math.random() * 6));
      for (var i = 1; i < 8; i++) id += hex.charAt(Math.floor(Math.random() * 16));
      if (!taken[id]) { taken[id] = true; return id; }
    }
    throw new Error('Could not generate a unique ID.');
  },
  idSet: function (rows, header, into) {
    var t = into || {};
    rows.forEach(function (r) { var v = U.s(r[header]); if (v) t[v] = true; });
    return t;
  },

  // ---- dates (the sheet's own time zone is used everywhere) ----
  isoToday: function () { return Utilities.formatDate(new Date(), Db.tz(), 'yyyy-MM-dd'); },
  /** 'yyyy-MM-dd' -> Date at midnight in the sheet's time zone, or null if invalid. */
  dateFromIso: function (iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(U.s(iso));
    if (!m) return null;
    var mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = Utilities.parseDate(m[0], Db.tz(), 'yyyy-MM-dd');
    return U.iso(dt) === m[0] ? dt : null;
  },
  today: function () { return U.dateFromIso(U.isoToday()); },
  addDaysIso: function (iso, n) {
    var d = U.dateFromIso(iso);
    return Utilities.formatDate(new Date(d.getTime() + n * 86400000), Db.tz(), 'yyyy-MM-dd');
  },
  /** Date / "dd/mm/yyyy" / "yyyy-mm-dd" -> 'yyyy-MM-dd', or '' if not a date. */
  iso: function (v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, Db.tz(), 'yyyy-MM-dd');
    var t = U.s(v), m;
    if (!t) return '';
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
    if (m) return m[1] + '-' + U.pad(m[2]) + '-' + U.pad(m[3]);
    m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/.exec(t);
    if (m) return m[3] + '-' + U.pad(m[2]) + '-' + U.pad(m[1]);
    return '';
  },
  /** Indian digit grouping: 1234567.5 -> 12,34,567.50 */
  inr: function (n, dec) {
    n = Number(n); if (!isFinite(n)) n = 0;
    dec = dec === undefined ? 2 : dec;
    var neg = n < 0; n = Math.abs(n);
    var f = n.toFixed(dec).split('.'), ip = f[0], last3 = ip.slice(-3), rest = ip.slice(0, -3);
    if (rest) last3 = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
    return (neg ? '-' : '') + last3 + (dec ? '.' + f[1] : '');
  },
  esc: function (s) {
    return U.s(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
  /** First-word match used to guess the Lead POC from the signed-in user's name. */
  firstWord: function (s) { return U.s(s).split(/\s+/)[0]; }
};
