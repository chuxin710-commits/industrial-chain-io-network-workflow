import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser } from './browser.mjs';

const credentials = JSON.parse(readFileSync(0, 'utf8'));
const base = process.argv[process.argv.indexOf('--base') + 1].replace(/\/$/, '');
const folder = '.artifacts/literature-ai';
await mkdir(folder, { recursive: true });
const browser = await launchBrowser();
const report = { base, at: new Date().toISOString(), errors: [], viewports: [], themes: [] };
let page;
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  page = await context.newPage();
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.goto(`${base}/workspace.html#knowledge`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.locator('#framework-corpus a').waitFor({ timeout: 30000 });
  assert.equal(await page.evaluate(async () => (await fetch('/api/library/ai/status')).status), 401);
  await page.locator('#framework-corpus a').click();
  await page.locator('#library-username').fill(credentials.username);
  await page.locator('#library-password').fill(credentials.password);
  await page.click('#library-login-submit');
  await page.locator('#library-content').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('.library-ai').length > 0, null, {
    timeout: 30000,
  });
  const catalog = await page.evaluate(async () => (await fetch('/api/library/documents')).json());
  report.corpus = catalog.ai_status;
  assert.equal(catalog.pdf_count, 88);
  assert.ok(catalog.ai_status.ready > 0);
  const tag = await page.locator('.library-ai-tag').first().innerText();
  await page.locator('.library-ai-tag').first().click();
  assert.equal(await page.locator('#library-search').inputValue(), tag);
  await page.locator('#library-search').fill('');
  await page.screenshot({ path: `${folder}/library-desktop.png`, fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${folder}/library-mobile.png`, fullPage: false });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const theme of ['network', 'resilience', 'security', 'shock']) {
    await page.evaluate(() => {
      location.hash = 'knowledge';
    });
    await page.locator(`[data-theme="${theme}"]`).click();
    await page.click('#framework-generate');
    await page.waitForFunction(
      () =>
        !document.querySelector('#framework-generate').disabled &&
        document.querySelector('#framework-status').textContent &&
        !document.querySelector('#framework-status').textContent.startsWith('正在'),
      null,
      { timeout: 600000 },
    );
    assert.ok(await page.locator('#framework-empty').isHidden(), await page.locator('#framework-status').innerText());
    assert.equal(await page.locator('.framework-stage').count(), 4);
    assert.ok((await page.locator('.framework-option').count()) >= 8);
    assert.ok((await page.locator('.framework-citation').count()) > 0);
    const href = await page.locator('.framework-citation').first().getAttribute('href');
    assert.match(href, /^#literature\/read\/[a-f0-9]{32}\/\d+$/);
    const before = await page.locator('.framework-route').innerText();
    await page.locator('.framework-option input').first().uncheck();
    assert.notEqual(await page.locator('.framework-route').innerText(), before);
    await page.locator('.framework-option input').first().check();
    await page.locator('.framework-option details').first().locator('summary').click();
    await page.screenshot({ path: `${folder}/${theme}-desktop.png`, fullPage: false });
    report.themes.push({
      theme,
      stages: 4,
      options: await page.locator('.framework-option').count(),
      citations: await page.locator('.framework-citation').count(),
    });
  }
  const download = page.waitForEvent('download');
  await page.click('#framework-export');
  await (await download).saveAs(`${folder}/selected-framework.md`);
  await page.locator('#workspace-toast').waitFor({ state: 'hidden', timeout: 10000 });
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(600);
    await page.locator('#knowledge-title').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${folder}/framework-${viewport.width}.png`, fullPage: true });
    await page.screenshot({ path: `${folder}/framework-${viewport.width}-top.png`, fullPage: false });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    assert.equal(overflow, false, `overflow at ${viewport.width}`);
    report.viewports.push({ ...viewport, overflow });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.click('#framework-open-flow');
  await page.waitForFunction(() => document.querySelector('#flow-node').options.length > 0);
  assert.equal(await page.locator('#kg-data-tab').count(), 0);
  assert.equal(await page.locator('#flow-node option[value^="method-"]').count(), 4);
  await page.selectOption('#flow-node', 'method-0-0');
  assert.ok((await page.locator('.flow-citation').count()) > 0);
  const flowDownload = page.waitForEvent('download');
  await page.click('#flow-drawio');
  await (await flowDownload).saveAs(`${folder}/selected-flow.drawio`);
  const flowPng = page.waitForEvent('download');
  await page.click('#flow-png');
  await (await flowPng).saveAs(`${folder}/selected-flow.png`);
  await page.locator('#workspace-toast').waitFor({ state: 'hidden', timeout: 10000 });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 650) {
      await page.selectOption('#flow-stage', '0');
      await page.selectOption('#flow-direction', 'TB');
    }
    await page.waitForTimeout(400);
    await page.click('#flow-fit');
    await page.locator('#knowledge-title').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: `${folder}/flow-${width}.png`, fullPage: true });
  }
  await page.click('#flow-steps');
  await page.waitForFunction(() => [...document.querySelector('#flow-node').options].some((option) => option.value.startsWith('step-')));
  await page.selectOption('#flow-node', 'method-0-0');
  report.flow = { selection: true, steps: true, stageFocus: true, drawioExport: true, pngExport: true, noOverflow: true };
  await page.locator('.flow-citation').first().click();
  await page.locator('.library-reader').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelectorAll('.reader-page-host canvas').length > 0,
    null,
    { timeout: 60000 },
  );
  report.readerLink = true;
  await page.evaluate(async () => {
    const user = (await (await fetch('/api/library/session')).json()).user;
    await fetch('/api/library/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': user.csrf },
      body: '{}',
    });
    location.hash = 'knowledge';
  });
  await page.waitForFunction(() => document.querySelector('#flow-node').options.length === 0);
  await page.click('#kg-method-tab');
  await page.locator('#framework-corpus a').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('#framework-result').innerText(), '');
  assert.equal(await page.locator('#flow-detail').innerText(), '');
  assert.deepEqual(report.errors, []);
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error.message, pageErrors: report.errors, url: page?.url(), status: await page?.locator('#library-status').textContent().catch(() => '') }));
  await page?.screenshot({ path: `${folder}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
