'use strict';
/* Mock of the Apps Script runtime + a seeded copy of the sheet structure, enough to run the real .gs files.
   The (auto) formulas that matter are re-implemented in recalc() exactly as they read in the real sheet. */
process.env.TZ = 'Asia/Kolkata';
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = path.resolve(__dirname, '..');                                   // the files being tested (the .gs / .html in the repo root)
const REF = path.join(REPO, 'reference', 'original-sales');                   // the user's original Sales files, as pasted

const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const isBlank = v => v === '' || v === null || v === undefined;
const num = v => { if (typeof v === 'number') return v; const n = Number(String(v == null ? '' : v).replace(/[,\s]/g, '')); return isFinite(n) && String(v).trim() !== '' ? n : NaN; };

// Typed (Sheets "table") columns of the real sheet: no number formats can be set on them; DATE columns reject JS Date objects here
// (strictest reading of the error); dropdown columns only accept their list (script writes are allowed in reality, so this is stricter)
const TYPED = {
  'Requirements': { 'Req Date': 'DATE', 'Salesman': 'PEOPLE', 'Req for': ['Customer', 'Lead', ''], 'Status': ['Accepted', 'Denied', ''] },
  'Sales Orders': { 'Status': ['Order received', 'Order Packed', 'Billing done', 'Dispatched', 'Cancelled', ''], 'Invoice Date': 'DATE', 'Due Date': 'DATE' },
  'Sales Order Lines': { 'Dispatch Date': 'DATE', 'Dispatched Qty': 'DOUBLE' },
  'Stock Movement': { 'Qty': 'DOUBLE', 'Type': ['Opening', 'Put-away', 'Dispatch', 'Audit adj.', ''] },
  'GRN': { 'Status': ['Yet to receive', 'Received', ''] },
  'GRN Lines': { 'Stickered': ['Done', 'Left', ''] },
  'Payments': { 'Payment Date': 'DATE', 'Direction': ['Received', 'Paid', ''], 'Ref Type': ['Order', 'GRN', ''], 'Amount': 'DOUBLE', 'Mode': ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Other', ''] }
};
const TYPE_ERR = "You can't set the number format of cells in a typed column.";
class Sheet {
  constructor(ss, name, headerRows, maxRows) { this.ss = ss; this.name = name; this.cells = headerRows.map(r => r.slice()); this.maxRows = maxRows || 300; this.formats = {}; this.writes = []; }
  get(r, c) { const row = this.cells[r - 1]; return row && row[c - 1] !== undefined ? row[c - 1] : ''; }
  set(r, c, v, raw) { if (!raw) this.check(r, c, v); while (this.cells.length < r) this.cells.push([]); const row = this.cells[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; if (!raw) this.writes.push([r, c, v]); }
  getLastColumn() { return Math.max(1, ...this.cells.map(r => r.length)); }
  getLastRow() { for (let i = this.cells.length - 1; i >= 0; i--) if (this.cells[i].some(v => !isBlank(v))) return i + 1; return 0; }
  getMaxRows() { return this.maxRows; }
  colName(c) { const hr = this.name === 'Sales Orders' ? 2 : 1; return norm((this.cells[hr - 1] || [])[c - 1] || ''); }
  typeOf(c) { const t = TYPED[this.name]; return t ? t[this.colName(c)] : undefined; }
  check(r, c, v) {   // what the real sheet refuses for the app's own writes
    const t = this.typeOf(c), hr = this.name === 'Sales Orders' ? 2 : 1;
    if (r <= hr || t === undefined) return;
    if (t === 'DATE' && v instanceof Date) throw new Error(TYPE_ERR);
    if (Array.isArray(t) && !t.includes(v)) throw new Error('Invalid value "' + v + '" for the dropdown column ' + this.colName(c));
  }
  insertRowsAfter(a, n) { this.maxRows += n; }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
}
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() {   // a typed DATE column hands back real Dates, like the real sheet does
    const out = [];
    for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { let v = this.sh.get(this.r + i, this.c + j); if (typeof v === 'number' && this.sh.typeOf(this.c + j) === 'DATE' && this.r + i > (this.sh.name === 'Sales Orders' ? 2 : 1)) { const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); v = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); } row.push(v); } out.push(row); }
    return out;
  }
  setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => this.sh.set(this.r + i, this.c + j, v))); this.sh.ss.recalc(); return this; }
  setValue(v) { this.sh.set(this.r, this.c, v); this.sh.ss.recalc(); return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.set(this.r + i, this.c + j, ''); this.sh.ss.recalc(); return this; }
  setNumberFormat(f) { for (let j = 0; j < this.nc; j++) if (this.sh.typeOf(this.c + j) !== undefined) throw new Error(TYPE_ERR); this.sh.formats[this.r + ':' + this.c] = f; return this; }
}

