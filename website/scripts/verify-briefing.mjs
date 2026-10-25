import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser } from './browser.mjs';
import { ensurePreview } from './preview.mjs';
const i = process.argv.indexOf('--base');
const base = i >= 0 ? process.argv[i + 1] : (await ensurePreview()).url;
const folder = `.artifacts/briefing/${i >= 0 ? 'public' : 'local'}`;
await mkdir(folder, { recursive: true });
const browser = await launchBrowser();
const report = { base, errors: [], viewports: [] };
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    page.on('pageerror', (e) => report.errors.push(e.message));
    if (i < 0) {
      const d = JSON.parse(await readFile('.artifacts/briefing/data/latest.json', 'utf8'));
      d.status = 'ready';
      d.last_attempt = d;
      const body = JSON.stringify({ ...d, last_attempt: { feeds: d.feeds } });
      await page.route('**/api/briefing', (r) => r.fulfill({ json: JSON.parse(body) }));
    }
    await page.goto(base + '/briefing.html');
    await page.waitForSelector('article');
    assert.ok((await page.locator('article').count()) > 0);
    assert.ok((await page.locator('article').count()) <= 30);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${folder}/briefing-${width}.png` });
    await page.locator('.tabs [data-category="ai"]').click();
    assert.ok(
      (await page.locator('article .topic').allTextContents()).every((t) => t.includes('AI')),
    );
    await page.fill('#search', 'no-unlikely-news-123');
    assert.equal(await page.locator('article').count(), 0);
    await page.fill('#search', '');
    await page.locator('.tabs [data-category="all"]').click();
    if (await page.locator('#more').isVisible()) {
      const before = await page.locator('article').count();
      await page.click('#more');
      assert.ok((await page.locator('article').count()) > before);
    }
    await page.route('**/api/briefing', (r) => r.fulfill({ status: 503, body: 'offline' }));
    await page.click('#refresh');
    await page.waitForFunction(() =>
      document.querySelector('#status').textContent.includes('无法读取'),
    );
    assert.ok((await page.locator('article').count()) > 0);
    await page.goto(base + '/');
    await page.waitForSelector('.briefing-hero-entry');
    await page.waitForTimeout(2200);
    assert.ok((await page.locator('#daily-briefing a').count()) > 0);
    await page.screenshot({ path: `${folder}/home-${width}.png` });
    report.viewports.push({
      width,
      render: true,
      filter: true,
      search: true,
      more: true,
      errorRetention: true,
      homepageEntry: true,
    });
    await page.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
