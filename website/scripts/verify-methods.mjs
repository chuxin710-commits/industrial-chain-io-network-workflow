import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchBrowser } from './browser.mjs';
import { ensurePreview } from './preview.mjs';
import { methods } from '../src/method-catalog.js';

const option = process.argv.indexOf('--base');
const base =
  option >= 0
    ? process.argv[option + 1].replace(/\/$/, '')
    : (await ensurePreview()).url.replace(/\/$/, '');
const folder = `.artifacts/methods/${option >= 0 ? 'public' : 'local'}`;
await mkdir(folder, { recursive: true });
const report = { base, at: new Date().toISOString(), errors: [], viewports: [] };
const browser = await launchBrowser();
async function method(page, id) {
  await page.evaluate((id) => (location.hash = 'methods/' + id), id);
  await page.waitForFunction(
    (id) => document.querySelector('#panel-methods').dataset.ready === id,
    id,
    { timeout: 60000 },
  );
  await page.evaluate(() => document.fonts.ready);
}
try {
  for (const viewport of [
    { width: 1440, height: 1050 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', (e) => report.errors.push(e.message));
    await page.goto(base + '/workspace.html#methods', { waitUntil: 'domcontentloaded' });
    await method(page, 'contract');
    assert.equal(await page.locator('[data-stage]').count(), 5);
    for (const m of methods) {
      await method(page, m.id);
      assert.equal(await page.locator('.method-formula-row').count(), m.formulas.length);
      assert.equal(await page.locator('.katex-error').count(), 0);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        m.id + ' page overflow',
      );
      assert.ok(await page.locator('.method-limits').isVisible());
      if (['contract', 'centrality', 'sir', 'mutualism'].includes(m.id))
        await page.screenshot({ path: `${folder}/${m.id}-${viewport.width}.png`, fullPage: true });
    }
    await page.fill('#method-search', 'SIR');
    await page.locator('#method-topics a[href="#methods/sir"]').click();
    await page.waitForFunction(
      () => document.querySelector('#panel-methods').dataset.ready === 'sir',
    );
    assert.equal(await page.locator('[data-stage="shock"]').getAttribute('aria-current'), 'step');
    await page.fill('#method-search', 'no-such-method');
    assert.ok(await page.locator('.method-no-match').isVisible());
    await page.click('[data-stage="network"]');
    await page.waitForFunction(
      () => document.querySelector('#panel-methods').dataset.ready === 'direct',
    );
    await page.fill('#method-search', 'no-such-method');
    await page.click('[data-stage="network"]');
    assert.equal(await page.locator('#method-topics a').count(), 3);
    await page.click('[data-demo-cell="2,0"]');
    assert.match(await page.locator('#method-demo-caption').innerText(), /W → U/);
    assert.equal(await page.locator('[data-demo-cell="2,0"]').getAttribute('aria-pressed'), 'true');
    await method(page, 'restore');
    const before = JSON.parse(await page.locator('#method-demo').getAttribute('data-frame'));
    await page.locator('#method-budget').fill('4');
    const after = JSON.parse(await page.locator('#method-demo').getAttribute('data-frame'));
    assert.equal(after.share, 1);
    assert.ok(after.efficiency[2] > before.efficiency[2]);
    assert.ok(Math.abs(after.efficiency[2] - after.efficiency[0]) < 1e-12);
    await page.screenshot({ path: `${folder}/recovery-${viewport.width}.png`, fullPage: true });
    const download = page.waitForEvent('download');
    await page.click('#method-export');
    const output = `${folder}/handbook-${viewport.width}.md`;
    await (await download).saveAs(output);
    const md = await readFile(output, 'utf8');
    for (const m of methods) assert.ok(md.includes(m.title));
    assert.ok(md.includes('SHA-256'));
    assert.ok(md.includes('W_{ji}'));
    assert.ok(md.includes('2000–2023'));
    assert.ok(md.includes('### 计算顺序'));
    // Method navigation is static and remains available when the database service fails.
    await page.route('**/api/**', (r) =>
      r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"QA offline"}' }),
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await method(page, 'leontief');
    assert.ok((await page.locator('.method-formula-row').count()) > 0);
    report.viewports.push({
      ...viewport,
      methods: methods.length,
      mathRendered: true,
      noOverflow: true,
      search: true,
      demo: true,
      export: true,
      offline: true,
    });
    await page.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