class Spreadsheet {
  constructor() { this.sheets = {}; }
  add(name, headerRows, maxRows) { this.sheets[name] = new Sheet(this, name, headerRows, maxRows); return this.sheets[name]; }
  getSheetByName(n) { return this.sheets[n] || null; }
  getSpreadsheetTimeZone() { return 'Asia/Kolkata'; }
  getId() { return 'mock'; }
  /** table view by header names: { rows: [{_r, get(name), set(name, v)}] } */
  tbl(name, hr) {
    const sh = this.sheets[name], hrow = hr || 1, hdr = sh.cells[hrow - 1] || [], idx = {};
    hdr.forEach((h, i) => { const n = norm(h); if (n && idx[n] === undefined) idx[n] = i + 1; });
    const rows = [];
    for (let r = hrow + 1; r <= sh.cells.length; r++) if (!isBlank(sh.get(r, 1))) rows.push({ r, get: n => sh.get(r, idx[n]), set: (n, v) => sh.set(r, idx[n], v, true) });
    return { rows, idx, sh };
  }
  recalc() {
    const t = n => this.tbl(n), so = this.tbl('Sales Orders', 2);
    const grnL = t('GRN Lines'), pur = t('Purchase'), pl = t('Purchase Lines'), sol = t('Sales Order Lines'), mov = t('Stock Movement'), prod = t('Products');
    const aud = t('Audit Counts'), req = t('Requirements'), cust = t('Customers');
    const purBy = {}; pur.rows.forEach(p => purBy[String(p.get('Purchase ID'))] = p);
    pl.rows.forEach(l => {
      const p = purBy[String(l.get('Purchase ID'))];
      l.set('Supplier ID (auto)', p ? p.get('Supplier Company Name') : '');
      const recv = grnL.rows.filter(g => String(g.get('Purchase Line ID')) === String(l.get('Line ID'))).reduce((s, g) => s + (num(g.get('Received No. of Sets')) || 0), 0);
      l.set('Open Sets (auto)', !p || p.get('Status') !== 'Sent' ? 0 : Math.max(0, (num(l.get('No. of Set')) || 0) - recv));
    });
    const soBy = {}; so.rows.forEach(o => soBy[String(o.get('Order ID'))] = o);
    sol.rows.forEach(l => {
      const o = soBy[String(l.get('Order ID'))], g = num(l.get('No. of set')) || 0, p = num(l.get('Dispatched Qty')) || 0;
      l.set('Open Sets (auto)', ((o && o.get('Status') === 'Cancelled') || l.get('Dispatched') === true) ? 0 : Math.max(0, g - p));
    });
    so.rows.forEach(o => {
      const id = String(o.get('Order ID')), ls = sol.rows.filter(l => String(l.get('Order ID')) === id);
      const c = cust.rows.find(x => String(x.get('Customer ID')) === String(o.get('Customer')));
      o.set('Customer (auto)', c ? c.get('Company/Brand Name') : '');
      o.set('Lines (auto)', ls.length);
      o.set('Value incl. GST (auto)', Math.round(ls.reduce((t, l) => t + (num(l.get('Pcs / Set')) || 1) * (num(l.get('No. of set')) || 0) * (num(l.get('Offer Price')) || 0) * (1 + (num(l.get('GST %')) || 0)), 0) * 100) / 100);
      const st = o.get('Status');
      const picked = ls.filter(l => l.get('Picked') === true).length, packed = ls.filter(l => l.get('Packed') === true).length;
      o.set('Stage (auto)', st === 'Cancelled' ? 'Cancelled' : st === 'Dispatched' ? 'Dispatched' : ls.length === 0 ? 'No lines' : picked < ls.length ? 'To pick' : packed < ls.length ? 'To pack' : o.get('Transport Booked') !== true ? 'Book transport' : 'Ready to dispatch');
    });
    req.rows.forEach(r => {
      const p = purBy[String(r.get('PO ID ') || r.get('PO ID'))];
      r.set('PO no. (auto)', p ? p.get('Purchase No') : '');
      r.set('Party (auto)', r.get('Customer / Lead Name'));
      r.set('Stage (auto)', !isBlank(r.get('PO ID')) ? 'Ordered' : r.get('Status') === 'Denied' ? 'Denied' : r.get('Status') === 'Accepted' ? 'Accepted' : '');
    });
    prod.rows.forEach(p => {
      const code = String(p.get('Item Code')), per = num(p.get('Pcs / Set')) || 1;
      const wh = mov.rows.filter(m => String(m.get('Item Code')) === code).reduce((s, m) => s + (num(m.get('Qty')) || 0), 0);
      const res = sol.rows.filter(l => String(l.get('Item_Code')) === code).reduce((s, l) => s + (num(l.get('Open Sets (auto)')) || 0), 0) * per;
      const ord = pl.rows.filter(l => String(l.get('Item Code')) === code).reduce((s, l) => s + (num(l.get('Open Sets (auto)')) || 0), 0) * per;
      p.set('Warehouse Qty (auto)', wh); p.set('Reserved (auto)', res); p.set('On Order (auto)', ord); p.set('Available (auto)', wh - res);
    });
    aud.rows.forEach(a => {
      if (isBlank(a.get('Item Code'))) return;
      const sys = mov.rows.filter(m => String(m.get('Item Code')) === String(a.get('Item Code')) && m.get('Location') === a.get('Location')).reduce((s, m) => s + (num(m.get('Qty')) || 0), 0);
      a.set('System Qty (auto)', sys); a.set('Variance (auto)', (num(a.get('Counted Qty')) || 0) - sys);
    });
  }
}

