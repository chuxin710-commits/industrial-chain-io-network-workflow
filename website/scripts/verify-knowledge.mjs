import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser } from './browser.mjs';

// Private flow generation is covered by verify-literature-ai and research-flow.test.
const index = process.argv.indexOf('--base');
const base = index >= 0 ? process.argv[index + 1] : 'http://127.0.0.1:5188';
const folder = '.artifacts/knowledge';
await mkdir(folder, { recursive: true });
const browser = await launchBrowser();
const report = { base, at: new Date().toISOString(), viewports: [], errors: [] };
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', (error) => report.errors.push(error.message));
    await page.goto(`${base}/workspace.html#knowledge`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('#framework-corpus a').waitFor();
    assert.equal(await page.locator('a[data-panel="knowledge"] svg').count(), 1);
    assert.equal(await page.locator('#kg-data-tab').count(), 0);
    await page.click('#kg-flow-tab');
    await page.locator('#flow-empty').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#flow-content').isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: `${folder}/empty-${width}.png`, fullPage: true });
    await page.click('#flow-start');
    assert.equal(await page.locator('#kg-method-tab').getAttribute('aria-selected'), 'true');
    await page.locator('#kg-method-tab').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#kg-flow-tab').getAttribute('aria-selected'), 'true');
    report.viewports.push({ width, emptyState: true, keyboardTabs: true, noOverflow: true });
    await page.close();
  }
  assert.deepEqual(report.errors, []);
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
