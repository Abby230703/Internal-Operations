'use strict';
const { chromium } = require('playwright');
const OUT = __dirname + '/shots';
require('fs').mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const BASE = 'http://localhost:8765';

async function open(browser, dept, as, w = 1280, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } }), page = await ctx.newPage(), errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.goto(`${BASE}/page/${dept}?as=${as}`);
  await page.waitForSelector('#boards:not([hidden])', { timeout: 8000 });
  page.errs = errs;
  return page;
}
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
const tabs = page => page.$$eval('#tabs button', bs => bs.map(b => b.textContent.replace(/\s+/g, ' ').trim()));
async function pickCombo(page, scope, text) { // type into a combo input and take the first match
  const inp = scope.locator('input.inp').first();
  await inp.click(); await inp.fill(text); await page.waitForTimeout(150); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
}
const toasts = page => page.$$eval('.toast span', s => s.map(x => x.textContent));

(async () => {
  await fetch(BASE + '/reset');
  const browser = await chromium.launch();

  console.log('procurement');
  let p = await open(browser, 'procurement', 'proc@x.com');
  ok((await tabs(p)).join('|').replace(/\d+/g, '#') === 'Purchase queue#|Purchase orders|Suppliers', 'procurement tabs: ' + (await tabs(p)).join('|'));
  ok((await p.textContent('#path')).trim() === 'Procurement / Purchase queue', 'breadcrumb: ' + (await p.textContent('#path')));
  ok((await p.textContent('#dept-btn')).includes('Procurement'), 'department chip says Procurement');
  ok(!(await p.isVisible('#gs')), 'Sales customer search is hidden');
  await p.waitForSelector('.board:not([hidden]) table.t tbody tr');
  await shot(p, '01-proc-queue');
  ok(await p.locator('#tabs button.on .n').textContent() === '2', 'queue tab bubble shows 2 awaiting');
  // no supplier field in the review table or the top-up form
  ok((await p.locator('.quick select').count()) === 0, 'top-up form has no supplier field');
  ok(!(await p.locator('.board:not([hidden]) table.t tbody select').count()), 'review table has no supplier drop-down');
  ok(!((await p.$$eval('.board:not([hidden]) table.t thead th', t => t.map(x => x.textContent))).includes('Supplier')), 'review table has no supplier column');
  // accept = supplier pop-up
  await p.getByRole('button', { name: 'Accept', exact: true }).first().click();
  await p.waitForSelector('.modal');
  await shot(p, '06-proc-accept-popup');
  await p.locator('.modal').getByRole('button', { name: 'Accept', exact: true }).click(); await p.waitForTimeout(300);
  ok((await toasts(p)).some(t => /Pick the supplier from the list/.test(t)), 'accept without a supplier is refused in the pop-up: ' + (await toasts(p)));
  const mi = p.locator('.modal input.inp').first(); await mi.click(); await mi.fill('Aria'); await p.waitForTimeout(200);
  ok(await p.locator('.combo-list .opt').first().isVisible(), 'supplier list is visible above the pop-up');
  await p.keyboard.press('Enter');
  await p.locator('.modal').getByRole('button', { name: 'Accept', exact: true }).click(); await p.waitForTimeout(500);
  ok((await toasts(p)).some(t => /Accepted 1 requirement/.test(t)), 'accept toast: ' + (await toasts(p)));
  // the other one: accept with a supplier that is not in the list yet
  await p.getByRole('button', { name: 'Accept', exact: true }).first().click(); await p.waitForSelector('.modal');
  await p.getByRole('button', { name: 'Not in the list? Add a new supplier' }).click();
  await p.locator('.modal input[placeholder="Supplier company name"]').fill('Brand New Traders');
  await p.locator('.modal').getByRole('button', { name: 'Accept', exact: true }).click(); await p.waitForTimeout(700);
  ok((await toasts(p)).some(t => /Supplier added: Brand New Traders/.test(t)), 'new supplier added from the pop-up');
  // accepted view: highlighted, banner, chip
  await p.getByRole('button', { name: /^Accepted/ }).first().click(); await p.waitForTimeout(400);
  ok((await p.locator('tr.pw-ready').count()) === 2, 'accepted rows are highlighted: ' + (await p.locator('tr.pw-ready').count()));
  ok(await p.locator('.pw-banner').isVisible(), 'banner says they are not ordered yet');
  ok(await p.locator('.seg-b.pw-hot').count() === 1, 'the Accepted chip is highlighted');
  ok((await p.textContent('table.t tbody')).includes('Brand New Traders'), 'supplier name shown as text on the accepted row');
  await shot(p, '07-proc-accepted-highlight');
  await p.locator('thead input[type=checkbox]').check();
  await p.waitForSelector('.pw-bar:not([hidden])');
  await shot(p, '02-proc-bulk');
  await p.getByRole('button', { name: 'Make purchase order' }).click();
  await p.waitForSelector('.drawer');
  await p.waitForTimeout(500);
  ok((await p.textContent('.drawer-h h2')).includes('New purchase order'), 'PO drawer opens');
  ok((await p.locator('.drawer .line').count()) >= 1, 'PO drawer has the requirement lines');
  // set rate on every line, pick the supplier if empty
  const sup = p.locator('.drawer .card').first().locator('input.inp').first();
  if (!(await sup.inputValue())) { await sup.click(); await sup.fill('Ariane'); await p.waitForTimeout(150); await p.keyboard.press('Enter'); }
  const rates = p.locator('.drawer .line-nums > div:nth-child(3) input');
  for (let i = 0; i < await rates.count(); i++) await rates.nth(i).fill('40');
  await p.waitForTimeout(200);
  await shot(p, '03-proc-po-drawer');
  await p.getByRole('button', { name: 'Save & send' }).click();
  await p.locator('.modal').getByRole('button', { name: 'Save & send' }).click();
  await p.waitForTimeout(700);
  ok((await toasts(p)).some(t => /Purchase order AE\/PO\/0001 sent/.test(t)), 'send toast: ' + (await toasts(p)));
  await shot(p, '04-proc-po-list');
  ok(await p.getByText('Awaiting delivery').first().isVisible(), 'PO listed as awaiting delivery');
  // suppliers tab
  await p.getByRole('button', { name: /^Suppliers/ }).click(); await p.waitForTimeout(300);
  await shot(p, '05-proc-suppliers');
  ok((await p.textContent('#path')).trim() === 'Procurement / Suppliers', 'breadcrumb follows the tab');
  ok((p.errs.length === 0) || (console.log(p.errs), false), 'no browser errors (procurement)');

  console.log('warehouse');
  p = await open(browser, 'warehouse', 'wh@x.com');
  ok((await tabs(p)).join('|').replace(/\d+/g, '#') === 'Receiving#|Put-away|Dispatch#|Stock|Stock audit', 'warehouse tabs: ' + (await tabs(p)).join('|'));
  await p.waitForSelector('.board:not([hidden]) table.t tbody tr');
  await shot(p, '10-wh-receiving');
  await p.getByRole('button', { name: 'Receive', exact: true }).first().click();
  await p.waitForSelector('.drawer .line'); await p.waitForTimeout(300);
  await shot(p, '11-wh-count');
  await p.getByRole('button', { name: 'Fill all as ordered' }).click();
  await p.locator('.drawer input[type=text]').first().fill('INV-1');
  await p.getByRole('button', { name: 'Mark as received' }).first().click();
  await p.locator('.modal').getByRole('button', { name: 'Mark as received' }).click();
  await p.waitForTimeout(600);
  ok((await toasts(p)).some(t => /marked as received/.test(t)), 'received toast: ' + (await toasts(p)));
  // put-away
  await p.getByRole('button', { name: /^Put-away/ }).click(); await p.waitForSelector('.board:not([hidden]) table.t tbody tr');
  const rows = await p.locator('.board:not([hidden]) table.t tbody tr').count();
  ok(rows >= 1, 'put-away rows: ' + rows);
  const loc = p.locator('.board:not([hidden]) table.t tbody tr').first().locator('input.inp').first();
  await loc.click(); await loc.fill('FL1-ZA'); await p.waitForTimeout(150); await p.keyboard.press('Enter');
  await shot(p, '12-wh-putaway');
  await p.locator('.board:not([hidden]) table.t tbody tr').first().getByRole('button', { name: 'Put away', exact: true }).click(); await p.waitForTimeout(500);
  ok((await toasts(p)).some(t => /put away at FL1-ZA/.test(t)), 'put-away toast: ' + (await toasts(p)));
  // stock
  await p.getByRole('button', { name: /^Stock$/ }).click(); await p.waitForSelector('.board:not([hidden]) table.t tbody tr');
  await shot(p, '13-wh-stock');
  await p.getByRole('button', { name: 'History', exact: true }).first().click(); await p.waitForSelector('.modal'); await shot(p, '14-wh-history'); await p.keyboard.press('Escape');
  // dispatch
  await p.getByRole('button', { name: /^Dispatch/ }).click(); await p.waitForSelector('.board:not([hidden]) table.t tbody tr');
  await p.getByRole('button', { name: 'Open', exact: true }).first().click(); await p.waitForSelector('.dp .line');
  await shot(p, '15-wh-dispatch-open');
  ok((await p.locator('.dp .line').count()) === 2, 'order panel shows its 2 lines');
  ok((p.errs.length === 0) || (console.log(p.errs), false), 'no browser errors (warehouse)');

  console.log('admin menu');
  p = await open(browser, 'procurement', 'admin@x.com');
  await p.click('#dept-btn');
  const items = await p.$$eval('#dept-menu .mi', m => m.map(x => x.tagName + ':' + x.textContent.replace(/\s+/g, ' ').trim().slice(0, 18) + (x.disabled ? ':off' : '')));
  ok(items.length === 5 && items[0].startsWith('A:S') && items[1].startsWith('BUTTON:P') && items[2].startsWith('A:W') && items[3].startsWith('A:A') && items[4].startsWith('A:A'), 'admin menu links all five: ' + items.join(' | '));
  await shot(p, '30-admin-menu');
  ok((p.errs.length === 0) || (console.log(p.errs), false), 'no browser errors (admin)');

  console.log('mobile');
  p = await open(browser, 'warehouse', 'wh@x.com', 390, 800);
  await p.waitForSelector('table.t tbody tr, .empty'); await shot(p, '40-mobile-warehouse');
  await p.close();

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });
