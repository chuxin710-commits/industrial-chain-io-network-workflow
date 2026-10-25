import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser } from './browser.mjs';
import { ensurePreview } from './preview.mjs';
const arg = process.argv.indexOf('--base');
const base = arg < 0 ? (await ensurePreview()).url : process.argv[arg + 1];
const folder = `.artifacts/briefing-scene/${arg < 0 ? 'local' : 'public'}`;
await mkdir(folder, { recursive: true });
const browser = await launchBrowser();
const results = [];
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/#daily-briefing');
    await page.locator('[data-scene="briefing"]').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => window.chainlabModules?.briefing);
    await page.waitForTimeout(700);
    const check = await page.evaluate(() => {
      const scene = window.chainlabModules.briefing;
      scene.setPaused(true);
      function pixels(t) {
        scene.renderAt(t);
        const c = document.createElement('canvas');
        c.width = 256;
        c.height = 256;
        const ctx = c.getContext('2d');
        ctx.drawImage(document.querySelector('[data-scene="briefing"] canvas'), 0, 0, 256, 256);
        return ctx.getImageData(0, 0, 256, 256).data;
      }
      const a = pixels(1),
        b = pixels(4);
      let nonblank = 0,
        changed = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (Math.abs(a[i] - a[0]) + Math.abs(a[i + 1] - a[1]) + Math.abs(a[i + 2] - a[2]) > 35)
          nonblank++;
        if (
          Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) >
          20
        )
          changed++;
      }
      return {
        nonblank,
        changed,
        state: scene.getState(),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    assert.ok(check.nonblank > 1800);
    assert.ok(check.changed > 150);
    assert.equal(check.overflow, false);
    for (const [key, v] of Object.entries(check.state.bounds))
      assert.ok(Math.abs(v) < 0.98, key + ': ' + v);
    const box = await page.locator('[data-scene="briefing"]').boundingBox();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3);
    assert.ok(await page.evaluate(() => window.chainlabModules.briefing.pointer.x > 0.4));
    await page.locator('[data-scene="briefing"] button').click();
    assert.equal(await page.evaluate(() => window.chainlabModules.briefing.isPaused()), false);
    await page.locator('[data-scene="briefing"] button').click();
    if (width === 1440) {
      await page.locator('#daily-briefing').screenshot({ path: `${folder}/section.png` });
      if (arg < 0) {
        const uri = await page.evaluate(() => window.chainlabModules.briefing.getFrame());
        await writeFile(
          'public/media/research-briefing.jpg',
          Buffer.from(uri.split(',')[1], 'base64'),
        );
      }
    } else
      await page.locator('#daily-briefing').screenshot({ path: `${folder}/section-${width}.png` });
    assert.deepEqual(errors, []);
    results.push({ width, ...check });
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(`${folder}/report.json`, JSON.stringify(results, null, 2));
}
console.log(JSON.stringify(results));
