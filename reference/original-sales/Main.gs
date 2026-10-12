/**
 * Main.gs - entry points. The browser talks to ONE function: api(name, argsJson).
 * Everything returned is a JSON string, so Dates and other non-serialisable
 * values can never make google.script.run silently return null.
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle(CONFIG.APP_TITLE + ' - Sales')
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
    var args = argsJson ? JSON.parse(argsJson) : {};
    var data = entry[1]
      ? Main.locked(function () { return entry[0](args, user); })
      : entry[0](args, user);
    res = { ok: true, data: data === undefined ? null : data };
  } catch (e) {
    console.error(name + ' failed: ' + (e && e.stack ? e.stack : e));
    res = { ok: false, error: String(e && e.message ? e.message : e) };
  }
  return JSON.stringify(res);
}

var Main = {
  /** name -> [function(args, user), needsLock] */
  methods: function () {
    return {
      'boot':                 [Main.boot, false],
      'parties':              [function () { return Parties.lists(); }, false],
      'products':             [function () { return Catalog.list(); }, false],
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
  },

  /** One write at a time across all users, so numbers and IDs never collide. */
  locked: function (fn) {
    var lock = LockService.getScriptLock();
    try { lock.waitLock(25000); }
    catch (e) { throw new Error('The system is busy saving someone else\'s work. Please try again in a few seconds.'); }
    try { return fn(); } finally { lock.releaseLock(); }
  },

  boot: function (a, user) {
    var today = U.isoToday(), poc = '';
    CONFIG.LEAD_POCS.forEach(function (p) { if (U.low(p) === U.low(U.firstWord(user.name))) poc = p; });
    return {
      app: CONFIG.APP_TITLE,
      user: user,
      today: today,
      defaults: {
        followUp: U.addDaysIso(today, CONFIG.FOLLOWUP_DEFAULT_DAYS),
        validUntil: U.addDaysIso(today, CONFIG.QUOTE_VALID_DAYS)
      },
      pocDefault: poc,
      lists: {
        leadSources: CONFIG.LEAD_SOURCES, leadPocs: CONFIG.LEAD_POCS, leadStatuses: CONFIG.LEAD_STATUSES,
        paymentTerms: CONFIG.PAYMENT_TERMS, deliveryTerms: CONFIG.DELIVERY_TERMS, lostReasons: CONFIG.LOST_REASONS
      },
      nextQuoteNo: QuoteApi.nextNo()
    };
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
      throw new Error('Access denied: your role (' + (role || 'none') + ') cannot use the Sales app.');
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
