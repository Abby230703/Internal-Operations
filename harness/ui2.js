'use strict';
const { chromium } = require('playwright');
const OUT = __dirname + '/shots';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const BASE = 'http://localhost:8765';
const call = async (name, args, email) => JSON.parse(await (await fetch(BASE + '/api', { method: 'POST', body: JSON.stringify({ name, args, email }) })).text());
async function open(browser, dept, as, w = 1280, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } }), page = await ctx.newPage(), errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.goto(`${BASE}/page/${dept}?as=${as}`);
  await page.waitForSelector('#boards:not([hidden])', { timeout: 8000 });
  page.errs = errs; return page;
}
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
const toasts = p => p.$$eval('.toast span', s => s.map(x => x.textContent));
const tab = (p, re) => p.locator('#tabs button').filter({ hasText: re }).first().click();
async function type(p, input, text) { await input.click(); await input.fill(text); await p.waitForTimeout(150); await p.keyboard.press('Enter'); await p.waitForTimeout(100); }

(async () => {
  await fetch(BASE + '/reset');
  const browser = await chromium.launch();

  console.log('suppliers + manual PO + delete draft');
  let p = await open(browser, 'procurement', 'proc@x.com');
  await tab(p, /^Suppliers/); await p.waitForSelector('.board:not([hidden]) table.t tbody tr');
  const inputs = p.locator('.board:not([hidden]) .card input.inp');
  await inputs.nth(0).fill('Crystal Works'); await inputs.nth(2).fill('+91 99999 11111'); await inputs.nth(5).fill('Surat');
  await p.getByRole('button', { name: 'Save supplier' }).click(); await p.waitForTimeout(500);
  ok((await toasts(p)).some(t => /Supplier saved: Crystal Works/.test(t)), 'supplier saved: ' + (await toasts(p)));
  ok(await p.getByText('Crystal Works').first().isVisible(), 'supplier appears in the list');
  await shot(p, '50-suppliers');
  await tab(p, /^Purchase orders/); await p.waitForTimeout(300);
  await p.getByRole('button', { name: 'New purchase order' }).click(); await p.waitForSelector('.drawer .line');
  await type(p, p.locator('.drawer .card').first().locator('input.inp').first(), 'Crystal');
  await type(p, p.locator('.drawer .line .item input.inp').first(), 'MIRRORED');
  const nums = p.locator('.drawer .line .line-nums input');
  await nums.nth(1).fill('10'); await nums.nth(2).fill('55'); await nums.nth(3).fill('18');
  await p.waitForTimeout(200);
  const total = await p.locator('.drawer .dock .t1.g b').textContent();
  ok(total === 'Rs 649.00', 'live total for 1 pc x 10 sets x 55 + 18% GST: ' + total);
  await p.getByRole('button', { name: 'Save draft' }).click(); await p.waitForTimeout(600);
  ok((await toasts(p)).some(t => /Draft AE\/PO\/0001 saved/.test(t)), 'draft saved: ' + (await toasts(p)));
  ok(await p.getByText('Draft').first().isVisible(), 'draft visible in the list');
  await p.getByRole('button', { name: 'Edit' }).first().click(); await p.waitForSelector('.drawer .line');
  ok((await p.locator('.drawer-h h2').textContent()) === 'Edit AE/PO/0001', 'draft opens for editing');
  await shot(p, '51-edit-draft');
  await p.getByRole('button', { name: 'Delete draft' }).click();
  await p.locator('.modal').getByRole('button', { name: 'Delete' }).click(); await p.waitForTimeout(500);
  ok((await toasts(p)).some(t => /Draft deleted/.test(t)), 'draft deleted');
  ok((await p.textContent('body')).includes('No purchase orders yet'), 'list is empty again');
  ok(p.errs.length === 0 || (console.log(p.errs), false), 'no browser errors (procurement 2)');

  console.log('prepare stock through the API: accept -> PO -> send -> receive -> put away');
  await call('pq.decide', { ids: ['36b918d9'], decision: 'Accepted', supplierId: '6f43d3c3' }, 'proc@x.com');
  const po = (await call('po.save', { supplierId: '6f43d3c3', send: true, lines: [{ reqId: '36b918d9', itemCode: '100205', sets: 20, rate: 40, gst: 0.12 }, { itemCode: '100005', sets: 30, rate: 30, gst: 0.12 }] }, 'proc@x.com')).data;
  const gl = (await call('grn.list', {}, 'wh@x.com')).data.rows[0];
  const g = (await call('grn.get', { id: gl.id }, 'wh@x.com')).data;
  await call('grn.receive', { id: g.id, markReceived: true, lines: g.lines.map(l => ({ id: l.id, recSets: l.expSets, per: l.per })) }, 'wh@x.com');
  for (const r of (await call('put.list', {}, 'wh@x.com')).data.rows) await call('put.do', { lineId: r.id, location: 'FL1-ZA' }, 'wh@x.com');
  ok(po && po.sent, 'stock prepared');

  console.log('dispatch through the UI');
  p = await open(browser, 'warehouse', 'wh@x.com');
  await tab(p, /^Dispatch/); await p.waitForSelector('.board:not([hidden]) table.t tbody tr');
  await p.getByRole('button', { name: 'Open', exact: true }).first().click(); await p.waitForSelector('.dp .line');
  const selects = p.locator('.dp .line select');
  ok(await selects.count() === 2, 'two pick-from selects');
  for (let i = 0; i < 2; i++) await selects.nth(i).selectOption('FL1-ZA');
  await p.locator('.dp .line').nth(0).getByLabel('Picked').check(); await p.locator('.dp .line').nth(0).getByLabel('Packed').check();
  await p.locator('.dp .line').nth(1).getByLabel('Packed').check();   // ticking Packed also ticks Picked
  ok(await p.locator('.dp .line').nth(1).getByLabel('Picked').isChecked(), 'ticking Packed ticks Picked too');
  await p.getByRole('button', { name: 'Save pick & pack' }).click(); await p.waitForTimeout(600);
  ok((await p.textContent('.dp')).includes('Book transport'), 'panel now at the Book transport step');
  await shot(p, '52-dispatch-book');
  await p.getByRole('button', { name: 'Book transport' }).last().click(); await p.waitForTimeout(400);
  ok((await toasts(p)).some(t => /Enter the transporter/.test(t)), 'booking without a transporter is refused: ' + (await toasts(p)));
  await p.locator('.dp input[placeholder="Transporter / courier"]').fill('VRL Logistics');
  await p.getByRole('button', { name: 'Book transport' }).last().click(); await p.waitForTimeout(700);
  ok((await toasts(p)).some(t => /Transport booked with VRL/.test(t)), 'transport booked: ' + (await toasts(p)));
  await p.waitForSelector('.dp .pw-ship');
  await shot(p, '53-dispatch-ready');
  const ship = p.locator('.dp .pw-ship input');
  await ship.nth(0).fill('1');                              // part-ship the first line
  await p.getByRole('button', { name: 'Dispatch', exact: true }).click();
  await p.locator('.modal').getByRole('button', { name: 'Dispatch' }).click(); await p.waitForTimeout(800);
  ok((await toasts(p)).some(t => /Part of AE\/SO\/0001 dispatched/.test(t)), 'partial dispatch: ' + (await toasts(p)));
  await p.waitForSelector('.dp .pw-ship');
  await p.getByRole('button', { name: 'Dispatch', exact: true }).click();
  await p.locator('.modal').getByRole('button', { name: 'Dispatch' }).click(); await p.waitForTimeout(800);
  ok((await toasts(p)).some(t => /fully dispatched/.test(t)), 'full dispatch: ' + (await toasts(p)));
  ok((await p.textContent('.dp')).includes('Dispatched'), 'order panel shows the order dispatched');
  await shot(p, '54-dispatch-done');
  await p.getByRole('button', { name: /^Stock$/ }).click(); await p.waitForSelector('.board:not([hidden]) table.t tbody tr');
  const stockText = await p.textContent('.board:not([hidden]) table.t');
  ok(/100205/.test(stockText) && /100005/.test(stockText), 'stock lists both items');
  await shot(p, '55-stock-after');

  console.log('audit through the UI');
  await tab(p, /^Stock audit/); await p.waitForSelector('.board:not([hidden]) .card input.inp');
  const a = p.locator('.board:not([hidden]) .card');
  await type(p, a.first().locator('input.inp').nth(0), 'GRAVY');
  await type(p, a.first().locator('input.inp').nth(1), 'FL1-ZA');
  await a.first().locator('input[type=number]').fill('200');
  await p.getByRole('button', { name: 'Save count' }).click(); await p.waitForTimeout(600);
  ok((await toasts(p)).some(t => /Count saved/.test(t)), 'count saved: ' + (await toasts(p)));
  await shot(p, '56-audit-wh');
  ok(p.errs.length === 0 || (console.log(p.errs), false), 'no browser errors (warehouse 2)');
  const acc = await open(browser, 'accounts', 'acc@x.com');
  await acc.getByRole('button', { name: /^Stock audit/ }).click();
  await acc.waitForSelector('.board:not([hidden]) table.t tbody tr');
  const row = await acc.locator('.board:not([hidden]) table.t tbody tr').first().textContent();
  ok(/GRAVY BOAT/.test(row) && /FL1-ZA/.test(row), 'Accounts sees the count: ' + row.slice(0, 120));
  await shot(acc, '57-audit-acc');
  await acc.getByRole('button', { name: 'Approve', exact: true }).click();
  await acc.locator('.modal').getByRole('button', { name: 'Approve' }).click(); await acc.waitForTimeout(700);
  ok((await toasts(acc)).some(t => /Approved/.test(t)), 'approved: ' + (await toasts(acc)));
  const res = await call('stock.list', { filter: 'All', search: '100205' }, 'wh@x.com');
  ok(res.data.rows[0].wh === 200, 'ledger now matches the count: ' + res.data.rows[0].wh);
  ok(acc.errs.length === 0 || (console.log(acc.errs), false), 'no browser errors (accounts 2)');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });
