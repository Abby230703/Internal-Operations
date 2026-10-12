/**
 * Main.gs - entry points. The browser talks to ONE function: api(name, argsJson).
 * Everything returned is a JSON string, so Dates and other non-serialisable
 * values can never make google.script.run silently return null.
 *
 * CHANGED for Procurement + Warehouse (search "PW:"): doGet picks a department, api() checks the role
 * of each action, methods() merges the Procurement and Warehouse actions, boot() skips Sales-only work
 * for other departments, Auth accepts the new roles.
 */

function doGet(e) {
  var key = 'sales', user = null;
  try { user = Auth.current(); key = Main.pickDept(user, e && e.parameter ? e.parameter.dept : ''); }
  catch (err) { key = 'sales'; }     // not signed in / not in Users: the page shows the reason from boot
  var t = HtmlService.createTemplateFromFile('Index');
  t.cfg = Main.deptConfig(key, user);
  return t.evaluate()
    .setTitle(CONFIG.APP_TITLE + ' - ' + CONFIG.DEPARTMENTS[key].label)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Used inside Index.html to pull in the other HTML files. */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Single door for the browser. Returns '{"ok":true,"data":...}' or '{"ok":false,"error":"..."}'. */
function api(name, argsJson) {
  var res;
  try {
    var entry = Main.methods()[name];
    if (!entry) throw new Error('Unknown action: ' + name);
    var user = Auth.current();
    // PW: entry = [function, needsLock, roles]. No roles = a Sales action; '*' = everyone; Admin may do anything.
    var roles = entry[2] || CONFIG.SALES_ROLES;
    if (roles !== '*' && user.role !== 'Admin' && roles.indexOf(user.role) < 0) {
      throw new Error('Your role (' + (user.role || 'none') + ') cannot do this.');
    }
    var args = argsJson ? JSON.parse(argsJson) : {};
    var data = entry[1]
      ? Main.locked(function () { try { return entry[0](args, user); } finally { Items.dropCache(); } })   // PW: stock numbers change on every write
      : entry[0](args, user);
    res = { ok: true, data: data === undefined ? null : data };
  } catch (e) {
    console.error(name + ' failed: ' + (e && e.stack ? e.stack : e));
    res = { ok: false, error: String(e && e.message ? e.message : e) };
  }
  return JSON.stringify(res);
}

var Main = {
  /** name -> [function(args, user), needsLock, roles?] */
  methods: function () {
    var all = {
      'boot':                 [Main.boot, false, '*'],
      'parties':              [function () { return Parties.lists(); }, false, '*'],
      'products':             [function () { return Catalog.list(); }, false, '*'],
      'photo.upload':         [Photos.upload, true],

      'leads.list':           [LeadsApi.list, false],
      'leads.create':         [LeadsApi.create, true],
      'leads.update':         [LeadsApi.update, true],

      'req.list':             [ReqApi.list, false],
      'req.create':           [ReqApi.create, true],

      'quote.nextNo':         [function () { return { no: QuoteApi.nextNo() }; }, false],
      'quote.openReqs':       [QuoteApi.openReqs, false],
      'quote.create':         [QuoteApi.create, true],
      'quote.createOrder':    [QuoteApi.createOrder, true],
      'quote.list':           [QuoteApi.list, false],
      'quote.get':            [QuoteApi.get, false],
      'quote.pdf':            [QuoteApi.pdf, true],
      'quote.lose':           [QuoteApi.lose, true],
      'quote.reopen':         [QuoteApi.reopen, true],

      'orders.list':          [OrdersApi.list, false],
      'orders.get':           [OrdersApi.get, false],
      'orders.convert':       [OrdersApi.convert, true],
      'orders.pdf':           [OrdersApi.pdf, true],
      'orders.cancel':        [OrdersApi.cancel, true]
    };
    // PW: Procurement, Warehouse, Accounts and Admin actions (Procurement.gs, Warehouse.gs, Accounts.gs, Admin.gs)
    [ProcApi.routes(), WhApi.routes(), AcctApi.routes(), AdminApi.routes()].forEach(function (m) {
      Object.keys(m).forEach(function (k) { all[k] = m[k]; });
    });
    return all;
  },

  /** One write at a time across all users, so numbers and IDs never collide. */
  locked: function (fn) {
    var lock = LockService.getScriptLock();
    try { lock.waitLock(25000); }
    catch (e) { throw new Error('The system is busy saving someone else\'s work. Please try again in a few seconds.'); }
    try { return fn(); } finally { lock.releaseLock(); }
  },

  // ---------- PW: departments ----------
  /** Departments this role may open. Admin may open all of them. */
  allowedDepts: function (role) {
    return Object.keys(CONFIG.DEPARTMENTS).filter(function (k) {
      return role === 'Admin' || CONFIG.DEPARTMENTS[k].roles.indexOf(role) >= 0;
    });
  },
  /** The department asked for in the URL, or the first one this role may open. */
  pickDept: function (user, want) {
    var ok = Main.allowedDepts(user.role), w = U.low(want);
    if (w && ok.indexOf(w) >= 0) return w;
    if (!ok.length) throw new Error('No department is set up for the role "' + user.role + '".');
    return ok[0];
  },
  /** What Index.html needs: titles, the board list for this role, the files to include, the department menu. */
  deptConfig: function (key, user) {
    var D = CONFIG.DEPARTMENTS, d = D[key], role = user ? user.role : '', base = '';
    try { base = ScriptApp.getService().getUrl(); } catch (e) { base = ''; }
    var only = d.boardsFor && d.boardsFor[role] ? d.boardsFor[role] : null;
    var menu = Object.keys(D).map(function (k) {
      return { key: k, label: D[k].label, initial: D[k].initial, sub: D[k].sub, url: base + '?dept=' + k,
               enabled: !!user && Main.allowedDepts(role).indexOf(k) >= 0 };
    });
    return {
      key: key, label: d.label, initial: d.initial,
      boards: only || d.boards,
      includes: only ? d.includes.filter(function (f) { return only.indexOf(Main.boardOf(f)) >= 0; }) : d.includes,
      menu: menu
    };
  },
  /** 'AuditBoard' -> 'audit' (the board name each file registers; kept in one place so Accounts can be limited to it) */
  boardOf: function (file) {
    return { LeadsBoard: 'leads', RequirementsBoard: 'requirements', QuoteBoard: 'quote', OrdersBoard: 'orders',
             ProcQueueBoard: 'requirements', PurchaseOrdersBoard: 'purchase', SuppliersBoard: 'suppliers',
             ReceivingBoard: 'receiving', PutAwayBoard: 'putaway', DispatchBoard: 'dispatch', StockBoard: 'stock', AuditBoard: 'audit',
             OrderReceiptsBoard: 'orderpay', PurchaseReceiptsBoard: 'billpay', PaymentsBoard: 'payments',
             OverviewBoard: 'overview', ProductsBoard: 'products', UsersBoard: 'users', LocationsBoard: 'locations' }[file];
  },

  boot: function (a, user) {
    var today = U.isoToday(), poc = '';
    CONFIG.LEAD_POCS.forEach(function (p) { if (U.low(p) === U.low(U.firstWord(user.name))) poc = p; });
    var out = {
      app: CONFIG.APP_TITLE,
      user: user,
      today: today,
      depts: Main.allowedDepts(user.role),
      defaults: {
        followUp: U.addDaysIso(today, CONFIG.FOLLOWUP_DEFAULT_DAYS),
        validUntil: U.addDaysIso(today, CONFIG.QUOTE_VALID_DAYS)
      },
      pocDefault: poc,
      lists: {
        leadSources: CONFIG.LEAD_SOURCES, leadPocs: CONFIG.LEAD_POCS, leadStatuses: CONFIG.LEAD_STATUSES,
        paymentTerms: CONFIG.PAYMENT_TERMS, deliveryTerms: CONFIG.DELIVERY_TERMS, lostReasons: CONFIG.LOST_REASONS,
        paymentModes: CONFIG.PAYMENT_MODES
      }
    };
    // PW: the next quote number is only needed on the Sales screens (it reads the Quotations and Orders tabs)
    if (user.role === 'Sales' || user.role === 'Admin') out.nextQuoteNo = QuoteApi.nextNo();
    return out;
  }
};

/** Who is using the app? Looked up in the Users tab. */
var Auth = {
  current: function () {
    var email = '';
    try { email = Session.getActiveUser().getEmail(); } catch (e) { email = ''; }
    if (!email) { try { email = Session.getEffectiveUser().getEmail(); } catch (e2) { email = ''; } }
    email = U.low(email);
    if (!email) {
      throw new Error('Could not identify your Google account. Deploy the web app with "Execute as: User accessing the web app".');
    }
    var me = null;
    Db.readAll('users').forEach(function (r) { if (!me && U.low(r['Email']) === email) me = r; });
    if (!me) throw new Error('Access denied: ' + email + ' is not in the Users tab.');
    var role = U.s(me['Role']);
    if (CONFIG.ALLOWED_ROLES.indexOf(role) < 0) {
      throw new Error('Access denied: your role (' + (role || 'none') + ') cannot use this app.');
    }
    return { email: email, name: U.s(me['Name']) || email, role: role };
  }
};

/** Run this once from the editor (Run > runDiagnostics) before deploying. Read the Execution log. */
function runDiagnostics() {
  var out = [];
  Object.keys(TABLES).forEach(function (key) {
    try {
      var m = Db.meta(key);
      var missing = (REQUIRED_HEADERS[key] || []).filter(function (h) { return !m.cols[Db.norm(h)]; });
      out.push((missing.length ? 'PROBLEM  ' : 'OK       ') + m.def.sheet +
        (missing.length ? ' - missing columns: ' + missing.join(', ') : ' - ' + Db.readAll(key).length + ' rows'));
    } catch (e) {
      out.push('PROBLEM  ' + TABLES[key].sheet + ' - ' + e.message);
    }
  });
  try { var u = Auth.current(); out.push('OK       You are ' + u.email + ' (' + u.role + ')'); }
  catch (e) { out.push('PROBLEM  Sign-in check - ' + e.message); }
  try { out.push('OK       Next quote number: ' + QuoteApi.nextNo()); }
  catch (e) { out.push('PROBLEM  Quote numbering - ' + e.message); }
  try {
    var lg = PdfApi.logos_(true);
    out.push(lg.error ? 'PROBLEM  PDF logos - ' + lg.error + ' (PDFs still work, just without logos)'
      : lg.items.length ? 'OK       PDF logos - ' + lg.items.length + ' found in the template document'
      : 'OK       PDF logos - switched off (LOGO_DOC_ID is blank)');
  } catch (e) { out.push('PROBLEM  PDF logos - ' + e.message); }
  try {
    var n = Object.keys(Catalog.photoLinks()).length;
    out.push('OK       Product photos - ' + n + ' product(s) have a Photo_link (the rest can be uploaded while making a quotation)');
    out.push(CONFIG.PHOTO_FOLDER_ID ? 'OK       Photo folder - ' + DriveApp.getFolderById(CONFIG.PHOTO_FOLDER_ID).getName()
      : 'OK       Photo folder - PHOTO_FOLDER_ID is blank: uploads go to a "' + CONFIG.PHOTO_FOLDER_NAME + '" folder in the uploader\'s own Drive');
  } catch (e) { out.push('PROBLEM  Product photos - ' + e.message); }
  var text = out.join('\n');
  console.log(text);
  return text;
}
