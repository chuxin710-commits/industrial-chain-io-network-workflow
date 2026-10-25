import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.mjs';
import { ensurePreview } from './preview.mjs';

const production = process.argv.includes('--production');
const posters = process.argv.includes('--posters');
const desktop = process.argv.includes('--desktop');
const comments = process.argv.includes('--comments');
const foundation = process.argv.includes('--foundation');
const server = production
  ? await preview({ preview: { port: 0, host: '127.0.0.1' }, logLevel: 'error' })
  : null;
const base = server
  ? `http://127.0.0.1:${server.httpServer.address().port}`
  : (await ensurePreview()).url;
const browser = await launchBrowser();
const types = foundation
  ? ['mechanism']
  : comments
    ? ['mechanism', 'resilience']
    : ['mechanism', 'network', 'globe', 'resilience', 'evidence'];
const report = { base, production, viewports: [], errors: [] };
await mkdir('.artifacts/research', { recursive: true });

async function sample(page, type, time) {
  return page.evaluate(
    ({ type, time }) => {
      if (typeof time === 'number') window.chainlabModules[type].renderAt(time);
      else window.chainlabModules[type].getFrame();
      const source = document.querySelector(`[data-scene="${type}"] canvas`);
      const capture = document.createElement('canvas');
      capture.width = 256;
      capture.height = 256;
      const ctx = capture.getContext('2d');
      ctx.drawImage(source, 0, 0, 256, 256);
      return Array.from(ctx.getImageData(0, 0, 256, 256).data);
    },
    { type, time },
  );
}

function changed(a, b) {
  let pixels = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 18)
      pixels++;
  }
  return pixels;
}

function nonblank(a) {
  let pixels = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - a[0]) + Math.abs(a[i + 1] - a[1]) + Math.abs(a[i + 2] - a[2]) > 35)
      pixels++;
  }
  return pixels;
}

