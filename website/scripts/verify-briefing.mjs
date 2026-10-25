import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser } from './browser.mjs';
import { ensurePreview } from './preview.mjs';
const option = process.argv.indexOf('--base');
const base = option >= 0 ? process.argv[option + 1].replace(/\/$/, '') : (await ensurePreview()).url.replace(/\/$/, '');
const folder = `.artifacts/briefing-v2/${option >= 0 ? 'public' : 'local'}`;
await mkdir(folder, { recursive: true });
const browser = await launchBrowser();
const report = { base, at: new Date().toISOString(), errors: [], viewports: [] };
const fixture = (archive = false) => {
  const now = archive ? Date.parse('2026-10-20T23:00:00Z') : Date.now();
  return { status: archive ? 'archive' : 'partial', edition: archive ? '2026-10-21' : null, generated_at: new Date(now).toISOString(), window_end: new Date(now).toISOString(), coverage: '合成验收数据，非真实新闻。',
    last_attempt: { feeds: [{ edition: 'US:en', topic: 'industry', ok: true }, { edition: 'GB:en', topic: 'ai', ok: false }] },
    items: Array.from({ length: 90 }, (_, i) => ({ id: (i + 1).toString(16).padStart(20, '0'), title: i === 0 ? 'Semiconductor manufacturing and critical mineral supply chains: a research update <img src=x onerror=alert(1)>' : `产业与人工智能研究消息 ${i + 1} · 供应网络的发展与变化`,
      source: i % 2 ? 'Science Publisher' : '产业研究通讯', published_at: new Date(now - (i * .7 + .1) * 3600000).toISOString(), url: `https://example.com/news/${i + 1}`, topics: [['industry', 'supply', 'ai'][i % 3]], editions: ['US:en', 'GB:en'] })) };
};
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 960 }, acceptDownloads: true });
    page.on('pageerror', (e) => report.errors.push(e.message));
    let fail = false, slow = false;
    if (option < 0) await page.route(/\/api\/briefing(?:[/?]|$)/, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('editions')) return route.fulfill({ json: { editions: ['2026-10-21'] } });
      if (fail) return route.fulfill({ status: 503, json: { error: 'Synthetic failure' } });
      if (slow && url.search) await new Promise((r) => setTimeout(r, 600));
      await route.fulfill({ json: fixture(url.searchParams.has('date')) }).catch(() => {});
    });
    await page.goto(base + '/briefing.html');
    await page.locator('.story').first().waitFor();
    if (option >= 0 && width === 1440) {
      const api = await page.evaluate(async () => {
        const latest = await (await fetch('/api/briefing')).json();
        const invalid = await fetch('/api/briefing?date=2026-02-30');
        return { latest, invalid: invalid.status };
      });
      assert.equal(api.invalid, 400);
      const end = Date.parse(api.latest.window_end);
      assert.ok(api.latest.items.every((a) => end - Date.parse(a.published_at) >= 0 && end - Date.parse(a.published_at) <= 72 * 3600000));
      assert.ok(!api.latest.items.some((a) => /\b(estimates|financials|stock quote)\s*[-–—]\s*(NASDAQ|NYSE|OTC)\b/i.test(a.title)));
      report.api = { items: api.latest.items.length, window: true, noiseFilter: true, invalidDate: true };
    }
    assert.equal(await page.locator('.highlight').count(), 3);
    assert.equal(await page.locator('.highlight img').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${folder}/overview-${width}.png` });
    await page.click('.tabs [data-category="ai"]');
    assert.ok((await page.locator('.story .topic').allTextContents()).every((t) => t.includes('AI')));
    await page.selectOption('#hours', '24');
    await page.fill('#search', 'no-unlikely-news-123');
    assert.equal(await page.locator('.story').count(), 0);
    await page.click('#reset');
    await page.locator('.story').first().waitFor();
    const first = page.locator('.story').first();
    const id = await first.getAttribute('data-story');
    await first.locator('[data-save]').click();
    await page.locator(`[data-story="${id}"] [data-read]`).click();
    await page.selectOption('#read', 'read');
    assert.equal(await page.locator('.story').count(), 1);
    await page.click('#reset');
    await page.locator(`[data-story="${id}"] [data-open]`).click();
    assert.ok(await page.locator('#reader').isVisible());
    assert.match(await page.locator('#reader .primary-button').first().getAttribute('href'), /^https?:/);
    await page.fill('#note', 'QA 私人笔记：待核对原始研究。');
    await page.click('#save-note');
    await page.waitForFunction(() => document.querySelector('#note-status').textContent.includes('已保存'));
    await page.screenshot({ path: `${folder}/reader-${width}.png` });
    assert.ok(await page.locator('#reader').evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    await page.click('#reader-close');
    await page.click('[data-view="saved"]');
    assert.equal(await page.locator('.story').count(), 1);
    assert.ok(await page.locator('#hours').isDisabled());
    await page.click('#density');
    assert.ok(await page.locator('#stories').evaluate((el) => el.classList.contains('compact')));
    const download = page.waitForEvent('download'); await page.click('#export');
    const file = `${folder}/notes-${width}.md`; await (await download).saveAs(file);
    assert.ok((await readFile(file, 'utf8')).includes('QA 私人笔记'));
    await page.reload(); await page.locator('.story').first().waitFor();
    await page.click('[data-view="saved"]');
    assert.equal(await page.locator('.story').count(), 1);
    await page.locator('.story [data-open]').click();
    assert.equal(await page.locator('#note').inputValue(), 'QA 私人笔记：待核对原始研究。');
    await page.click('#reader-close');
    await page.click('[data-view="feed"]'); await page.click('#reset');
    await page.waitForFunction(() => document.querySelector('#edition').options.length > 1);
    const edition = await page.locator('#edition option').allTextContents();
    if (edition.length > 1) {
      const value = await page.locator('#edition option').nth(1).getAttribute('value');
      await page.selectOption('#edition', value);
      await page.waitForFunction(() => document.querySelector('#status').textContent.includes('历史快照'));
      assert.ok(await page.locator('.story').count());
      await page.selectOption('#edition', '');
      await page.waitForFunction(() => !document.querySelector('#status').textContent.includes('历史快照') && !document.querySelector('#refresh').disabled);
      if (option < 0) {
        slow = true; await page.selectOption('#edition', value); await page.selectOption('#edition', '');
        await page.waitForTimeout(1000);
        assert.equal(await page.locator('#edition').inputValue(), '');
        assert.ok(!(await page.locator('#list-title').innerText()).includes('历史'));
      }
    }
    const source = await page.locator('.story .source-link').first().innerText();
    await page.selectOption('#source', source);
    assert.ok((await page.locator('.story .source-link').allTextContents()).every((s) => s === source));
    await page.click('#reset');
    if (await page.locator('#more').isVisible()) { const n = await page.locator('.story').count(); await page.click('#more'); assert.ok(await page.locator('.story').count() > n); }
    await page.locator('#list-title').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${folder}/list-${width}.png` });
    const count = await page.locator('.story').count();
    if (option < 0) fail = true;
    else await page.route('**/api/briefing', (r) => r.fulfill({ status: 503, json: {} }));
    await page.click('#refresh');
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('无法读取'));
    assert.equal(await page.locator('.story').count(), count);
    report.viewports.push({ width, filters: true, savedReadNotes: true, persistence: true, export: true, archives: edition.length > 1, errorRetention: true, noOverflow: true });
    await page.close();
  }
  assert.deepEqual(report.errors, []);
} finally { await browser.close(); await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report, null, 2));
