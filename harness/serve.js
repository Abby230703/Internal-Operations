'use strict';
/* Serves the real Index.html + boards (rendered like Apps Script templates) and an /api endpoint backed by the mock sheet. */
const http = require('http'), fs = require('fs'), path = require('path'), vm = require('vm');
const { createEnv } = require('./mock');
const REPO = path.resolve(__dirname, '..'), REF = path.join(REPO, 'reference', 'original-sales');
let env = createEnv();

let BROKEN = '';
function readFile(name) {
  if (name === BROKEN) return fs.readFileSync(path.join(REPO, name + '.html'), 'utf8').replace(/^<script>\n/, '');
  for (const d of [REPO, REF]) { const p = path.join(d, name + '.html'); if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8'); }
  throw new Error('no such include: ' + name);
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function render(tpl, cfg) {
  let code = 'var __o="";', last = 0, m; const re = /<\?(!=|=)?([\s\S]*?)\?>/g;
  while ((m = re.exec(tpl))) {
    code += '__o+=' + JSON.stringify(tpl.slice(last, m.index)) + ';';
    if (m[1] === '=') code += '__o+=esc(' + m[2] + ');'; else if (m[1] === '!=') code += '__o+=(' + m[2] + ');'; else code += m[2] + '\n';
    last = re.lastIndex;
  }
  code += '__o+=' + JSON.stringify(tpl.slice(last)) + ';return __o;';
  return new Function('cfg', 'include', 'esc', code)(cfg, n => readFile(n), esc);
}
const SHIM = `<script>
window.__EMAIL = new URLSearchParams(location.search).get('as') || '';
window.google = { script: { run: (function () {
  function mk(ok, bad) { return { withSuccessHandler: function (f) { return mk(f, bad); }, withFailureHandler: function (f) { return mk(ok, f); },
    api: function (name, args) { fetch('/api', { method: 'POST', body: JSON.stringify({ name: name, args: args, email: window.__EMAIL }) }).then(function (r) { return r.text(); }).then(function (t) { ok && ok(t); }).catch(function (e) { bad && bad(e); }); } }; }
  return mk(null, null); })() } };
</script>`;

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/reset') { env = createEnv(); res.end('reset'); return; }
    if (u.pathname === '/state') { // quick look at a sheet
      const sh = env.ss.sheets[u.searchParams.get('sheet')]; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(sh.cells)); return;
    }
    if (u.pathname === '/api' && req.method === 'POST') {
      // like google.script.run: the server function returns a JSON *string*, the client gets that string
      let b = ''; req.on('data', c => b += c); req.on('end', () => { const j = JSON.parse(b); res.end(env.raw(j.name, typeof j.args === 'string' ? j.args : JSON.stringify(j.args || {}), j.email)); });
      return;
    }
    const m = /^\/page\/(\w+)$/.exec(u.pathname);
    if (m) {
      BROKEN = u.searchParams.get('broken') || '';
      const as = u.searchParams.get('as'), user = env.tbl('Users').rows.find(r => r.get('Email') === as);
      const role = user ? user.get('Role') : '';
      let key = m[1];
      try { key = vm.runInContext('Main.pickDept', env.ctx)({ role }, m[1]); } catch (e) { key = 'sales'; }   // like doGet: a role can only open its own departments
      const cfg = JSON.parse(JSON.stringify(vm.runInContext('Main.deptConfig', env.ctx)(key, { role })));
      let html = render(readFile('Index'), cfg).replace(/<body([^>]*)>/, '<body$1>' + SHIM);
      res.setHeader('content-type', 'text/html'); res.end(html); return;
    }
    res.statusCode = 404; res.end('nope');
  } catch (e) { res.statusCode = 500; res.end(String(e.stack || e)); }
}).listen(8765, () => console.log('listening 8765'));