try {
  const sizes = production
    ? [
        { width: 1440, height: 960 },
        { width: 390, height: 844 },
      ]
    : desktop
      ? [{ width: 1440, height: 960 }]
      : comments || foundation
        ? [
            { width: 1440, height: 960 },
            { width: 1625, height: 884 },
            { width: 390, height: 844 },
            { width: 320, height: 568 },
          ]
        : [
            { width: 1440, height: 960 },
            { width: 1920, height: 1080 },
            { width: 390, height: 844 },
            { width: 375, height: 812 },
            { width: 844, height: 390 },
            { width: 320, height: 568 },
          ];
  for (const viewport of sizes) {
    const page = await browser.newPage({
      viewport,
      deviceScaleFactor: viewport.width < 700 ? 2 : 1,
    });
    page.on('pageerror', (error) => report.errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.chainlabReady);
    assert.equal(
      await page.evaluate(() => Object.keys(window.chainlabModules).length),
      0,
      'New WebGL must be lazy loaded',
    );
    const results = [];
    for (const type of types) {
      const art = page.locator(`[data-scene="${type}"]`);
      await art.scrollIntoViewIfNeeded();
      await page.waitForFunction((type) => !!window.chainlabModules[type], type);
      await page.waitForTimeout(850);
      const layout = await art.evaluate((element) => {
        const a = element.getBoundingClientRect();
        const c = (
          element.dataset.scene === 'mechanism'
            ? element.nextElementSibling
            : element.previousElementSibling
        ).getBoundingClientRect();
        const canvas = element.querySelector('canvas');
        return {
          art: { left: a.left, right: a.right, top: a.top, bottom: a.bottom },
          content: { left: c.left, right: c.right, top: c.top, bottom: c.bottom },
          width: canvas.width,
          height: canvas.height,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.equal(layout.overflow, false);
      assert.ok(layout.width > 200 && layout.height > 200);
      if (type === 'mechanism') {
        if (viewport.width > 700) assert.ok(layout.art.right <= layout.content.left + 1);
        else assert.ok(layout.art.bottom <= layout.content.top + 1);
      } else if (viewport.width > 700)
        assert.ok(layout.art.left >= layout.content.right - 1, 'Desktop art must sit on the right');
      else
        assert.ok(
          layout.art.top >= layout.content.bottom - 1,
          'Mobile text and art must not overlap',
        );
      const button = art.locator('.scene-motion');
      if (viewport.height > 568) await button.click();
      else await button.evaluate((b) => b.click());
      assert.equal(await page.evaluate((t) => window.chainlabModules[t].isPaused(), type), true);
      assert.equal(await page.evaluate((t) => window.chainlabModules[t].isRunning(), type), false);
      await page.mouse.move(1, 1);
      const a = await sample(page, type, 3);
      const b = await sample(page, type, 8);
      const motion = changed(a, b),
        foreground = nonblank(a);
      assert.ok(foreground > 1200, `${type}: scene must be nonblank`);
      assert.ok(motion > 250, `${type}: scene must move`);
      const bounds = await art.boundingBox();
      await page.mouse.move(
        bounds.x + bounds.width * 0.78,
        Math.max(105, Math.min(viewport.height - 75, bounds.y + bounds.height * 0.55)),
      );
      const c = await sample(page, type, 3);
      const interactive = changed(a, c);
      assert.ok(interactive > 150, `${type}: real pointer events must change the scene`);
      const stats = await page.evaluate((t) => window.chainlabModules[t].stats, type);
      if (type === 'globe') {
        assert.ok(stats.landFeatures > 100, 'Globe must load real land geometry');
        assert.ok(
          stats.routes >= 60 && stats.locations === 30,
          'Globe must show substantially denser paths',
        );
      }
      if (type === 'mechanism') {
        assert.equal(stats.nodes, 42);
        assert.equal(stats.matrices, 3);
        assert.equal(stats.textLabels, 0);
        assert.ok(stats.links < 70);
        assert.equal(
          await art
            .locator('.method-stages, .method-formula, .scene-heading, .scene-phase')
            .count(),
          0,
          'No added explanatory text in the visual',
        );
        assert.doesNotMatch(
          await art.innerText(),
          /统一数据口径|有向加权构网|诊断与模拟并行|核验.*回溯/,
        );
        const state = await page.evaluate(() => window.chainlabModules.mechanism.getState());
        assert.ok(
          state.bounds.minX > -0.98 &&
            state.bounds.maxX < 0.98 &&
            state.bounds.minY > -0.86 &&
            state.bounds.maxY < 0.86,
          'Foundation must stay framed',
        );
      }
      await page.mouse.move(1, 1);
      const stages = [];
      if (type === 'resilience') {
        for (const [name, time] of [
          ['connected', 1],
          ['fracture', 3.35],
          ['cascade', 6.4],
          ['reroute', 8],
          ['reassemble', 11.3],
          ['recovered', 17],
        ]) {
          const pixels = await sample(page, type, time);
          const state = await page.evaluate(() => window.chainlabModules.resilience.getState());
          assert.ok(nonblank(pixels) > 1200);
          assert.ok(
            state.bounds.minX > -0.98 &&
              state.bounds.maxX < 0.98 &&
              state.bounds.minY > -0.88 &&
              state.bounds.maxY < 0.88,
            `Chain ${name} must stay framed`,
          );
          const controlBounds = await art.locator('.resilience-timeline').boundingBox();
          const legendBounds = await art.locator('.resilience-legend').boundingBox();
          const artBounds = await art.boundingBox();
          assert.ok(
            ((1 - state.bounds.minY) * artBounds.height) / 2 < controlBounds.y - artBounds.y - 6,
            `Chain ${name} must not overlap phase controls`,
          );
          assert.ok(
            ((1 - state.bounds.maxY) * artBounds.height) / 2 >
              legendBounds.y + legendBounds.height - artBounds.y + 6,
            `Chain ${name} must not overlap its legend`,
          );
          if (name === 'connected') assert.equal(state.brokenEdges.length, 0);
          if (name === 'fracture')
            assert.ok(state.brokenEdges.length === 1 && state.visibleFragments >= 14);
          if (name === 'cascade')
            assert.ok(state.brokenEdges.length === 4 && state.visibleFragments >= 14);
          if (name === 'reroute')
            assert.ok(
              state.brokenEdges.length === 4 && state.bypass > 0.9 && state.outputReachable,
            );
          if (name === 'reassemble')
            assert.ok(state.rebuildingEdges.length >= 1 && state.outputReachable);
          if (name === 'recovered')
            assert.ok(state.recovered && state.brokenEdges.length === 0 && state.maxGap < 0.001);
          await art.screenshot({ path: `.artifacts/research/chain-${name}-${viewport.width}.png` });
          stages.push({ name, time, ...state });
        }
        for (const [time, expectedPhase] of [
          [8, '04 / REROUTE'],
          [11.3, '05 / REBUILD'],
          [17, '06 / RECOVERED'],
        ]) {
          const step = art.locator(`[data-scene-time="${time}"]`);
          await step.evaluate((button) => button.click());
          assert.equal(await step.getAttribute('aria-pressed'), 'true');
          assert.equal(await art.locator('.scene-phase').textContent(), expectedPhase);
          assert.equal(
            await page.evaluate(() => window.chainlabModules.resilience.isPaused()),
            true,
          );
          assert.equal(
            await page.evaluate(() => window.chainlabModules.resilience.isRunning()),
            false,
          );
        }
      }
      await sample(page, type, type === 'resilience' ? 8 : 3);
      await art
        .locator('..')
        .screenshot({ path: `.artifacts/research/${type}-${viewport.width}.png` });
      if (posters && viewport.width === 1440) {
        const data = await page.evaluate((t) => {
          window.chainlabModules[t].renderAt(t === 'resilience' ? 8 : 3);
          return document.querySelector(`[data-scene="${t}"] canvas`).toDataURL('image/jpeg', 0.92);
        }, type);
        await writeFile(
          `public/media/research-${type}.jpg`,
          Buffer.from(data.split(',')[1], 'base64'),
        );
      }
      await button.evaluate((b) => b.click());
      await page.waitForTimeout(70);
      assert.equal(await page.evaluate((t) => window.chainlabModules[t].isPaused(), type), false);
      results.push({
        type,
        ...layout,
        foregroundPixels: foreground,
        movingPixels: motion,
        pointerPixels: interactive,
        stats,
        ...(stages.length ? { stages } : {}),
      });
    }
    await page.locator('.hero').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const activity = await page.evaluate(() =>
      Object.entries(window.chainlabModules).map(([type, s]) => {
        const bounds = document.querySelector(`[data-scene="${type}"]`).getBoundingClientRect();
        return {
          type,
          visible: bounds.bottom > 0 && bounds.top < innerHeight,
          running: s.isRunning(),
        };
      }),
    );
    assert.ok(activity.filter((s) => !s.visible).length >= types.length);
    activity
      .filter((s) => !s.visible)
      .forEach((s) =>
        assert.equal(s.running, false, `${s.type}: offscreen module must stop rendering`),
      );
    report.viewports.push({ ...viewport, scenes: results });
    await page.close();
  }
  const reduced = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  await reduced.goto(base, { waitUntil: 'domcontentloaded' });
  report.pausedFrameChanges = {};
  for (const type of types) {
    await reduced.locator(`[data-scene="${type}"]`).scrollIntoViewIfNeeded();
    await reduced.waitForFunction((t) => !!window.chainlabModules[t], type);
    assert.equal(await reduced.evaluate((t) => window.chainlabModules[t].isPaused(), type), true);
    assert.equal(await reduced.evaluate((t) => window.chainlabModules[t].isRunning(), type), false);
    await reduced.waitForTimeout(200);
    const a = await sample(reduced, type);
    await reduced.waitForTimeout(150);
    const b = await sample(reduced, type);
    const drift = changed(a, b);
    report.pausedFrameChanges[type] = drift;
    assert.ok(
      drift < 10,
      `${type}: reduced-motion scene must remain static (${drift} changed pixels)`,
    );
  }
  await reduced.close();
  const fallback = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  });
  await fallback.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return /^webgl|experimental-webgl/.test(type) ? null : getContext.call(this, type, ...args);
    };
  });
  await fallback.goto(base, { waitUntil: 'domcontentloaded' });
  for (const type of types) {
    const art = fallback.locator(`[data-scene="${type}"]`);
    await art.scrollIntoViewIfNeeded();
    await fallback.waitForFunction(
      (t) => document.querySelector(`[data-scene="${t}"]`).classList.contains('webgl-unavailable'),
      type,
    );
    assert.equal(await art.locator('.scene-fallback').isVisible(), true);
    assert.equal(await art.locator('.scene-motion').isVisible(), false);
    if (type === 'resilience')
      assert.equal(await art.locator('.resilience-timeline').isVisible(), false);
    if (type === 'resilience')
      assert.equal(await art.locator('.scene-phase').textContent(), 'STATIC / CONCEPT');
    assert.equal((await fallback.request.get(`${base}/media/research-${type}.jpg`)).status(), 200);
  }
  await fallback.screenshot({ path: '.artifacts/research/webgl-fallback.png' });
  await fallback.close();
  assert.equal(report.errors.length, 0, report.errors.join('\n'));
  report.reducedMotion = `${types.length} modules paused and static`;
  report.webglFallback = `${types.length} local posters available; controls hidden`;
  await writeFile(
    `.artifacts/research/verification${production ? '-production' : desktop ? '-desktop' : ''}${foundation ? '-foundation' : comments ? '-comments' : ''}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
}
