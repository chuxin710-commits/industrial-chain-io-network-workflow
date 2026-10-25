import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchBrowser } from './browser.mjs';

const option = process.argv.indexOf('--base');
assert.ok(option >= 0 && process.argv[option + 1], 'Use --base https://your-domain');
const base = new URL(process.argv[option + 1]).origin;
const report = { base, checkedAt: new Date().toISOString(), viewports: [], errors: [] };
const browser = await launchBrowser();
await mkdir('.artifacts/deployment', { recursive: true });

async function capture(page, selector, scene, time) {
  // Render and sample in one browser task before the WebGL drawing buffer is cleared.
  return page.evaluate(
    ({ target, scene, time }) => {
      if (scene) window.chainlabModules[scene].renderAt(time);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 160;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(document.querySelector(target), 0, 0, 160, 160);
      return Array.from(ctx.getImageData(0, 0, 160, 160).data);
    },
    { target: selector, scene, time },
  );
}

function different(a, b) {
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 20)
      count++;
  }
  return count;
}

function foreground(pixels) {
  return different(
    pixels,
    Array.from({ length: pixels.length }, (_, i) => pixels[i % 4]),
  );
}

try {
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', (error) => report.errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`);
    });
    assert.equal((await page.goto(base, { waitUntil: 'domcontentloaded' })).status(), 200);
    await page.waitForFunction(() => window.chainlabReady);
    await page.waitForFunction(() => document.querySelector('#hero-video').readyState >= 3, null, {
      timeout: 120000,
    });
    const video = await page.locator('#hero-video').evaluate((v) => ({
      width: v.videoWidth,
      height: v.videoHeight,
      paused: v.paused,
      time: v.currentTime,
    }));
    assert.equal(video.width, 1920);
    assert.equal(video.height, 1080);
    assert.equal(video.paused, false);
    const before = await capture(page, '#hero-video');
    await page.waitForTimeout(900);
    const after = await capture(page, '#hero-video');
    assert.ok(foreground(after) > 1000, 'Movie must contain visible imagery');
    assert.ok(different(before, after) > 100, 'Movie must play, not just show its poster');
    await page.screenshot({ path: `.artifacts/deployment/home-${viewport.width}.png` });
    const scenes = [];
    for (const type of ['mechanism', 'network', 'globe', 'resilience', 'evidence']) {
      const art = page.locator(`[data-scene="${type}"]`);
      await art.scrollIntoViewIfNeeded();
      await page.waitForFunction((t) => !!window.chainlabModules[t], type);
      await page.evaluate((t) => window.chainlabModules[t].setPaused(true), type);
      const a = await capture(page, `[data-scene="${type}"] canvas`, type, 3);
      const b = await capture(page, `[data-scene="${type}"] canvas`, type, 8);
      const visible = foreground(b),
        moving = different(a, b);
      assert.ok(visible > 300, `${type} must not be blank`);
      assert.ok(moving > 30, `${type} must animate`);
      await art.screenshot({ path: `.artifacts/deployment/${type}-${viewport.width}.png` });
      scenes.push({ type, foregroundPixels: visible, movingPixels: moving });
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.locator('.portal-entry').click();
    await page.waitForURL('**/workspace.html');
    await page.locator('#io-table:not([hidden])').waitFor();
    const health = await page.evaluate(async () => (await fetch('/api/health')).json());
    assert.equal(health.complete_year_coverage, true);
    assert.equal(health.year_count, 24);
    report.viewports.push({ ...viewport, video, scenes, entryNavigation: true, health });
    await page.close();
  }
  assert.deepEqual(report.errors, []);
  const workspace = JSON.parse(
    await readFile('.artifacts/workspace/verification-public.json', 'utf8'),
  );
  assert.equal(workspace.base, base);
  report.workspaceChecks = workspace.checks;
  report.network = {
    browser: 'Browser-native HTTPS requests using the client network configuration',
    scope:
      'One client environment; independent raw-direct connectivity is not tested by this script',
  };
  await writeFile(
    '.artifacts/deployment/verification-public.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
