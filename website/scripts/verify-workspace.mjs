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
const report = { base, viewports: [], errors: [], checks: [] };
await mkdir('.artifacts/workspace', { recursive: true });

async function ready(page) {
  await page.locator('#io-table:not([hidden])').waitFor();
  await assert.doesNotReject(() =>
    page.waitForFunction(
      () => document.querySelector('#table-container').getAttribute('aria-busy') === 'false',
    ),
  );
}
async function query(page, filters = {}) {
  for (const [key, value] of Object.entries(filters))
    await page.selectOption(`#filter-${key.replaceAll('_', '-')}`, String(value));
  const response = page.waitForResponse(
    (r) => r.url().includes('/api/table?') && r.request().method() === 'GET',
  );
  await page.click('#query-submit');
  const result = await (await response).json();
  await ready(page);
  return result;
}

try {
  const sizes = [
    { width: 1625, height: 884 },
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ];
  for (const viewport of sizes) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => report.errors.push(error.message));
    await page.goto(`${base}/workspace.html#database`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await page.screenshot({
      path: `.artifacts/workspace/initial-${viewport.width}.png`,
      fullPage: true,
    });
    assert.equal(await page.locator('#filter-year option').count(), 24);
    assert.equal(await page.locator('#filter-row-province option').count(), 32);
    assert.equal(await page.locator('#filter-row-sector option').count(), 43);
    const initial = await page.evaluate(async () => {
      const response = await fetch('/api/table?year=2023&view=z&row_limit=20&col_limit=8');
      if (!response.ok) throw new Error(`Baseline query failed: ${response.status}`);
      return response.json();
    });
    assert.equal(await page.locator('#table-body tr').count(), 20);
    assert.ok(
      await page
        .locator('[data-cell="0,0"]')
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 12),
      'Primary numeric values must remain legible',
    );
    assert.equal(await page.locator('#table-body tr').first().locator('.value-cell').count(), 8);
    await page.locator('[data-cell="0,0"]').click();
    await page.locator('#cell-dialog').waitFor();
    assert.equal(Number(await page.locator('#cell-exact-value').innerText()), initial.values[0][0]);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#cell-dialog').isVisible(), false);
    const matched = await query(page, {
      year: 2000,
      row_province: 'Beijing',
      row_sector: 'S01',
      col_province: 'Shanghai',
      col_sector: 'S03',
    });
    assert.equal(matched.total_rows, 1);
    assert.equal(matched.total_columns, 1);
    assert.equal(matched.rows[0].code, 'Beijing_S01');
    assert.equal(matched.columns[0].code, 'Shanghai_S03');
    assert.equal(matched.values[0][0], 0.0000185891141556673);
    await page.selectOption('#number-format', 'scientific');
    assert.match(await page.locator('[data-cell="0,0"]').innerText(), /e-/i);
    const downloadPromise = page.waitForEvent('download');
    await page.click('#export-csv');
    const download = await downloadPromise;
    const text = await readFile(await download.path(), 'utf8');
    assert.ok(text.includes('Shanghai_S03') && text.includes('Beijing_S01'));
    const rows = text.trim().split(/\r?\n/);
    assert.equal(rows.length, 2);
    assert.equal(Number(rows[1].split(',')[1]), matched.values[0][0]);
    await page.locator('[data-open-provenance]').first().click();
    assert.ok(await page.locator('#provenance-dialog').isVisible());
    assert.ok(
      (await page.locator('#provenance-dialog').innerText()).includes(matched.source.sha256),
    );
    await page.keyboard.press('Escape');
    const resetResponse = page.waitForResponse((r) => r.url().includes('/api/table?'));
    await page.click('#reset-filters');
    await resetResponse;
    await ready(page);
    const paged = page.waitForResponse((r) => r.url().includes('/api/table?'));
    await page.click('#row-next');
    const secondPage = await (await paged).json();
    await ready(page);
    assert.equal(secondPage.row_offset, 20);
    const columnPage = page.waitForResponse((r) => r.url().includes('/api/table?'));
    await page.click('#col-next');
    const secondColumns = await (await columnPage).json();
    await ready(page);
    assert.equal(secondColumns.col_offset, 8);
    await page.locator('.heatmap-control').click();
    assert.equal(await page.locator('#heatmap-toggle').isChecked(), false);
    assert.equal(
      await page.locator('#io-table').evaluate((el) => el.classList.contains('heatmap-enabled')),
      false,
    );
    await page.locator('.heatmap-control').click();
    assert.equal(await page.locator('#heatmap-toggle').isChecked(), true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `Page must not overflow ${viewport.width}px`);
    assert.ok(
      await page.locator('#table-container').evaluate((el) => el.scrollWidth >= el.clientWidth),
    );
    await page.screenshot({
      path: `.artifacts/workspace/database-${viewport.width}.png`,
      fullPage: true,
    });
    for (const panel of [
      'overview',
      'methods',
      'projects',
      'literature',
      'verification',
      'database',
    ]) {
      if (viewport.width < 900) await page.locator('.menu-button').click();
      await page.locator(`.workspace-nav [data-panel="${panel}"]`).click();
      await page.locator(`[data-workspace-panel="${panel}"]:not([hidden])`).waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `${panel} must fit mobile`,
      );
    }
    for (const view of ['f', 'va', 'x', 'full', 'z']) {
      const result = await query(page, { view });
      const expected = {
        z: [1302, 1302],
        f: [1302, 155],
        va: [5, 1302],
        x: [1302, 1],
        full: [1309, 1460],
      }[view];
      assert.deepEqual([result.total_rows, result.total_columns], expected);
    }
    report.viewports.push({
      ...viewport,
      yearOptions: 24,
      filters: true,
      exactCell: true,
      export: true,
      doublePagination: true,
      panels: 6,
      views: 5,
      overflow,
    });
    await page.close();
  }
  const failure = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await failure.route('**/api/table?**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Verification unavailable' }),
    }),
  );
  await failure.goto(`${base}/workspace.html`);
  await failure.locator('#retry-data').waitFor();
  assert.equal(await failure.locator('#io-table').isVisible(), false);
  assert.equal(await failure.locator('#export-csv').isEnabled(), false);
  await failure.unroute('**/api/table?**');
  await failure.click('#retry-data');
  await ready(failure);
  await failure.close();
  assert.deepEqual(report.errors, []);
  report.checks = [
    '24 annual datasets',
    '5 full IO views',
    'exact numeric values',
    'cross-axis filters',
    'full filtered CSV export',
    'row and column pagination',
    '6 navigable framework sections',
    'source SHA256',
    'mobile no page overflow',
    'unavailable API and retry',
  ];
  const suffix = option < 0 ? 'local' : 'public';
  await writeFile(
    `.artifacts/workspace/verification-${suffix}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
