const { chromium } = require('playwright');
const BASE = 'http://localhost:8765';
(async () => {
  const b = await chromium.launch(), p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage(), errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await fetch(BASE + '/reset');
  await p.goto(BASE + '/page/sales?as=sales@x.com');
  await p.waitForSelector('#boards:not([hidden])');
  await p.getByRole('button', { name: /Quote/ }).first().click(); await p.waitForTimeout(500);
  const party = p.locator('.board:not([hidden]) input.inp').first(); await party.click(); await party.fill('Glass'); await p.waitForTimeout(300); await p.keyboard.press('Enter');
  const item = p.locator('.board:not([hidden]) .line input.inp').first(); await item.click(); await item.fill('MONTAVO'); await p.waitForTimeout(300); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  const nums = p.locator('.board:not([hidden]) .line-nums input');
  console.log('initial', await nums.evaluateAll(x => x.map(i => i.type + '=' + JSON.stringify(i.value))));
  for (const [i, name] of [[0, 'Pcs/set'], [1, 'Total pcs'], [2, 'Sets'], [3, 'List']]) {
    await nums.nth(i).click(); await p.keyboard.type('20', { delay: 60 }); await p.waitForTimeout(150);
    console.log(name, '->', JSON.stringify(await nums.nth(i).inputValue()), '| all:', JSON.stringify(await nums.evaluateAll(x => x.map(e => e.value))));
    await nums.nth(i).fill('');
  }
  console.log('errs', errs);
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
