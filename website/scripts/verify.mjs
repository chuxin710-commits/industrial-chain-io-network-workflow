import { createServer, preview } from 'vite';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchBrowser } from './browser.mjs';
import assert from 'node:assert/strict';
import { FILM_SHOTS, SHOT_DURATION } from '../src/film-storyboard.js';

await mkdir('.artifacts/site', { recursive: true });
const production = process.argv.includes('--production');
const live = process.argv.includes('--live');
const server = live
  ? null
  : production
    ? await preview({ preview: { port: 0, host: '127.0.0.1' }, logLevel: 'error' })
    : await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
if (server && !production) await server.listen();
const base = live
  ? (await import('./preview.mjs').then(({ ensurePreview }) => ensurePreview())).url
  : `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await launchBrowser();
const report = {
  base,
  mode: live ? 'live' : production ? 'production' : 'development',
  viewports: [],
  interactions: [],
  errors: [],
};
try {
  const viewports = [
    { width: 1440, height: 960 },
    { width: 1920, height: 1080 },
    { width: 390, height: 844 },
    { width: 375, height: 812 },
    { width: 844, height: 390 },
    { width: 320, height: 568 },
  ];
  for (const viewport of production ? viewports.slice(0, 1) : viewports) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => report.errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.chainlabReady);
    assert.equal(
      await page.evaluate(() => !!window.chainlabScene),
      false,
      'Below-fold 3D scene must not delay the first screen',
    );
    await page.waitForFunction(() => document.querySelector('#hero-video').readyState >= 3);
    await page.waitForTimeout(1600);
    const hero = await page.evaluate(() => {
      const v = document.querySelector('#hero-video'),
        hero = document.querySelector('.hero').getBoundingClientRect(),
        entry = document.querySelector('.portal-entry').getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        video: { width: v.videoWidth, height: v.videoHeight, muted: v.muted, paused: v.paused },
        heroBottom: hero.bottom,
        entry: { x: entry.x, y: entry.y, width: entry.width, height: entry.height },
      };
    });
    assert.equal(hero.overflow, false);
    assert.equal(hero.video.width, 1920);
    assert.equal(hero.video.height, 1080);
    assert.equal(hero.video.muted, true);
    assert.match(
      await page.locator('#hero-video').evaluate((v) => v.currentSrc),
      /background-v2-1080p30/,
    );
    assert.ok(hero.heroBottom < viewport.height, 'Next section must peek into the first viewport');
    assert.ok(hero.entry.x >= 0 && hero.entry.x + hero.entry.width <= viewport.width);
    assert.ok(hero.entry.y >= 0 && hero.entry.y + hero.entry.height <= hero.heroBottom);
    await page.screenshot({ path: `.artifacts/site/hero-${viewport.width}.png` });
    await page.locator('#motion-toggle').click();
    assert.equal(await page.locator('#hero-video').evaluate((v) => v.paused), true);
    await page.locator('#motion-toggle').click();
    await page.waitForFunction(() => !document.querySelector('#hero-video').paused);
    await page.locator('#sound-toggle').click();
    assert.equal(await page.locator('#hero-video').evaluate((v) => v.muted), false);
    await page.locator('#sound-toggle').click();
    if (viewport.width === 1440 || viewport.width === 390) {
      await page.locator('#motion-toggle').click();
      for (let index = 0; index < FILM_SHOTS.length; index++) {
        await page.locator('#hero-video').evaluate(
          (v, t) => {
            v.currentTime = t;
          },
          index * SHOT_DURATION + 2,
        );
        await page.waitForFunction(
          (cn) => document.querySelector('#chapter-cn').textContent === cn,
          FILM_SHOTS[index].cn,
        );
        await page.waitForFunction(() => !document.querySelector('#hero-video').seeking);
        await page.waitForTimeout(750);
        const overlaps = await page.evaluate(() => {
          const a = document.querySelector('.hero-chapter').getBoundingClientRect();
          const b = document.querySelector('.portal-entry').getBoundingClientRect();
          return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        });
        assert.equal(overlaps, false, 'Scene captions must not cover the central entry');
        await page.screenshot({ path: `.artifacts/site/scene-${index + 1}-${viewport.width}.png` });
      }
      await page.locator('#hero-video').evaluate((v) => {
        v.currentTime = 0;
      });
      await page.locator('#motion-toggle').click();
    }
    await page.locator('#watch-film').click();
    assert.equal(await page.locator('#film-dialog').evaluate((d) => d.open), true);
    await page.waitForFunction(() => document.querySelector('#film-player').readyState >= 3);
    assert.equal(await page.locator('#hero-video').evaluate((v) => v.paused), true);
    await page.screenshot({ path: `.artifacts/site/film-${viewport.width}.png` });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#film-dialog').evaluate((d) => d.open), false);
    await page.locator('.portal-entry').click();
    await page.waitForURL('**/workspace.html');
    assert.equal(await page.locator('h1').textContent(), '科研工作台');
    assert.equal(await page.locator('.case-link').count(), 2);
    await page.screenshot({
      path: `.artifacts/site/workspace-${viewport.width}.png`,
      fullPage: true,
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.chainlabReady);
    await page.mouse.wheel(0, 620);
    await page.waitForTimeout(90);
    const earlyScroll = await page.evaluate(() => scrollY);
    await page.waitForTimeout(1400);
    const settledScroll = await page.evaluate(() => scrollY);
    assert.ok(settledScroll > 200, 'Wheel scroll must enter the content');
    assert.ok(
      settledScroll >= earlyScroll,
      'Smooth scroll must progress without jumping backwards',
    );
    await page.locator('#research').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `.artifacts/site/features-${viewport.width}.png` });
    await page.locator('#foundation').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1300);
    await page.waitForFunction(() => !!window.chainlabScene);
    const pixels = await page.evaluate(() => {
      const scene = window.chainlabScene,
        c = document.querySelector('#network-canvas');
      const p = document.createElement('canvas');
      p.width = c.width;
      p.height = c.height;
      const ctx = p.getContext('2d');
      const frame = (time) => {
        scene.renderAt(time);
        ctx.drawImage(c, 0, 0);
        return ctx.getImageData(0, 0, p.width, p.height).data;
      };
      const a = frame(3),
        b = frame(8);
      let bright = 0,
        changed = 0;
      for (let i = 0; i < a.length; i += 16) {
        if (a[i] + a[i + 1] + a[i + 2] > 105) bright++;
        if (
          Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) >
          10
        )
          changed++;
      }
      scene.pointer.set(0.8, 0.3);
      const d = frame(3);
      let interactive = 0;
      for (let i = 0; i < a.length; i += 16)
        if (
          Math.abs(a[i] - d[i]) + Math.abs(a[i + 1] - d[i + 1]) + Math.abs(a[i + 2] - d[i + 2]) >
          10
        )
          interactive++;
      scene.pointer.set(0, 0);
      return {
        width: c.width,
        height: c.height,
        brightPixels: bright,
        changedPixels: changed,
        pointerChangedPixels: interactive,
      };
    });
    assert.ok(pixels.brightPixels > 300, '3D scene must be nonblank');
    assert.ok(pixels.changedPixels > 200, '3D scene must move');
    assert.ok(pixels.pointerChangedPixels > 100, '3D scene must respond to pointer');
    await page.screenshot({ path: `.artifacts/site/foundation-${viewport.width}.png` });
    await page.locator('.closing-section').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `.artifacts/site/full-${viewport.width}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    report.viewports.push({
      ...viewport,
      hero,
      pixels,
      overflow,
      scroll: { early: earlyScroll, settled: settledScroll },
    });
    await page.close();
  }
  const reduced = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  await reduced.goto(base, { waitUntil: 'domcontentloaded' });
  await reduced.waitForFunction(() => window.chainlabReady);
  assert.equal(await reduced.locator('#hero-video').evaluate((v) => v.paused), true);
  await reduced.locator('#watch-film').click();
  const [download] = await Promise.all([
    reduced.waitForEvent('download'),
    reduced.locator('.film-dialog-footer a[download]').click(),
  ]);
  assert.equal(download.suggestedFilename(), 'chainlab-concept-v2-1080p30.mp4');
  const downloaded = await readFile(await download.path());
  const filmManifest = JSON.parse(await readFile('public/media/film-v2-manifest.json', 'utf8'));
  assert.equal(createHash('sha256').update(downloaded).digest('hex'), filmManifest.sha256);
  report.download = { bytes: downloaded.length, sha256: filmManifest.sha256 };
  report.interactions = [
    'entry route',
    'audio toggle',
    'background play/pause',
    'film modal and Escape close',
    'download link',
    'scroll reveals',
    '3D motion and pointer response',
    'reduced-motion pause',
    'eight-scene V2 media and synchronized captions',
  ];
  assert.equal(report.errors.length, 0, report.errors.join('\n'));
  await writeFile(
    `.artifacts/site/verification${live ? '-live' : production ? '-production' : ''}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  if (server && production) await new Promise((resolve) => server.httpServer.close(resolve));
  else if (server) await server.close();
}
