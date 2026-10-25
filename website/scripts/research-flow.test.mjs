import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import { buildFlow } from '../src/research-flow-model.js';
import { ensurePreview } from './preview.mjs';
import { launchBrowser } from './browser.mjs';

const fixture = {
  title: '从投入产出结构到产业链韧性提升的研究路径', question: '比较不同结构与冲击情景下的恢复路径。',
  theme: 'resilience', model: 'synthetic-fixture', created: 1, corpus_count: 1, cautions: ['合成测试，非实证。'],
  sources: [{ id: 'a'.repeat(32), title: '合成文献', reason: '合成方法参考', pages: [{ page: 1 }] }],
  stages: ['整理数据与界定边界', '建立产业关联网络', '设计冲击与恢复情景', '比较路径与稳健性核验'].map((title, i) => ({ title,
    options: ['A', 'B'].map((letter, j) => ({ id: `${i}-${j}`, title: `方案${letter}：${title}，比较行业结构与跨区域关联的不同作用`,
      basis: j ? 'ai' : 'literature', theory: '保留所选理论，不推断未定义的依赖。', data: '交易矩阵 Z、总产出 x；元数据待核验。',
      formula: 'A_ij = Z_ij / x_j; x_j > 0', parameters: '列总产出、阈值、随机种子', assumptions: '给定技术结构与情景边界', validation: '复核矩阵方向、年度口径、参数敏感性。', limitations: '非因果识别', requires: ['额外数据须补齐；分支不能自动叠加'],
      steps: ['读取矩阵并核验行业顺序及缺失值。', '按既定参数计算，保存中间结果与版本。', '进行敏感性检验并比较候选路径。'],
      citations: [{ document_id: 'a'.repeat(32), page: 1 }],
    })),
  })),
};

test('selected branches, missing stages, order, layout and original text stay faithful', () => {
  const before = JSON.stringify(fixture);
  const model = buildFlow(fixture, ['0-0', '0-1', '2-0'], { details: true });
  assert.equal(model.nodes.filter((n) => n.kind === 'option').length, 3);
  assert.equal(model.nodes.filter((n) => n.kind === 'missing').length, 2);
  assert.ok(model.nodes.find((n) => n.id === 'phase-0').y < model.nodes.find((n) => n.id === 'phase-3').y);
  assert.ok(!model.nodes.some((n) => n.id === 'method-2-1'));
  assert.ok(model.edges.some((e) => e.source === 'step-0-0-0' && e.target === 'step-0-0-1'));
  for (const e of model.edges) assert.ok(model.nodes.some((n) => n.id === e.source) && model.nodes.some((n) => n.id === e.target));
  for (const [i, a] of model.nodes.entries()) for (const b of model.nodes.slice(i + 1)) {
    assert.ok(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2, `${a.id} overlaps ${b.id}`);
  }
  assert.equal(JSON.stringify(fixture), before);
  const focused = buildFlow(fixture, ['0-0', '2-0'], { stage: 2, details: true, direction: 'TB' });
  assert.ok(!focused.nodes.some((n) => n.stage === 0));
});

