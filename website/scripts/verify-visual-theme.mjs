import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser } from './browser.mjs';
import { ensurePreview } from './preview.mjs';
import { ensureApi } from './api-preview.mjs';

const option = process.argv.indexOf('--base');
const base = (option < 0 ? (await ensurePreview()).url : process.argv[option + 1]).replace(/\/$/, '');
if (option < 0) await ensureApi();
const output = '.artifacts/visual-theme';
await mkdir(output, { recursive: true });
const browser = await launchBrowser();
const report = { base, checks: [], errors: [] };
try {
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', e => report.errors.push(e.message));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.chainlabReady);
    await page.waitForFunction(() => !document.querySelector('.hero-center').classList.contains('is-entering'));
    const hero = await page.evaluate(() => {
      const box = s => { const r = document.querySelector(s).getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom }; };
      return { hero:box('.hero'), entry:box('.portal-entry'), header:box('.site-header'), briefing:box('.briefing-hero-entry'), bottom:box('.hero-bottom'), overflow:document.documentElement.scrollWidth > innerWidth + 1, brand:getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() };
    });
    assert.equal(hero.overflow, false);
    assert.equal(hero.brand, '#205ecf');
    assert.ok(hero.hero.bottom < viewport.height, 'Next section stays visible');
    assert.ok(hero.entry.y > hero.header.bottom, 'Main entry clears navigation');
    assert.ok(hero.briefing.bottom < hero.bottom.y, 'Briefing entry clears film controls');
    assert.ok(hero.briefing.y >= hero.entry.bottom + 8, 'Hero destinations must not overlap');
    assert.ok(hero.entry.x >= 0 && hero.entry.right <= viewport.width);
    await page.screenshot({ path: `${output}/home-${viewport.width}.png` });
    await page.locator('#motion-toggle').click();
    assert.ok(await page.locator('#hero-video').evaluate(v => v.paused));
    await page.locator('#watch-film').click();
    assert.ok(await page.locator('#film-dialog').evaluate(d => d.open));
    await page.keyboard.press('Escape');
    if (viewport.width === 1440 || viewport.width === 390) {
      for (const type of ['mechanism','network','globe','resilience','evidence','briefing']) {
        const art = page.locator(`[data-scene="${type}"]`);
        await art.scrollIntoViewIfNeeded();
        await page.waitForFunction(type => !!window.chainlabModules[type], type);
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${output}/scene-${type}-${viewport.width}.png` });
      }
    }
    for (const panel of ['database','methods/direct','topology','knowledge','literature','overview','projects','verification']) {
      await page.goto(`${base}/workspace.html#${panel}`, { waitUntil: 'domcontentloaded' });
      await page.locator('#service-status.is-connected').waitFor({ state: 'attached' });
      await page.waitForTimeout(350);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${panel} overflow ${viewport.width}`);
      await page.screenshot({ path: `${output}/${panel.replace('/','-')}-${viewport.width}.png` });
    }
    await page.goto(`${base}/briefing.html`, { waitUntil: 'domcontentloaded' });
    await page.locator('.masthead').waitFor();
    await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${output}/briefing-${viewport.width}.png` });
    report.checks.push({ viewport, hero, noOverflow:true });
    await page.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
