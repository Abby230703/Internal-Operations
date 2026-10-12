/**
 * Db.gs - every sheet read and write goes through here.
 *
 * Why this file exists (the usual causes of Apps Script + Sheets errors):
 *  - Columns are found by HEADER NAME, never by letter, so inserting a column
 *    in the sheet can't break the app. Trailing spaces in headers are ignored.
 *  - New rows go to the first empty row of the key column. appendRow() is NOT
 *    used: the (auto) formula columns make the sheet look full.
 *  - Only columns you name are written. Formula columns are never touched.
 *  - Real Date objects are written (never text dates).
 */

var Db = {
  _ss: null,
  _tz: null,
  _meta: {},

  ss: function () {
    if (!Db._ss) Db._ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    return Db._ss;
  },
  tz: function () {
    if (!Db._tz) Db._tz = Db.ss().getSpreadsheetTimeZone() || 'Asia/Kolkata';
    return Db._tz;
  },
  norm: function (h) { return String(h === null || h === undefined ? '' : h).replace(/\s+/g, ' ').trim(); },

  /** Tab layout: header positions, key column, read-only columns. */
  meta: function (key) {
    if (Db._meta[key]) return Db._meta[key];
    var def = TABLES[key];
    if (!def) throw new Error('Unknown table "' + key + '" (see TABLES in Config.gs).');
    var sh = Db.ss().getSheetByName(def.sheet);
    if (!sh) throw new Error('Tab "' + def.sheet + '" was not found in the spreadsheet.');
    var lastCol = Math.max(sh.getLastColumn(), 1);
    var hdr = sh.getRange(def.headerRow, 1, 1, lastCol).getValues()[0];
    var cols = {}, names = [];
    for (var i = 0; i < hdr.length; i++) {
      var n = Db.norm(hdr[i]);
      names[i] = n;
      if (n && cols[n] === undefined) cols[n] = i + 1;
    }
    var keyCol = cols[Db.norm(def.key)];
    if (!keyCol) throw new Error('Tab "' + def.sheet + '": column "' + def.key + '" was not found in row ' + def.headerRow + '.');
    var ro = {};
    (def.readonly || []).forEach(function (n) { ro[Db.norm(n)] = true; });
    var m = { key: key, def: def, sh: sh, cols: cols, names: names, lastCol: lastCol, keyCol: keyCol, readonly: ro };
    Db._meta[key] = m;
    return m;
  },
  writable: function (m, name) { return !!name && !/\(auto\)\s*$/i.test(name) && !m.readonly[name]; },

  /** Last row whose key column is filled (header row if none). */
  lastDataRow: function (m) {
    var first = m.def.headerRow + 1, max = m.sh.getMaxRows();
    if (max < first) return m.def.headerRow;
    var vals = m.sh.getRange(first, m.keyCol, max - m.def.headerRow, 1).getValues();
    for (var i = vals.length - 1; i >= 0; i--) {
      if (String(vals[i][0]).trim() !== '') return first + i;
    }
    return m.def.headerRow;
  },

  /** Every real row as {header: value, _row: sheetRowNumber}. Header names are normalised. */
  readAll: function (key) {
    var m = Db.meta(key), first = m.def.headerRow + 1, last = Db.lastDataRow(m), rows = [];
    if (last < first) return rows;
    var data = m.sh.getRange(first, 1, last - first + 1, m.lastCol).getValues();
    for (var r = 0; r < data.length; r++) {
      if (String(data[r][m.keyCol - 1]).trim() === '') continue;
      var o = { _row: first + r };
      for (var c = 0; c < m.names.length; c++) if (m.names[c]) o[m.names[c]] = data[r][c];
      rows.push(o);
    }
    return rows;
  },

  /** Same as readAll but only the named columns (fast for big tabs like Products). */
  readCols: function (key, names) {
    var m = Db.meta(key), first = m.def.headerRow + 1, last = Db.lastDataRow(m), out = [];
    if (last < first) return out;
    var n = last - first + 1, data = {};
    names.forEach(function (name) {
      var c = m.cols[Db.norm(name)];
      data[name] = c ? m.sh.getRange(first, c, n, 1).getValues() : null;
    });
    var keys = m.sh.getRange(first, m.keyCol, n, 1).getValues();
    for (var i = 0; i < n; i++) {
      if (String(keys[i][0]).trim() === '') continue;
      var o = { _row: first + i };
      for (var j = 0; j < names.length; j++) o[names[j]] = data[names[j]] ? data[names[j]][i][0] : '';
      out.push(o);
    }
    return out;
  },

  find: function (rows, header, value) {
    var v = String(value === null || value === undefined ? '' : value).trim();
    if (v === '') return null;
    for (var i = 0; i < rows.length; i++) if (String(rows[i][header]).trim() === v) return rows[i];
    return null;
  },

  /**
   * Add rows after the last real row. objs = [{header: value}, ...]. fmt = {header: numberFormat}.
   * Only the columns present in objs are written; the rest of the row is left alone.
   * Returns the sheet row numbers written.
   */
  append: function (key, objs, fmt) {
    var m = Db.meta(key);
    fmt = fmt || {};
    if (!objs.length) return [];
    var colName = {}, norms = [];
    objs.forEach(function (o) {
      var no = {};
      Object.keys(o).forEach(function (k) {
        var n = Db.norm(k), c = m.cols[n];
        if (!c) throw new Error('Column "' + n + '" was not found on tab "' + m.def.sheet + '". Run runDiagnostics().');
        if (!Db.writable(m, n)) throw new Error('Column "' + n + '" on "' + m.def.sheet + '" is a formula column and cannot be written.');
        colName[c] = n;
        no[n] = o[k];
      });
      norms.push(no);
    });
    var cols = Object.keys(colName).map(Number).sort(function (a, b) { return a - b; });
    var start = Db.lastDataRow(m) + 1, count = objs.length, endRow = start + count - 1;
    if (endRow > m.sh.getMaxRows()) m.sh.insertRowsAfter(m.sh.getMaxRows(), endRow - m.sh.getMaxRows());

    // number formats first (so '@' text columns keep leading zeros / plus signs)
    cols.forEach(function (c) {
      var n = colName[c], f = fmt[n];
      if (!f) for (var i = 0; i < count; i++) if (norms[i][n] instanceof Date) { f = 'dd/mm/yyyy'; break; }
      if (f) Db.setFormat_(m.sh.getRange(start, c, count, 1), f);
    });

    // contiguous runs of written columns -> one setValues per run
    var runs = [], cur = null;
    cols.forEach(function (c) {
      if (cur && c === cur.to + 1) cur.to = c; else { cur = { from: c, to: c }; runs.push(cur); }
    });
    runs.forEach(function (run) {
      var grid = [];
      for (var i = 0; i < count; i++) {
        var line = [];
        for (var c = run.from; c <= run.to; c++) {
          var n = colName[c], v = norms[i][n];
          if (v === undefined || v === null) v = '';
          else if (typeof v === 'string') v = Db.safeText(v, fmt[n] === '@');
          line.push(v);
        }
        grid.push(line);
      }
      m.sh.getRange(start, run.from, count, run.to - run.from + 1).setValues(grid);
    });
    var rows = [];
    for (var i = 0; i < count; i++) rows.push(start + i);
    return rows;
  },

  /** Change some cells of an existing row. */
  update: function (key, rowNum, obj, fmt) {
    var m = Db.meta(key);
    fmt = fmt || {};
    if (rowNum <= m.def.headerRow) throw new Error('Refusing to write to the header row of "' + m.def.sheet + '".');
    Object.keys(obj).forEach(function (k) {
      var n = Db.norm(k), c = m.cols[n];
      if (!c) throw new Error('Column "' + n + '" was not found on tab "' + m.def.sheet + '". Run runDiagnostics().');
      if (!Db.writable(m, n)) throw new Error('Column "' + n + '" on "' + m.def.sheet + '" is a formula column and cannot be written.');
      var v = obj[k], cell = m.sh.getRange(rowNum, c), f = fmt[n] || (v instanceof Date ? 'dd/mm/yyyy' : '');
      if (f) Db.setFormat_(cell, f);
      if (v === undefined || v === null) v = '';
      if (typeof v === 'string') v = Db.safeText(v, f === '@');
      cell.setValue(v);
    });
  },

  /** Empty some cells of a row (used to undo a half-finished save). */
  clear: function (key, rowNum, names) {
    var m = Db.meta(key);
    if (rowNum <= m.def.headerRow) return;
    names.forEach(function (k) {
      var n = Db.norm(k), c = m.cols[n];
      if (c && Db.writable(m, n)) m.sh.getRange(rowNum, c).clearContent();
    });
  },

  /**
   * Columns that belong to a Sheets "table" with a column type (date, number, dropdown...) refuse
   * setNumberFormat ("You can't set the number format of cells in a typed column"). They already
   * carry their own format, so that error is safe to ignore.
   */
  setFormat_: function (range, f) {
    try { range.setNumberFormat(f); } catch (e) { /* typed column - keeps its own format */ }
  },

  /** Text starting with = + - @ would be run as a formula; make it literal. */
  safeText: function (s, isTextColumn) {
    return (!isTextColumn && /^[=+\-@]/.test(s)) ? "'" + s : s;
  }
};
