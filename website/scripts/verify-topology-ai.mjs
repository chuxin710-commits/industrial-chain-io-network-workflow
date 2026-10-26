import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { ensurePreview } from './preview.mjs';
import { ensureApi } from './api-preview.mjs';
import { launchBrowser } from './browser.mjs';

const live = process.argv.includes('--live');
const option = process.argv.indexOf('--base');
const base = option >= 0 ? process.argv[option + 1] : (await ensurePreview()).url;
if (option < 0) await ensureApi();
const folder = `.artifacts/topology-ai/${live ? 'live' : 'fixture'}`;
await mkdir(folder, { recursive: true });
const report = { base, live, errors: [], viewports: [] };
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => report.errors.push(error.message));
  let signedIn = false, fail = false, slow = false, calls = [];
  if (!live) await page.route('**/api/library/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/session')) return route.fulfill({ json: { user: signedIn ? { csrf: 'synthetic' } : null } });
    if (path.endsWith('/ai/topology')) {
      const data = route.request().postDataJSON(); calls.push(data);
      if (fail) return route.fulfill({ status: 503, json: { error: '测试：服务暂不可用' } });
      if (slow) return route.fulfill({ json: { id: 'a'.repeat(32), status: 'running' } });
      const facts = await page.evaluate((years) => window.chainlabTopology.frames.filter((f) => years.includes(f.year)).map((f, i) => ({ ...f, id: 'F' + (i+1) })), data.years);
      const source = { id: 'K1', title: '投入产出方向与阈值', text: '合成测试资料 <img src=x onerror=alert(1)>', kind: 'curated', href: '#methods/direct' };
      return route.fulfill({ json: { status: 'ready', result: { summary: '合成界面测试，不是实证判断。<img src=x onerror=alert(1)>', observations: [{ text: '全网指标不受展示上限影响。', fact_ids: ['F1'] }], interpretations: [{ text: '结构关联不等于因果效应。', evidence_ids: ['K1'] }], next_steps: ['检验阈值敏感性。'], limitations: ['未计算韧性指标。'], context: { years: data.years, config: data.config, node: data.node }, facts, model: 'fixture', version: 'fixture-v1', fact_sha256: 'a'.repeat(64), citations: [source], retrieval: { version: 'a'.repeat(64), documents: 88, chunks: 1000, retrieval_ms: 5, sources: [source], notice: '合成检索测试' } } } });
    }
    if (path.includes('/ai/topology/')) return route.fulfill({ json: { status: 'running', id: 'a'.repeat(32) } });
    return route.fulfill({ status: 503, json: { error: 'Fixture only' } });
  });
  await page.goto(base.replace(/\/$/, '') + '/workspace.html#topology');
  await page.waitForFunction(() => !document.querySelector('#topo-generate').disabled);
  if (live) {
    let raw = ''; for await (const chunk of process.stdin) raw += chunk;
    const credentials = JSON.parse(raw); raw = '';
    const ok = await page.evaluate(async (data) => (await fetch('/api/library/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).ok, credentials);
    credentials.password = ''; assert.ok(ok, 'Live login');
  }
  await page.click('#topo-generate');
  await page.waitForFunction(() => document.querySelector('#topo-status').textContent.startsWith('已完成'), null, { timeout: 120000 });
  await page.click('#topology-ai-open');
  if (!live) {
    await page.waitForFunction(() => document.querySelector('#topology-ai-access').textContent.includes('登录'));
    assert.ok(await page.locator('#topology-ai-send').isDisabled());
    signedIn = true;
    await page.click('#topology-ai-close'); await page.click('#topology-ai-open');
  }
  await page.waitForFunction(() => !document.querySelector('#topology-ai-send').disabled);
  await page.click('[data-topology-prompt="2"]');
  await page.waitForFunction(() => document.querySelector('#topology-ai-answer article') || document.querySelector('#topology-ai-status').textContent.includes('未通过'), null, { timeout: 420000 });
  assert.equal(await page.locator('#topology-ai-answer article').count(), 1, await page.locator('#topology-ai-status').innerText());
  assert.equal(await page.locator('#topology-ai-answer img').count(), 0);
  assert.ok(await page.locator('.research-evidence details').count());
  await page.locator('.research-evidence details').first().locator('summary').click();
  assert.ok(await page.locator('.research-evidence a').first().getAttribute('href'));
  if (!live) assert.equal(calls[0].years.length, 3);
  report.response = await page.locator('#topology-ai-answer').innerText();
  if (live) {
    const href = await page.locator('.research-evidence a[href^="#literature/read/"]').first().getAttribute('href');
    const id = href.split('/')[2];
    const pdf = await page.evaluate(async (id) => {
      const response = await fetch(`/api/library/documents/${id}/pdf`, { method: 'HEAD' });
      return { status: response.status, type: response.headers.get('content-type') };
    }, id);
    assert.equal(pdf.status, 200); assert.equal(pdf.type, 'application/pdf');
    report.citedPdfAccessible = true;
  }
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await page.locator('.topology-ai').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect(); return r.width && (r.right > innerWidth+1 || r.left < -1);
    }).map((el) => ({ tag: el.tagName, id: el.id, class: String(el.className), width: el.getBoundingClientRect().width })).slice(0, 30));
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1))) {
      report.overflow = overflow;
      await page.screenshot({ path: `${folder}/overflow-${viewport.width}.png` });
      assert.fail('Page overflows: ' + JSON.stringify(overflow));
    }
    assert.ok(await page.locator('.topology-ai').evaluate((el) => el.scrollWidth <= el.clientWidth+1));
    await page.screenshot({ path: `${folder}/panel-${viewport.width}.png` });
    report.viewports.push({ ...viewport, noOverflow: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#topo-nodes [data-node]').first().click();
  assert.equal(await page.locator('#topology-ai-answer article').count(), 0, 'Node changes invalidate answer');
  await page.check('#topology-ai-node');
  await page.selectOption('#topology-ai-scope', 'current');
  await page.fill('#topology-ai-question', '请结合当前所选节点的入强度、出强度和全部邻居口径解释它的结构位置，不能据此推出什么？');
  await page.click('#topology-ai-send');
  await page.locator('#topology-ai-answer article').waitFor({ timeout: 420000 });
  if (!live) assert.ok(calls.at(-1).node);
  else report.nodeResponse = await page.locator('#topology-ai-answer').innerText();
  await page.click('#topo-next');
  assert.equal(await page.locator('#topology-ai-answer article').count(), 0, 'Year changes invalidate answer');
  if (!live) {
    fail = true;
    await page.click('[data-topology-prompt="0"]');
    await page.waitForFunction(() => document.querySelector('#topology-ai-status').textContent.includes('暂不可用'));
    assert.ok(await page.locator('#topology-ai-send').isEnabled());
    fail = false; slow = true;
    await page.click('#topology-ai-send');
    await page.waitForFunction(() => document.querySelector('#topology-ai-send').disabled);
    await page.click('#topo-prev');
    await page.waitForTimeout(2000);
    assert.equal(await page.locator('#topology-ai-answer article').count(), 0);
    slow = false;
    await page.click('[data-topology-prompt="0"]');
    await page.locator('#topology-ai-answer article').waitFor();
    signedIn = false;
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('library-session-change')));
    await page.waitForFunction(() => document.querySelector('#topology-ai-access').textContent.includes('登录'));
    assert.equal(await page.locator('#topology-ai-answer article').count(), 0);
    assert.ok(await page.locator('#topology-ai-send').isDisabled());
    report.failureRecovery = report.staleSuppressed = report.logoutCleared = true;
  }
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ ...report, response: 'Saved locally for review', nodeResponse: undefined }, null, 2));
