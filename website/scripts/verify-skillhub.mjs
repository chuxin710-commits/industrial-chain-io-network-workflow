import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import readline from 'node:readline/promises';
import { createServer } from 'vite';
import { launchBrowser } from './browser.mjs';

let api, vite, browser;
const report = { checks: [], errors: [], viewports: [] };
const folder = '.artifacts/skillhub';
await mkdir(folder, { recursive: true });
let credentials = { username: 'skilltest', password: 'synthetic-skill-password' };
let base = process.env.SKILLHUB_BASE;
let uploadedId, page;
try {
  if (!base) {
    api = spawn('../.venv/Scripts/python.exe', ['-u', 'scripts/skillhub-fixture.py'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    api.stderr.on('data', () => {});
    const lines = readline.createInterface({ input: api.stdout });
    const port = await Promise.race([once(lines, 'line').then(([line]) => Number(line)), new Promise((_, reject) => setTimeout(() => reject(new Error('Fixture timeout')), 20000).unref())]);
    assert.ok(port > 0); lines.close();
    vite = await createServer({ server: { port: 5196, strictPort: false, proxy: { '/api': { target: `http://127.0.0.1:${port}`, changeOrigin: false } } } });
    await vite.listen(); base = vite.resolvedUrls.local[0].replace(/\/$/, '');
  } else {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    const input = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    console.log('Provide login JSON through stdin (not retained).');
    credentials = JSON.parse(await input.question(''));
    input.close(); if (process.stdin.isTTY) process.stdin.setRawMode(false);
  }
  report.base = base;
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(`${base}/workspace.html#skills`);
  await page.waitForFunction(() => document.querySelectorAll('.sh-card').length === 11);
  assert.equal(await page.locator('#sh-total').textContent(), '11');
  report.checks.push('11 curated skills available without login');
  await page.locator('#sh-search').fill('系统化');
  assert.equal(await page.locator('.sh-card').count(), 1);
  await page.locator('.sh-card [data-detail]').first().click();
  await page.locator('#sh-detail[open]').waitFor();
  assert.ok((await page.locator('#sh-content').textContent()).length > 100);
  await page.locator('#sh-detail [data-sh-close]').click();
  await page.locator('#sh-search').fill('');
  await page.locator('#sh-category').selectOption('工具集成');
  assert.equal(await page.locator('.sh-card').count(), 2);
  await page.locator('#sh-category').selectOption('all');
  report.checks.push('search, category and original Markdown preview');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 960 : 844 });
    if (width < 760) await page.waitForFunction(() => document.querySelector('.workspace-sidebar').getBoundingClientRect().right <= 0);
    await page.locator('#sh-search').blur();
    await page.screenshot({ path: `${folder}/catalog-${width}.png`, fullPage: false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    report.viewports.push({ width, overflow }); assert.equal(overflow, false);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator('#skill-upload').click();
  await page.locator('#sh-username').fill(credentials.username);
  await page.locator('#sh-password').fill(credentials.password); credentials.password = '';
  await page.locator('#sh-login-form button[type=submit]').click();
  await page.waitForFunction(() => document.querySelector('#sh-auth').textContent === '退出');
  await page.locator('#skill-upload').click();
  const name = `qa-skill-${Date.now()}`;
  const content = `---\nname: ${name}\ndescription: Browser regression fixture.\n---\n\n# QA\n\n<script>window.skillExecuted=true</script>\n`;
  await page.locator('#sh-file').setInputFiles({ name: 'SKILL.md', mimeType: 'text/markdown', buffer: Buffer.from(content) });
  const response = page.waitForResponse(r => r.url().endsWith('/api/library/skills') && r.request().method() === 'POST');
  await page.locator('#sh-save').click();
  const saved = await (await response).json(); uploadedId = saved.id; assert.ok(uploadedId);
  await page.locator(`.sh-card [data-detail="${uploadedId}"]`).first().waitFor();
  await page.reload();
  await page.locator('[data-tab="personal"]').click();
  await page.locator(`.sh-card [data-detail="${uploadedId}"]`).first().waitFor();
  await page.locator(`.sh-card [data-detail="${uploadedId}"]`).first().click();
  await page.locator('#sh-detail[open]').waitFor();
  assert.equal(await page.locator('#sh-content').textContent(), content);
  assert.equal(await page.evaluate(() => window.skillExecuted), undefined);
  const downloading = page.waitForEvent('download');
  await page.locator('#sh-detail [data-download]').click();
  const download = await downloading;
  assert.equal(await readFile(await download.path(), 'utf8'), content);
  await page.locator('#sh-detail [data-sh-close]').click();
  await page.locator(`[data-favorite="${uploadedId}"]`).click();
  await page.waitForFunction(id => document.querySelector(`[data-favorite="${id}"]`)?.getAttribute('aria-pressed') === 'true', uploadedId);
  await page.locator('[data-tab="favorites"]').click();
  await page.locator(`[data-detail="${uploadedId}"]`).first().waitFor();
  report.checks.push('login, upload, reload persistence, escaped preview, exact download, favorites');
  await page.locator(`[data-detail="${uploadedId}"]`).first().click();
  page.once('dialog', d => d.accept());
  await page.locator('#sh-delete').click();
  await page.waitForFunction(id => !document.querySelector(`.sh-card [data-detail="${id}"]`), uploadedId);
  uploadedId = null;
  await page.locator('#sh-auth').click();
  await page.waitForFunction(() => document.querySelector('#sh-auth').textContent === '登录');
  assert.equal(await page.locator('#sh-content').textContent(), '');
  report.checks.push('delete and logout private-state clearing');
  await page.goto(base + '/');
  await page.locator('nav a[href="/workspace.html#skills"]').waitFor({ state: 'attached' });
  report.checks.push('homepage entry');
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (uploadedId && page) {
    await page.evaluate(async id => {
      const { user } = await (await fetch('/api/library/session')).json();
      if (user) await fetch(`/api/library/skills/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': user.csrf }, body: '{}' });
    }, uploadedId).catch(() => {});
  }
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
  await browser?.close(); await vite?.close();
  if (api) { const ended = once(api, 'exit'); api.kill(); await ended; }
}