const H = {
  Users: ['Email', 'Name', 'Role'],
  Locations: ['Location Code', 'QR Code', 'Floor', 'Zone', 'Shelf', 'Description'],
  Products: ['Item Code', 'Tally Name ', 'Stock Group', 'Catalog Name', 'Pcs / Set', 'List Price', 'Customisation ', 'Product Type', 'Material', 'Size', 'Colour', 'Brand', 'HSN', 'GST_Pct', 'Photo', 'Photo_link', 'Verified', 'Verified_By', 'Verified_On', 'Item label (auto)', 'Books Qty (auto)', 'Warehouse Qty (auto)', 'Warehouse Location (auto)', 'Reserved (auto)', 'On Order (auto)', 'Available (auto)', 'Last Purchase Rate (auto)', 'Last Supplier (auto)'],
  Customers: ['Customer ID', 'Company/Brand Name ', 'Customer Name ', 'WhatsApp No. ', 'GSTIN', 'Address', 'City', 'Salesman'],
  Requirements: ['Req ID', 'Req Date', 'Salesman', 'Req for', 'Customer / Lead Name', 'Customer / Lead ID ', 'Need By', 'Supplier', 'Status', 'PO ID ', 'SO ID ', 'Notes', 'Item Code', 'Item Description', 'No. of Set', 'Party (auto)', 'Item (auto)', 'Quote no. (auto)', 'PO no. (auto)', 'Stage (auto)'],
  Suppliers: ['Supplier ID', 'Supplier Company Name ', 'Contact_Name', 'WhatsApp', 'Email', 'GSTIN', 'City', 'Address', 'Product_Categories'],
  Purchase: ['Purchase ID', 'Purchase No', 'Purchase Date', 'Supplier Company Name ', 'Delivery Date', 'Payment Terms', 'Status', 'PO PDF ', 'Created By', 'Created At', 'Proforma Purchase Invoice ', 'Generated By', 'Generated At'],
  'Purchase Lines': ['Line ID', 'Req ID', 'Purchase ID', 'Item Code', 'Description', 'Supplier Item Code ', 'Supplier Item Name', 'Pcs / Set', 'No. of Set', 'Rate', 'GST %', 'Supplier ID (auto)', 'Open Sets (auto)'],
  GRN: ['GRN ID', 'GRN No', 'Purchase ID', 'Supplier', 'Supplier Invoice No', 'Invoice Date', 'Received Date', 'No. of cartons received', 'Received By', 'Status', 'Bill Amount', 'Tally Purchase Voucher No.', 'Paid (auto)', 'Balance (auto)'],
  'GRN Lines': ['Line ID', 'GRN ID', 'Purchase Line ID', 'Item Code', 'Description', 'Supplier item code', 'Expected pcs / set', 'Expected No. of Sets', 'Received pcs / set', 'Received No. of Sets', 'Damaged Qty', 'Stickered', 'Stickered Qty', 'Put Away ', 'Put Away By', 'Put_Qty', 'Location'],
  'Stock Movement': ['Move ID', 'Ref ID', 'Moved At', 'Item Code', 'Qty', 'Location', 'Type', 'Moved By'],
  'Audit Counts': ['Count ID', 'Counted At', 'Item Code', 'Description', 'Location', 'Counted Qty', 'Photo', 'Counted By', 'Status', 'Product Type', 'Material', 'Size', 'Colour', 'Brand', 'Reviewed By', 'Reviewed On', 'System Qty (auto)', 'Variance (auto)'],
  'Sales Orders': ['Order ID', 'Order No.', 'Order Date', 'Customer ', 'Salesman', 'Status', 'Payment Terms', 'Delivery Terms', 'Proforma Invoice PDF', 'Created At', 'Dispatch Date', 'Dispatched By', 'Transport Booked ', 'Tally Voucher No. ', 'Invoice Date', 'Due Date', 'Payment Cleared On', 'Invoice Amount', 'Transporter', 'LR No.', 'Customer (auto)', 'Lines (auto)', 'Value incl. GST (auto)', 'Stage (auto)', 'Received (auto)', 'Balance (auto)', 'Pay Status (auto)'],
  'Sales Order Lines': ['Line ID', 'Req ID', 'Order ID ', 'Item_Code', 'Description', 'Pcs / Set', 'No. of set', 'Offer Price', 'GST %', 'Pick From ', 'Picked', 'Packed', 'Dispatched', 'Dispatch Date', 'Dispatched By', 'Dispatched Qty', 'Taxable amount (auto)', 'GST amount (auto)', 'Open Sets (auto)'],
  Payments: ['Payment ID', 'Payment Date', 'Direction', 'Ref Type', 'Ref ID', 'Amount', 'Mode', 'Reference No.', 'Entered By', 'Notes', 'Ref No. (auto)'],
  Leads: ['Lead ID '], Quotations: ['Quote ID'], Quotation_lines: ['Line ID']
};
const fill = (name, obj) => H[name].map(h => { const k = Object.keys(obj).find(x => norm(x) === norm(h)); return k === undefined ? '' : obj[k]; });

