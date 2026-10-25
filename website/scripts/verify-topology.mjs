import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchBrowser } from './browser.mjs';
import { ensurePreview } from './preview.mjs';
import { ensureApi } from './api-preview.mjs';

const option = process.argv.indexOf('--base');
const base =
  option >= 0
    ? process.argv[option + 1].replace(/\/$/, '')
    : (await ensurePreview()).url.replace(/\/$/, '');
if (option < 0) await ensureApi();
const browser = await launchBrowser();
const report = { base, checkedAt: new Date().toISOString(), viewports: [], errors: [] };
await mkdir('.artifacts/topology', { recursive: true });

async function generate(page) {
  await page.click('#topo-generate');
  await page.waitForFunction(
    () =>
      !document.querySelector('#topo-generate').disabled &&
      document.querySelector('#topo-status').textContent.startsWith('已完成'),
    null,
    { timeout: 120000 },
  );
}
async function pixels(page) {
  return page.locator('#topo-canvas').evaluate((canvas) => {
    const ctx = canvas.getContext('2d'),
      d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let foreground = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i] < 180 && d[i + 1] < 190 && d[i + 2] < 180) foreground++;
    return foreground;
  });
}

try {
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', (e) => report.errors.push(e.message));
    await page.goto(`${base}/workspace.html#topology`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('#topo-generate').disabled);
    assert.equal(await page.locator('#panel-topology').isVisible(), true);
    assert.equal(await page.locator('#topo-years input').count(), 24);
    await generate(page);
    assert.equal(await page.evaluate(() => window.chainlabTopology.frames.length), 3);
    assert.equal(
      await page.evaluate(() => window.chainlabTopology.frames[0].config.display),
      'local',
    );
    const scientific = await page.evaluate(() =>
      window.chainlabTopology.frames.map((f) => ({
        nodes: f.nodes,
        edges: f.metrics.edges,
        density: f.metrics.density,
      })),
    );
    await page.selectOption('#topo-display', 'topk');
    await generate(page);
    assert.deepEqual(
      await page.evaluate(() =>
        window.chainlabTopology.frames.map((f) => ({
          nodes: f.nodes,
          edges: f.metrics.edges,
          density: f.metrics.density,
        })),
      ),
      scientific,
    );
    await page.selectOption('#topo-display', 'local');
    await generate(page);
    assert.ok((await pixels(page)) > 1000);
    const positions = await page.evaluate(() => JSON.stringify(window.chainlabTopology.positions));
    const max = await page.evaluate(() => window.chainlabTopology.scale);
    await page.click('#topo-next');
    assert.match(await page.locator('#topo-current-year').innerText(), /2022/);
    assert.equal(
      await page.evaluate(() => JSON.stringify(window.chainlabTopology.positions)),
      positions,
    );
    assert.equal(await page.evaluate(() => window.chainlabTopology.scale), max);
    await page.selectOption('#topo-speed', '1400');
    await page.click('#topo-play');
    await page.waitForFunction(() => window.chainlabTopology.frameIndex === 2);
    await page.locator('#topo-play[aria-label="播放年度演化"]').waitFor({ timeout: 10000 });
    await page.locator('#topo-stage').scrollIntoViewIfNeeded();
    await page.waitForTimeout(550);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: `.artifacts/topology/topology-${viewport.width}.png`,
      fullPage: true,
    });
    const before = await page.evaluate(() => window.chainlabTopology.view.k);
    await page.click('#topo-zoom-in');
    assert.ok((await page.evaluate(() => window.chainlabTopology.view.k)) > before);
    await page.click('#topo-fit');
    await page.locator('#topo-stage').scrollIntoViewIfNeeded();
    const node = await page.evaluate(() =>
      window.chainlabTopology.screenNodes.find((n) => n.id === 'S12'),
    );
    const box = await page.locator('#topo-canvas').boundingBox();
    const originalPositions = await page.evaluate(() =>
      JSON.stringify(window.chainlabTopology.positions),
    );
    const dragX = viewport.width < 500 ? -55 : -140;
    await page.mouse.move(box.x + node.x, box.y + node.y);
    await page.mouse.down();
    await page.mouse.move(box.x + node.x + dragX, box.y + node.y - 55, { steps: 14 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.chainlabTopology.selected), 'S12');
    assert.notEqual(
      await page.evaluate(() => JSON.stringify(window.chainlabTopology.positions)),
      originalPositions,
    );
    await page.waitForFunction(() => window.chainlabTopology.neighbors?.node.id === 'S12');
    const neighbors = await page.evaluate(() => window.chainlabTopology.neighbors);
    assert.equal(neighbors.edges.length, neighbors.node.in_degree + neighbors.node.out_degree);
    assert.equal(await page.locator('#topo-incoming tr').count(), neighbors.node.in_degree);
    assert.equal(await page.locator('#topo-outgoing tr').count(), neighbors.node.out_degree);
    await page
      .locator('#topo-stage')
      .screenshot({ path: `.artifacts/topology/dragged-${viewport.width}.png` });
    const movedPositions = await page.evaluate(() =>
      JSON.stringify(window.chainlabTopology.positions),
    );
    await page.click('#topo-prev');
    assert.equal(
      await page.evaluate(() => JSON.stringify(window.chainlabTopology.positions)),
      movedPositions,
    );
    await page.click('#topo-reset-layout');
    assert.equal(
      await page.evaluate(() => JSON.stringify(window.chainlabTopology.positions)),
      originalPositions,
    );
    await page.click('#topo-fit');
    await page.fill('#topo-find', 'S01');
    await page.locator('#topo-find').dispatchEvent('change');
    await page.locator('#topo-method-result').click();
    assert.match(await page.locator('#topo-method-dialog').innerText(), /SHA-256/);
    await page.keyboard.press('Escape');
    const pngEvent = page.waitForEvent('download');
    await page.click('#topo-png');
    const png = await readFile(await (await pngEvent).path());
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.ok(png.readUInt32BE(16) >= 300);
    const jsonEvent = page.waitForEvent('download');
    await page.click('#topo-json');
    const exported = JSON.parse(await readFile(await (await jsonEvent).path(), 'utf8'));
    assert.equal(exported.frames.length, 3);
    assert.equal(exported.layout.positions.length, 42);
    for (const f of exported.frames) assert.ok(f.metrics.displayed_edges <= f.metrics.edges);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.click('[data-years="clear"]');
    await page.click('#topo-generate');
    assert.match(await page.locator('#topo-status').innerText(), /至少选择/);
    await page.locator('#topo-years label').filter({ hasText: '2018' }).click();
    await page.selectOption('#topo-level', 'node');
    await generate(page);
    const large = await page.evaluate(() => window.chainlabTopology.frames[0]);
    assert.equal(large.nodes.length, 1302);
    assert.equal(large.edges.length, 1500);
    assert.equal(large.nodes.find((n) => n.id === 'InnerMongolia_S21').strength, 0);
    assert.ok((await pixels(page)) > 1000);
    await page.fill('#topo-find', 'Beijing_S01');
    await page.locator('#topo-find').dispatchEvent('change');
    await page.waitForFunction(() => window.chainlabTopology.neighbors?.node.id === 'Beijing_S01');
    await page.locator('#topo-stage').scrollIntoViewIfNeeded();
    const denseNode = await page.evaluate(() =>
      window.chainlabTopology.screenNodes.find((n) => n.id === 'Beijing_S01'),
    );
    const denseBox = await page.locator('#topo-canvas').boundingBox();
    const denseBefore = await page.evaluate(() =>
      JSON.stringify(window.chainlabTopology.positions),
    );
    await page.mouse.move(denseBox.x + denseNode.x, denseBox.y + denseNode.y);
    await page.mouse.down();
    await page.mouse.move(denseBox.x + denseNode.x - 45, denseBox.y + denseNode.y + 45, {
      steps: 12,
    });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.chainlabTopology.selected), 'Beijing_S01');
    assert.notEqual(
      await page.evaluate(() => JSON.stringify(window.chainlabTopology.positions)),
      denseBefore,
    );
    const denseNeighbors = await page.evaluate(() => window.chainlabTopology.neighbors);
    assert.equal(
      denseNeighbors.edges.length,
      denseNeighbors.node.in_degree + denseNeighbors.node.out_degree,
    );
    await page
      .locator('#topo-stage')
      .screenshot({ path: `.artifacts/topology/1302-${viewport.width}.png` });
    await page.selectOption('#topo-level', 'province');
    await generate(page);
    assert.equal(await page.evaluate(() => window.chainlabTopology.frames[0].nodes.length), 31);
    await page.selectOption('#topo-weight', 'Z');
    await page.selectOption('#topo-level', 'sector');
    await generate(page);
    assert.equal(await page.evaluate(() => window.chainlabTopology.frames[0].config.weight), 'Z');
    const previousYear = await page.evaluate(() => window.chainlabTopology.frames[0].year);
    await page.route('**/api/topology?**', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Test unavailable' }),
      }),
    );
    await page.click('#topo-generate');
    await page.waitForFunction(() =>
      document.querySelector('#topo-status').textContent.includes('生成失败'),
    );
    assert.equal(await page.evaluate(() => window.chainlabTopology.frames[0].year), previousYear);
    await page.unroute('**/api/topology?**');
    if (viewport.width === 1440) {
      await page.click('[data-years="all"]');
      await page.selectOption('#topo-weight', 'A');
      await generate(page);
      assert.equal(await page.evaluate(() => window.chainlabTopology.frames.length), 24);
      assert.equal(await page.locator('#topo-annual tr').count(), 24);
    }
    report.viewports.push({
      ...viewport,
      singleYear: true,
      multiYear: true,
      stablePositions: true,
      sharedScales: true,
      png: true,
      json: true,
      levels: [42, 31, 1302],
      noOverflow: true,
      errorsKeepPreviousResult: true,
      nodeDragging: true,
      completeNeighbors: true,
      denseNodeDragging: true,
      displayComparison: true,
      scientificMetricsUnaffected: true,
    });
    await page.close();
  }
  assert.deepEqual(report.errors, []);
  await writeFile(
    `.artifacts/topology/verification-${option < 0 ? 'local' : 'public'}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
