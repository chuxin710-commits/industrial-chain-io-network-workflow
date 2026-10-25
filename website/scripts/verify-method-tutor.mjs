import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { ensurePreview } from './preview.mjs';
import { launchBrowser } from './browser.mjs';

const live = process.argv.includes('--live');
const baseArg = process.argv.indexOf('--base');
const base = baseArg >= 0 ? process.argv[baseArg + 1].replace(/\/$/, '') : (await ensurePreview()).url.replace(/\/$/, '');
const folder = `.artifacts/method-tutor/${live ? 'live' : 'fixture'}`;
await mkdir(folder, { recursive: true });
const report = { base, live, at: new Date().toISOString(), errors: [], viewports: [] };
const browser = await launchBrowser();
const fixture = { method_id: 'direct', formula_index: 0, answer: '每单位产出所需的直接投入。<img src=x onerror=alert(1)>', intuition: '分母属于使用方，而不是供应方。', steps: ['Z_ij = 10，x_j = 100。', 'a_ij = 10 / 100 = 0.1。'], example: '合成教学示例，非实证结果：生产 1 单位产出需要 0.1 单位直接投入。', pitfalls: ['不要把结构联系直接当作因果效应。'], check: '分母是哪一方？使用方。', model: 'synthetic-fixture', version: 'fixture-version' };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on('pageerror', (error) => report.errors.push(error.message));
  let signedIn = false, calls = [], slow = false, fail = false;
  if (!live) {
    await page.route('**/api/library/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/session')) return route.fulfill({ json: { user: signedIn ? { csrf: 'fixture' } : null } });
      if (path.endsWith('/ai/explain')) {
        calls.push(route.request().postDataJSON());
        if (fail) return route.fulfill({ status: 503, json: { error: '测试：暂时不可用' } });
        return route.fulfill({ json: { id: 'a'.repeat(32), status: slow ? 'running' : 'ready', result: { ...fixture, formula_index: calls.at(-1).formula_index } } });
      }
      if (path.includes('/ai/explain/')) return route.fulfill({ json: { status: 'ready', result: fixture } });
      return route.fulfill({ status: 503, json: { error: 'Fixture only' } });
    });
  }
  await page.goto(base + '/workspace.html#methods/direct');
  await page.locator('[data-method="direct"]').waitFor();
  await page.locator('[data-explain-formula="0"]').click();
  if (live) {
    // Credentials arrive on stdin and remain in memory only.
    let raw = ''; for await (const chunk of process.stdin) raw += chunk;
    const credentials = JSON.parse(raw); raw = '';
    const login = await page.evaluate(async (credentials) => {
      const response = await fetch('/api/library/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
      return response.ok;
    }, credentials);
    credentials.password = '';
    assert.ok(login, 'Live login failed');
  } else {
    await page.waitForFunction(() => document.querySelector('#tutor-access').textContent.includes('登录课题组'));
    assert.ok(await page.locator('#tutor-send').isDisabled());
    signedIn = true;
  }
  await page.click('#tutor-close');
  await page.locator('[data-explain-formula="0"]').click();
  await page.waitForFunction(() => !document.querySelector('#tutor-send').disabled);
  assert.ok(await page.locator('#tutor-formula .katex').count());
  await page.click('[data-tutor-prompt="2"]');
  await page.locator('.tutor-answer').waitFor({ timeout: 420000 });
  assert.match(await page.locator('.tutor-answer').innerText(), /合成|教学/);
  assert.equal(await page.locator('.tutor-answer img').count(), 0);
  if (!live) { assert.equal(calls[0].method_id, 'direct'); assert.equal(calls[0].formula_index, 0); }
  await page.fill('#tutor-question', '阈值 tau 和图上展示边数上限有什么区别？改变阈值会影响结构指标吗？');
  await page.click('#tutor-send');
  await page.waitForFunction(() => document.querySelectorAll('.tutor-answer').length === 2, null, { timeout: 420000 });
  if (!live) assert.equal(calls[1].history.length, 2);
  report.followup = true;
  for (const viewport of [{ width: 1440, height: 1050 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await page.locator('.tutor-body').evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(200);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.ok(await page.locator('.tutor-body').evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    assert.ok(await page.locator('#tutor-send').isVisible());
    await page.screenshot({ path: `${folder}/tutor-${viewport.width}.png` });
    report.viewports.push({ ...viewport, noOverflow: true });
  }
  if (!live) {
    await page.click('#tutor-clear');
    assert.equal(await page.locator('.tutor-answer').count(), 0);
    fail = true;
    await page.click('[data-tutor-prompt="0"]');
    await page.waitForFunction(() => document.querySelector('#tutor-status').textContent.includes('暂时不可用'));
    assert.ok(await page.locator('#tutor-question').inputValue());
    assert.ok(await page.locator('#tutor-send').isEnabled());
    fail = false; slow = true;
    await page.click('#tutor-send');
    await page.waitForFunction(() => document.querySelector('#tutor-send').disabled);
    await page.click('#tutor-close');
    await page.locator('[data-explain-method]').click();
    await page.waitForTimeout(2200);
    assert.equal(await page.locator('.tutor-answer').count(), 0, 'Old result must not appear in new context');
    slow = false;
    await page.click('[data-tutor-prompt="0"]');
    await page.locator('.tutor-answer').waitFor();
    assert.equal(calls.at(-1).formula_index, null);
    signedIn = false;
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('library-session-change')));
    await page.waitForFunction(() => document.querySelector('#tutor-access').textContent.includes('登录课题组'));
    assert.equal(await page.locator('.tutor-answer').count(), 0);
    assert.ok(await page.locator('#tutor-send').isDisabled());
    report.errorsRecoverable = true;
    report.staleResultSuppressed = true;
    report.logoutClears = true;
  } else {
    report.response = await page.locator('#tutor-conversation').innerText();
  }
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ ...report, response: report.response ? 'Saved for scientific review' : undefined }, null, 2));