function seed() {
  const ss = new Spreadsheet();
  Object.keys(H).forEach(n => ss.add(n, n === 'Sales Orders' ? [H[n].map(() => ''), H[n]] : [H[n]]));
  const add = (n, o) => ss.sheets[n].cells.push(fill(n, o));
  [['admin@x.com', 'Ada Admin', 'Admin'], ['sales@x.com', 'Sam Sales', 'Sales'], ['proc@x.com', 'Priya Proc', 'Procurement'], ['wh@x.com', 'Sujal', 'Warehouse'], ['acc@x.com', 'Anil Acc', 'Accounts'], ['nobody@x.com', 'Nobody', 'Intern']]
    .forEach(u => add('Users', { Email: u[0], Name: u[1], Role: u[2] }));
  ['FL1-ZA', 'FL1-ZB', 'FL1-ZF'].forEach(c => add('Locations', { 'Location Code': c, Description: 'Floor 1, Zone ' + c.slice(-1) }));
  [[100005, 'OCEAN POP JAR 325 ML GLASS LID 2511', 6, 1], [100205, 'ARN PRIME GRAVY BOAT 35CL', 12, 0], [100010, 'MIRRORED TRAY', 1, 87], [100310, 'DEMO ITEM', 6, 0], [100001, 'ABH ALUM ANTIQUE CHOWKI SMALL SET', 1, 3], [100751, 'FNS MONTAVO VERONA TEA SPOON', '', 0]]
    .forEach(p => add('Products', { 'Item Code': p[0], 'Tally Name': p[1], 'Stock Group': 'Glassware', 'Pcs / Set': p[2], GST_Pct: 0.12, 'Books Qty (auto)': p[3] }));
  add('Customers', { 'Customer ID': '998496b6', 'Company/Brand Name': 'Glass Museum' });
  add('Customers', { 'Customer ID': '47039524', 'Company/Brand Name': 'ABCD' });
  [['6f43d3c3', 'Ariane', 'Rakesh'], ['1f784ebe', 'KMW', 'Bhanush'], ['22037baa', 'namosons', '']].forEach(s => add('Suppliers', { 'Supplier ID': s[0], 'Supplier Company Name': s[1], Contact_Name: s[2] }));
  add('Requirements', { 'Req ID': '36b918d9', 'Req Date': new Date(2026, 9, 3), Salesman: 'sales@x.com', 'Req for': 'Customer', 'Customer / Lead Name': 'Glass Museum', 'Need By': new Date(2026, 9, 20), Supplier: '6f43d3c3', 'Item Code': 100205, 'No. of Set': 20 });
  add('Requirements', { 'Req ID': '040d5d14', 'Req Date': new Date(2026, 9, 3), Salesman: 'sales@x.com', 'Req for': 'Customer', 'Customer / Lead Name': 'Glass Museum', 'Need By': new Date(2026, 9, 15), Supplier: '1f784ebe', Status: 'Denied', 'Item Code': 100005, 'No. of Set': 2 });
  add('Requirements', { 'Req ID': '759c0b01', 'Req Date': new Date(2026, 9, 3), Salesman: 'proc@x.com', 'Need By': new Date(2026, 9, 15), 'Item Code': 100005, 'No. of Set': 20, Notes: 'stock top-up' });
  add('Sales Orders', { 'Order ID': 'a0000001', 'Order No.': 'AE/SO/0001', 'Order Date': new Date(2026, 9, 3), 'Customer': '998496b6', Status: 'Order received', 'Delivery Terms': '1 week' });
  add('Sales Order Lines', { 'Line ID': 'b0000001', 'Order ID': 'a0000001', Item_Code: 100205, 'Pcs / Set': 12, 'No. of set': 2, 'Offer Price': 50, 'GST %': 0.12, Picked: false, Packed: false, Dispatched: false });
  add('Sales Order Lines', { 'Line ID': 'b0000002', 'Order ID': 'a0000001', Item_Code: 100005, 'Pcs / Set': 6, 'No. of set': 3, 'Offer Price': 90, 'GST %': 0.12, Picked: false, Packed: false, Dispatched: false });
  ss.recalc();
  return ss;
}

