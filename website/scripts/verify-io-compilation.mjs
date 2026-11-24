import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { createServer } from 'vite';
import { launchBrowser } from './browser.mjs';
import { SAMPLE } from '../src/io-compilation-rules.js';

let fixture, server, browser;
let base = process.env.IO_COMPILATION_BASE;
let account = { username: 'skilltest', password: 'synthetic-skill-password' };
const folder = '.artifacts/io-compilation';
await mkdir(folder, { recursive: true });
try {
  if (!base) {
    const python = process.env.PYTHON || (process.platform === 'win32' ? '../.venv/Scripts/python.exe' : '../.venv/bin/python');
    fixture = spawn(python, ['-u', 'scripts/skillhub-fixture.py'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    fixture.stderr.resume();
    const lines = createInterface({ input: fixture.stdout });
    const port = +(await Promise.race([once(lines, 'line').then(([line]) => line), once(fixture, 'exit').then(() => { throw Error('Fixture exited'); }), new Promise((_, reject) => setTimeout(() => reject(Error('Fixture timeout')), 20000).unref())]));
    lines.close();
    assert.ok(port > 0);
    server = await createServer({ server: { port: 5197, proxy: { '/api': { target: `http://127.0.0.1:${port}` } } } });
    await server.listen(); base = server.resolvedUrls.local[0].replace(/\/$/, '');
  } else {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    const input = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    console.log('Provide login JSON through stdin (not retained).');
    account = JSON.parse(await input.question(''));
    input.close(); if (process.stdin.isTTY) process.stdin.setRawMode(false);
  }

  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/workspace.html#compilation');
  await page.locator('#io-builder-title').waitFor();
  assert.equal(await page.locator('[data-panel="compilation"]').getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('.io-candidate .io-status[data-state="missing"]').count(), 4);
  await page.locator('#io-demo').click();
  assert.equal(await page.locator('.io-candidate .io-status[data-state="estimated"]').count(), 1);
  await page.screenshot({ path: folder + '/assessment-1440.png' });
  await page.locator('[data-open-io-run]').click();
  await page.locator('#io-check').click();
  await page.waitForFunction(() => document.querySelector('#io-run-status').textContent.includes('请先登录'));
  assert.equal(await page.locator('#io-confirm').isVisible(), false);

  const login = await page.evaluate(async payload => {
    const result = await fetch('/api/library/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return result.status;
  }, account);
  account.password = '';
  assert.equal(login, 200);
  await page.locator('#io-input').fill(JSON.stringify({ ...SAMPLE, z0: [[10, 0], [0, 10]] }));
  await page.locator('#io-check').click();
  await page.waitForFunction(() => document.querySelector('#io-run-status').textContent.includes('正支撑无法'));
  assert.equal(await page.locator('#io-confirm').isVisible(), false);
  await page.locator('#io-example').click();
  await page.locator('#io-check').click();
  await page.locator('#io-confirm').waitFor();
  assert.equal(await page.locator('#io-run').isDisabled(), true);
  await page.locator('#io-approval').check();
  await page.locator('#io-run').click();
  await page.locator('#io-result').waitFor();
  assert.equal(await page.locator('#io-table').count(), 1);
  assert.equal(await page.locator('#io-compiled-table').count(), 1);
  assert.deepEqual(await page.locator('#io-compiled-table td').allTextContents(), ['18', '14', '18', '14']);
  await page.locator('#io-block').selectOption('delta');
  assert.deepEqual(await page.locator('#io-compiled-table td').allTextContents(), ['8', '4', '8', '4']);
  const jsonDownload = page.waitForEvent('download');
  await page.locator('#io-json').click();
  const report = JSON.parse(await readFile(await (await jsonDownload).path(), 'utf8'));
  assert.equal(report.verification.independent_validation, 'not_performed');
  assert.match(report.result_hash, /^[a-f0-9]{64}$/);
  const csvDownload = page.waitForEvent('download');
  await page.locator('#io-csv').click();
  const csv = await readFile(await (await csvDownload).path(), 'utf8');
  assert.ok(csv.includes('18,14,98,120,10'));
  assert.ok(csv.includes('84,52'));

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    if (width < 760) await page.waitForFunction(() => document.querySelector('.workspace-sidebar').getBoundingClientRect().right <= 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.locator('#io-result').scrollIntoViewIfNeeded();
    await page.screenshot({ path: folder + `/result-${width}.png` });
  }
  await page.locator('#io-file').setInputFiles({ name: 'previous-report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(report)) });
  await page.waitForFunction(() => document.querySelector('#io-result').hidden);
  await page.locator('#io-check').click();
  await page.locator('#io-confirm').waitFor();
  await page.locator('#io-approval').check();
  await page.locator('#io-run').click();
  await page.locator('#io-result').waitFor();
  assert.equal(await page.locator('#io-hash').textContent(), report.result_hash);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ base, viewportWidths: [1440, 390, 320], scenario: report.table.z, checks: ['assessment', 'anonymous gate', 'support conflict', 'confirmed RAS', 'CSV/JSON', 'replay hash'] }));
} finally {
  await browser?.close();
  await server?.close();
  if (fixture && fixture.exitCode === null) { const ended = once(fixture, 'exit'); fixture.kill(); await ended; }
}