test('framework selection drives flow; drag, focus, exports, mobile and privacy work', async () => {
  const preview = await ensurePreview();
  const browser = await launchBrowser();
  const folder = '.artifacts/research-flow';
  await mkdir(folder, { recursive: true });
  const errors = [];
  let signedIn = true, calls = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/library/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/session')) return route.fulfill({ json: { user: signedIn ? { csrf: 'fixture' } : null } });
      if (path.endsWith('/ai/status')) return route.fulfill({ json: { ready: 1, pending: 0, needs_ocr: 0, failed: 0 } });
      if (path.endsWith('/ai/framework')) {
        calls++;
        return route.fulfill({ json: { id: 'b'.repeat(32), status: 'ready', result: fixture } });
      }
      return route.fulfill({ status: 404, json: {} });
    });
    await page.route('**/flow-regression', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/workspace.css"><style>body{margin:0;background:#f6f9f7}#workspace-content{padding:24px;margin:0;width:100%;min-width:0;box-sizing:border-box}.workspace-panel{display:block}</style></head><body><main id="workspace-content"></main><script type="module">
      import {createKnowledgePanel} from '/src/knowledge.js';
      createKnowledgePanel({refreshIcons:()=>{},toast:()=>{}});
      document.querySelector('#panel-knowledge').hidden=false;
      location.hash='knowledge';
    </script></body></html>` }));
    await page.goto(preview.url + 'flow-regression');
    await page.click('#kg-flow-tab');
    await page.locator('#flow-empty').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#kg-data-tab').count(), 0);
    await page.click('#flow-start');
    await page.click('#framework-generate');
    await page.locator('.framework-stage').first().waitFor();
    await page.locator('.framework-option input').nth(1).check();
    await page.click('#framework-open-flow');
    await page.waitForFunction(() => document.querySelector('#flow-node').options.length === 10);
    assert.equal(await page.locator('#kg-flow-tab').getAttribute('aria-selected'), 'true');
    await page.screenshot({ path: `${folder}/overview-desktop.png`, fullPage: true });
    await page.locator('#flow-canvas').scrollIntoViewIfNeeded();
    const position = await page.evaluate(() => {
      const cy = document.querySelector('#flow-canvas')._cyreg.cy, n = cy.getElementById('method-0-0');
      const p = n.renderedPosition(), rect = cy.container().getBoundingClientRect();
      return { x: p.x + rect.x, y: p.y + rect.y, original: n.position() };
    });
    await page.mouse.move(position.x, position.y);
    await page.mouse.down(); await page.mouse.move(position.x + 35, position.y + 35, { steps: 8 }); await page.mouse.up();
    const moved = await page.evaluate(() => document.querySelector('#flow-canvas')._cyreg.cy.getElementById('method-0-0').position());
    assert.ok(Math.abs(moved.x - position.original.x) > 10);
    await page.selectOption('#flow-node', 'method-0-0');
    assert.match(await page.locator('#flow-detail').innerText(), /A_ij = Z_ij/);
    assert.equal(await page.locator('.flow-citation').first().getAttribute('href'), '#literature/read/' + 'a'.repeat(32) + '/1');
    await page.selectOption('#flow-stage', '0');
    await page.click('#flow-steps');
    await page.selectOption('#flow-direction', 'TB');
    await page.waitForFunction(() => document.querySelector('#flow-node').options.length === 14);
    await page.click('#flow-fit');
    const pngDownload = page.waitForEvent('download');
    await page.click('#flow-png');
    await (await pngDownload).saveAs(`${folder}/selected-flow.png`);
    const drawioDownload = page.waitForEvent('download');
    await page.click('#flow-drawio');
    await (await drawioDownload).saveAs(`${folder}/selected-flow.drawio`);
    const xml = await readFile(`${folder}/selected-flow.drawio`, 'utf8');
    const validation = await page.evaluate((text) => {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      return { errors: doc.querySelectorAll('parsererror').length, pages: doc.querySelectorAll('diagram').length,
        edges: [...doc.querySelectorAll('mxCell[edge="1"]')].every((e) => e.querySelector('mxGeometry[relative="1"]')) };
    }, xml);
    assert.deepEqual(validation, { errors: 0, pages: 6, edges: true });
    assert.ok(xml.includes('A_ij = Z_ij / x_j'));
    const bytes = await readFile(`${folder}/selected-flow.png`);
    assert.ok(bytes.length > 5000);
    const pixels = await page.evaluate(async (base64) => {
      const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 200;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 200, 200);
      const data = ctx.getImageData(0, 0, 200, 200).data;
      let colored = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] < 220 && data[i + 3]) colored++;
      return colored;
    }, bytes.toString('base64'));
    assert.ok(pixels > 100, 'PNG must contain visible diagram pixels');
    await page.selectOption('#flow-stage', 'all'); await page.click('#flow-overview'); await page.selectOption('#flow-direction', 'LR');
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await page.waitForTimeout(400); await page.click('#flow-fit');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: `${folder}/flow-${width}.png`, fullPage: true });
    }
    await page.click('#flow-edit');
    await page.locator('.framework-option input').nth(1).uncheck();
    await page.click('#framework-open-flow');
    await page.waitForFunction(() => document.querySelector('#flow-node').options.length === 9);
    assert.equal(calls, 1, 'Flow changes must not make new AI requests');
    await page.click('#flow-edit');
    for (const input of await page.locator('.framework-option input').all()) await input.uncheck();
    assert.ok(await page.locator('#framework-open-flow').isDisabled());
    await page.click('#kg-flow-tab');
    await page.locator('#flow-empty').waitFor({ state: 'visible' });
    await page.click('#flow-edit'); await page.locator('.framework-option input').first().check(); await page.click('#framework-open-flow');
    await page.waitForFunction(() => document.querySelector('#flow-node').options.length > 0);
    signedIn = false;
    await page.evaluate(() => document.dispatchEvent(new Event('library-session-change')));
    await page.waitForFunction(() => document.querySelector('#flow-node').options.length === 0);
    assert.equal(await page.locator('#flow-detail').innerText(), '');
    assert.equal(await page.locator('#flow-canvas canvas').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