function fmtDate(d, tz, f) {
  const p = (n, w) => String(n).padStart(w || 2, '0');
  const m = { yyyy: d.getFullYear(), MM: p(d.getMonth() + 1), dd: p(d.getDate()), HH: p(d.getHours()), mm: p(d.getMinutes()), ss: p(d.getSeconds()) };
  return f.replace(/yyyy|MM|dd|HH|mm|ss/g, t => m[t]);
}

function createEnv() {
  const ss = seed(), state = { email: 'proc@x.com', files: [], folders: {}, cache: new Map() };
  const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const folder = name => state.folders[name] || (state.folders[name] = { name, files: [], getFilesByName(n) { return iter(this.files.filter(f => f.name === n && !f.trashed)); }, createFile(blob) { const f = { name: blob.name, trashed: false, setTrashed(t) { this.trashed = t; }, getUrl() { return 'https://drive.test/' + encodeURIComponent(blob.name); }, setSharing() {} }; this.files.push(f); state.files.push(f); return f; } });
  const sandbox = {
    console: { log: console.log, error() {} }, Date, Math, JSON, Object, Array, String, Number, RegExp, Error, isFinite, isNaN, parseInt, parseFloat, WeakMap,
    SpreadsheetApp: { openById: () => ss },
    Utilities: {
      formatDate: fmtDate, parseDate: (s, tz, f) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return new Date(+m[1], +m[2] - 1, +m[3]); },
      getUuid: () => require('crypto').randomUUID(), base64Decode: s => Array.from(Buffer.from(s, 'base64')).map(b => (b > 127 ? b - 256 : b)),
      base64Encode: b => Buffer.from(b.map(x => x & 255)).toString('base64'),
      newBlob: (content, type, name) => ({ content, type, name, getAs() { return this; }, setName(n) { this.name = n; return this; } })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Session: { getActiveUser: () => ({ getEmail: () => state.email }), getEffectiveUser: () => ({ getEmail: () => state.email }) },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.test/exec' }) },
    DriveApp: { getFoldersByName: n => iter(state.folders[n] ? [state.folders[n]] : []), createFolder: n => folder(n), getFolderById: () => folder('byid'), Access: {}, Permission: {} },
    HtmlService: {},
    CacheService: { getScriptCache: () => ({
      get: k => (state.cache.has(k) ? state.cache.get(k) : null),
      getAll: ks => { const o = {}; ks.forEach(k => { if (state.cache.has(k)) o[k] = state.cache.get(k); }); return o; },
      put: (k, v) => { state.cache.set(k, v); }, putAll: o => { Object.keys(o).forEach(k => state.cache.set(k, o[k])); },
      remove: k => { state.cache.delete(k); }, removeAll: ks => { ks.forEach(k => state.cache.delete(k)); } }) }
  };
  const ctx = vm.createContext(sandbox);
  const files = [[REF, 'Db.gs'], [REF, 'Util.gs'], [REPO, 'Config.gs'], [REF, 'Lookups.gs'], [REF, 'RequirementsApi.gs'], [REF, 'LeadsApi.gs'], [REF, 'QuotesApi.gs'], [REF, 'OrdersApi.gs'], [REF, 'Pdf.gs'],
    [__dirname, 'stubs.gs'], [REPO, 'Items.gs'], [REPO, 'Procurement.gs'], [REPO, 'Warehouse.gs'], [REPO, 'Accounts.gs'], [REPO, 'Admin.gs'], [REPO, 'Main.gs']];
  files.forEach(([d, f]) => vm.runInContext(fs.readFileSync(path.join(d, f), 'utf8'), ctx, { filename: f }));
  // every Apps Script execution starts with fresh globals: drop the per-execution caches before each call
  const fresh = () => vm.runInContext('Db._meta = {}; Db._ss = null; Db._tz = null; Items._m = null; Catalog._codes = null;', ctx);
  const raw = (name, argsJson, email) => { state.email = email === undefined ? state.email : email; fresh(); return vm.runInContext('api', ctx)(name, argsJson); };
  const api = (name, args, email) => JSON.parse(raw(name, JSON.stringify(args || {}), email));
  return { ss, state, ctx, api, raw, tbl: (n, hr) => ss.tbl(n, hr) };
}
module.exports = { createEnv, norm };
