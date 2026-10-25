import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchBrowser } from './browser.mjs';

const credentials = JSON.parse(readFileSync(0, 'utf8'));
const base = process.argv[process.argv.indexOf('--base') + 1].replace(/\/$/, '');
const browser = await launchBrowser();
const folder = `.artifacts/library/${base.startsWith('https:') ? 'public' : 'local'}`;
await mkdir(folder, { recursive: true });
const report = { base, at: new Date().toISOString(), errors: [], checks: [], viewports: [] };
const pages = [],
  created = [];
const stamp = `QA-${Date.now()}`;
async function api(page, path, method = 'GET', body) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const session = await (await fetch('/api/library/session')).json();
      const r = await fetch('/api/library' + path, {
        method,
        headers: body
          ? { 'Content-Type': 'application/json', 'X-CSRF-Token': session.user?.csrf || '' }
          : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, data: await r.json() };
    },
    { path, method, body },
  );
}
async function login(viewport) {
  const page = await browser.newPage({ viewport });
  pages.push(page);
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.goto(base + '/workspace.html#literature', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.locator('#library-username').fill(credentials.username);
  await page.locator('#library-password').fill(credentials.password);
  await page.click('#library-login-submit');
  await page.locator('#library-content').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('#library-list tr').length > 1);
  return page;
}
async function open(page, paper, number = 1) {
  await page.evaluate(
    ({ id, number }) => {
      location.hash = `literature/read/${id}/${number}`;
    },
    { id: paper.id, number },
  );
  await page.locator('.library-reader').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(
    (title) => document.querySelector('#reader-title')?.textContent === title,
    paper.title,
  );
  if (paper.pdf) {
    await page.waitForFunction(
      (n) =>
        document.querySelector('#reader-page-host')?.dataset.ready === String(n) ||
        document.querySelector('#reader-load-status')?.textContent.includes('失败'),
      number,
      { timeout: 90000 },
    );
    assert.equal(await page.locator('#reader-load-status').innerText(), '', 'PDF load status');
    const pixels = await page.locator('#reader-pdf-canvas').evaluate((c) => {
      const a = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      for (let i = 0; i < a.length; i += 4)
        if (a[i] < 180 && a[i + 1] < 180 && a[i + 2] < 180) dark++;
      return dark;
    });
    assert.ok(pixels > 100, 'PDF must not be blank');
  }
}
async function records(page, paper) {
  const r = await api(page, '/annotations?document_id=' + paper.id);
  assert.equal(r.status, 200);
  return r.data.annotations;
}
async function waitRecord(page, body) {
  await page.waitForFunction(
    (body) =>
      [...document.querySelectorAll('.reader-record')].some((r) => r.textContent.includes(body)),
    body,
    { timeout: 16000 },
  );
}
async function captureCreated(page, paper) {
  for (const r of await records(page, paper))
    if (r.origin === 'team' && r.byline.endsWith(stamp) && !created.some((x) => x.id === r.id))
      created.push(r);
}
if (process.argv.includes('--continuous-only')) {
  try {
    for (const viewport of [
      { width: 1440, height: 960 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      const p = await login(viewport);
      const catalog = (await api(p, '/documents')).data;
      const paper = catalog.documents.find(
        (d) => d.pdf && d.title.startsWith('中国产业并购浪潮的产生与传递'),
      );
      await open(p, paper);
      assert.equal(await p.locator('.reader-page-host').count(), paper.pages);
      assert.equal(
        await p.locator('[data-reader-columns="2"] svg').count(),
        1,
        'Layout icons render in production',
      );
      await p.locator('#reader-paper-scroll').evaluate((el) => {
        el.scrollTop = el.querySelector('[data-page="3"]').offsetTop;
      });
      await p.waitForFunction(() => document.querySelector('#reader-page-number').value === '3');
      await p.locator('[data-page="3"][data-ready]').waitFor();
      await p.click('[data-reader-columns="2"]');
      await p.locator('[data-page="3"][data-ready]').waitFor();
      await p.locator('[data-page="4"][data-ready]').waitFor();
      await p.waitForTimeout(800);
      const a = await p.locator('[data-page="3"]').boundingBox(),
        b = await p.locator('[data-page="4"]').boundingBox();
      assert.ok(Math.abs(a.y - b.y) < 1 && b.x > a.x + a.width);
      assert.ok(
        await p
          .locator('#reader-paper-scroll')
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      await p.screenshot({ path: `${folder}/continuous-double-${viewport.width}.png` });
      await p.click('[data-reader-columns="1"]');
      await p.locator('[data-page="3"][data-ready]').waitFor();
      await p.waitForTimeout(800);
      await p.screenshot({ path: `${folder}/continuous-single-${viewport.width}.png` });
      await p.evaluate(() => {
        window.changes = { canvas: 0, status: 0 };
        new MutationObserver((items) =>
          items.forEach((item) => {
            if (item.target.id === 'reader-load-status') window.changes.status++;
            for (const node of item.addedNodes)
              if (node.tagName === 'CANVAS') window.changes.canvas++;
          }),
        ).observe(document.querySelector('.reader-paper-column'), {
          childList: true,
          subtree: true,
        });
      });
      await p.waitForTimeout(6200);
      assert.deepEqual(await p.evaluate(() => window.changes), { canvas: 0, status: 0 });
      report.viewports.push(viewport);
    }
    assert.deepEqual(report.errors, []);
    report.checks.push(
      'Real PDF continuous scrolling, single/double spread, production icons, fit width, zero idle render/status churn across polling',
    );
    await writeFile(`${folder}/continuous.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
  process.exit(0);
}
if (process.argv.includes('--stability-only')) {
  const results = [];
  try {
    for (const viewport of [
      { width: 1440, height: 960 },
      { width: 390, height: 844 },
    ]) {
      const p = await login(viewport);
      const catalog = (await api(p, '/documents')).data;
      const paper =
        catalog.documents.find(
          (d) => d.pdf && d.title.startsWith('中国产业并购浪潮的产生与传递'),
        ) || catalog.documents.find((d) => d.pdf && d.pages > 1);
      await open(p, paper);
      await p.waitForTimeout(500);
      await p.evaluate(() => {
        window.idleReaderChanges = { canvases: 0, status: 0 };
        new MutationObserver((changes) => {
          for (const change of changes) {
            if (change.target.id === 'reader-load-status') window.idleReaderChanges.status++;
            for (const node of change.addedNodes)
              if (node.id === 'reader-pdf-canvas') window.idleReaderChanges.canvases++;
          }
        }).observe(document.querySelector('.reader-paper-column'), {
          subtree: true,
          childList: true,
        });
      });
      await p.waitForTimeout(6200);
      const idle = await p.evaluate(() => window.idleReaderChanges);
      assert.deepEqual(
        idle,
        { canvases: 0, status: 0 },
        'Loaded PDF must stay stable across a shared-note polling interval',
      );
      await p.setViewportSize({ ...viewport, height: viewport.height - 80 });
      await p.waitForTimeout(500);
      assert.deepEqual(await p.evaluate(() => window.idleReaderChanges), {
        canvases: 0,
        status: 0,
      });
      await p.click('#reader-next');
      await p.locator('#reader-page-host[data-ready="2"]').waitFor({ timeout: 30000 });
      await p.selectOption('#reader-zoom', '1.25');
      await p.locator('#reader-page-host[data-ready="2"]').waitFor();
      await p.selectOption('#reader-zoom', 'fit');
      await p.locator('#reader-page-host[data-ready="2"]').waitFor();
      await p.waitForTimeout(300);
      const mark = await p.evaluate(() => ({ ...window.idleReaderChanges }));
      await p.waitForTimeout(1200);
      assert.deepEqual(
        await p.evaluate(() => window.idleReaderChanges),
        mark,
        'Page/zoom changes must settle without restarting',
      );
      await p.screenshot({ path: `${folder}/stable-reader-${viewport.width}.png` });
      results.push({ viewport, paper: paper.title, idle, pageChange: true, zoom: true });
    }
    assert.deepEqual(report.errors, []);
    await writeFile(
      `${folder}/render-stability.json`,
      JSON.stringify(
        { base, at: new Date().toISOString(), results, errors: report.errors },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ base, results, errors: report.errors }, null, 2));
  } finally {
    await browser.close();
  }
  process.exit(0);
}
if (process.argv.includes('--layout-only')) {
  try {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      const p = await login(viewport);
      const heading = await p.locator('#literature-title').evaluate((el) => ({
        height: el.getBoundingClientRect().height,
        lineHeight: parseFloat(getComputedStyle(el).lineHeight),
      }));
      assert.ok(
        heading.height <= heading.lineHeight + 1,
        'Mobile library title must remain on one line',
      );
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await p.screenshot({ path: `${folder}/catalog-${viewport.width}.png`, fullPage: true });
      const catalog = (await api(p, '/documents')).data;
      await open(
        p,
        catalog.documents.find((d) => d.pdf && d.pages < 25),
      );
      await p.screenshot({ path: `${folder}/reader-${viewport.width}.png` });
    }
    assert.deepEqual(report.errors, []);
    await writeFile(
      `${folder}/layout-final.json`,
      JSON.stringify({ base, success: true, viewports: [390, 320] }, null, 2),
    );
    console.log('Final mobile catalog layout and PDF rendering passed (390, 320).');
  } finally {
    await browser.close();
  }
  process.exit(0);
}
try {
  const a = await login({ width: 1440, height: 960 });
  const b = await login({ width: 1440, height: 960 });
  const catalog = (await api(a, '/documents')).data;
  assert.equal(catalog.documents.length, 111);
  assert.equal(catalog.pdf_count, 88);
  assert.equal(catalog.page_count, 2832);
  assert.equal(await a.locator('#library-members').isVisible(), false);
  await a.screenshot({ path: `${folder}/catalog-1440.png`, fullPage: true });
  const paper =
    catalog.documents.find(
      (d) => d.pdf && d.title.includes('Network structure of inter-industry flows'),
    ) || catalog.documents.find((d) => d.pdf && d.pages < 25);
  const native = catalog.documents.find((d) => d.pdf && d.annotation_count > 5);
  await open(a, paper);
  await open(b, paper);
  await a.locator('#reader-byline').fill('QA A ' + stamp);
  await b.locator('#reader-byline').fill('QA B ' + stamp);
  await a.locator('#reader-note-body').fill(stamp);
  await a.click('#reader-save-note');
  await waitRecord(a, stamp);
  await waitRecord(b, stamp);
  await captureCreated(a, paper);
  const note = (await records(a, paper)).find((r) => r.body === stamp);
  assert.equal(note.byline, 'QA A ' + stamp);
  await a.click(`[data-edit-record="${note.id}"]`);
  await b.click(`[data-edit-record="${note.id}"]`);
  await a.locator('#reader-note-body').fill(stamp + '-A');
  await a.click('#reader-save-note');
  await waitRecord(a, stamp + '-A');
  await b.locator('#reader-note-body').fill(stamp + '-B');
  await b.click('#reader-save-note');
  await b.locator('#reader-conflict').waitFor({ state: 'visible' });
  assert.equal(await b.locator('#reader-note-body').inputValue(), stamp + '-B');
  await b.click('#reader-new-note');
  assert.equal(await b.locator('#reader-note-body').inputValue(), stamp + '-B');
  await b.click('#reader-save-note');
  await waitRecord(a, stamp + '-B');
  await captureCreated(a, paper);
  report.checks.push(
    'two independent sessions share one account; polling sync; stale edits preserve draft; conflict saved separately',
  );
  await a.click('#reader-bookmark');
  await a.waitForFunction(() => document.querySelector('#reader-mark-feedback').hidden);
  for (const mode of ['area', 'ink']) {
    await a.click(`[data-reader-mode="${mode}"]`);
    const box = await a.locator('#reader-draw').boundingBox();
    await a.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.19);
    await a.mouse.down();
    await a.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.23, { steps: 10 });
    await a.mouse.up();
    await a.waitForFunction(() => document.querySelector('#reader-mark-feedback').hidden);
  }
  await a.click('[data-reader-mode="text"]');
  const selected = await a.locator('#reader-text-layer').evaluate((layer) => {
    const spans = [...layer.querySelectorAll('span')].filter(
      (s) => s.textContent.trim().length > 5,
    );
    if (!spans.length) return false;
    const range = document.createRange();
    range.selectNodeContents(spans[0]);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    return true;
  });
  assert.ok(selected, 'PDF text must be selectable');
  await a.click('[data-reader-mode="highlight"]');
  await a.waitForFunction(() => document.querySelector('#reader-mark-feedback').hidden);
  await a.click('[data-reader-mode="highlight"]');
  const line = await a.locator('#reader-text-layer').evaluate((layer) => {
    const span = [...layer.querySelectorAll('span')].find((node) => node.textContent.trim().length > 5);
    const rect = span.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  const beforeDrag = (await records(a, paper)).filter((r) => r.origin === 'team' && r.kind === 'highlight').length;
  await a.mouse.move(line.x + 2, line.y + line.height / 2);
  await a.mouse.down();
  await a.mouse.move(line.x + line.width * .8, line.y + line.height / 2, { steps: 12 });
  await a.mouse.up();
  await a.waitForFunction(() => document.querySelector('#reader-mark-feedback').hidden);
  await a.waitForTimeout(800);
  assert.equal((await records(a, paper)).filter((r) => r.origin === 'team' && r.kind === 'highlight').length, beforeDrag + 1, 'Dragging in highlighter mode creates a text highlight');
  await a.evaluate(() => {
    window.savedHighlightGroups = [...document.querySelectorAll('#reader-marks > g')];
    window.highlightCanvas = document.querySelector('#reader-pdf-canvas');
  });
  await a.click('#reader-refresh-notes');
  await a.waitForTimeout(600);
  assert.ok(await a.evaluate(() => window.savedHighlightGroups.every((g) => g.isConnected)));
  assert.ok(await a.evaluate(() => window.highlightCanvas === document.querySelector('#reader-pdf-canvas')));
  report.checks.push('native drag-to-highlight; saved highlight DOM and PDF canvas remain stable through forced sync');
  await captureCreated(a, paper);
  const annotations = await records(a, paper);
  for (const type of ['note', 'bookmark', 'area', 'ink', 'highlight'])
    assert.ok(
      annotations.some((r) => r.origin === 'team' && r.kind === type),
      `Missing mark: ${type}`,
    );
  assert.ok(annotations.some((r) => r.kind === 'highlight' && r.quote));
  await b.waitForFunction(() => document.querySelectorAll('#reader-marks > *').length >= 3, null, {
    timeout: 16000,
  });
  const before = await a.locator('#reader-marks').innerHTML();
  await a.selectOption('#reader-zoom', '1.5');
  await a.waitForFunction(() => document.querySelector('#reader-page-host').dataset.ready === '1');
  assert.equal(await a.locator('#reader-marks').innerHTML(), before);
  await a.selectOption('#reader-zoom', 'fit');
  await a.waitForFunction(() => document.querySelector('#reader-page-host').dataset.ready === '1');
  await a.screenshot({ path: `${folder}/reader-1440.png` });
  for (const [id, extension] of [
    ['reader-export-json', 'json'],
    ['reader-export-notes', 'md'],
  ]) {
    const [download] = await Promise.all([a.waitForEvent('download'), a.click('#' + id)]);
    await download.saveAs(`${folder}/export.${extension}`);
    const content = await readFile(`${folder}/export.${extension}`, 'utf8');
    assert.ok(content.includes(stamp));
    if (extension === 'json') assert.equal(JSON.parse(content).document.id, paper.id);
  }
  report.checks.push(
    'PDF canvas and text layer; text and area highlights; freehand; bookmarks; zoom-stable normalized anchors; MD/JSON export',
  );
  await a.click('#reader-back');
  if (native) {
    await open(a, native);
    assert.ok((await records(a, native)).some((r) => r.origin === 'pdf'));
    await a.click('#reader-back');
  }
  for (const marker of ['/497/', '/1028/']) {
    const special = catalog.documents.find((d) => d.source_pdf?.includes(marker));
    if (special) {
      await open(a, special);
      await a.click('#reader-back');
      report.checks.push('blank-password readable PDF ' + marker);
    }
  }
  const missing = catalog.documents.find((d) => !d.pdf);
  await open(a, missing);
  assert.equal(await a.locator('#reader-missing-pdf').isVisible(), true);
  await a.click('#reader-back');
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    const mobile = await login(viewport);
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await mobile.screenshot({ path: `${folder}/catalog-${viewport.width}.png`, fullPage: true });
    await open(mobile, paper);
    assert.ok(
      await mobile.evaluate(
        () => document.querySelector('.library-reader').scrollWidth <= innerWidth + 1,
      ),
    );
    await mobile.screenshot({ path: `${folder}/reader-${viewport.width}.png` });
    await mobile.click('#reader-toggle-notes');
    await mobile.locator('#reader-save-note').scrollIntoViewIfNeeded();
    await mobile.screenshot({ path: `${folder}/notes-${viewport.width}.png` });
    const box = await mobile.locator('#reader-save-note').boundingBox();
    assert.ok(box.y + box.height <= viewport.height + 1);
    report.viewports.push(viewport);
  }
  const anon = await browser.newPage();
  pages.push(anon);
  await anon.goto(base + '/workspace.html#literature');
  assert.equal((await api(anon, `/documents/${paper.id}/pdf`)).status, 401);
  await b.click('#reader-back');
  await b.click('#library-logout');
  await b.locator('#library-login-view').waitFor({ state: 'visible' });
  assert.equal(await b.locator('#library-list tr').count(), 0);
  report.checks.push(
    'metadata-only entries; native highlights preserved; desktop/mobile 390 and 320; anonymous PDF blocked; logout clears private catalog',
  );
  assert.deepEqual(report.errors, []);
} catch (error) {
  for (let i = 0; i < pages.length; i++) {
    report.checks.push(
      await pages[i]
        .locator('#reader-load-status')
        .textContent()
        .catch(() => 'reader unavailable'),
    );
    await pages[i].screenshot({ path: `${folder}/failure-${i}.png` }).catch(() => {});
  }
  throw error;
} finally {
  const page = pages[0];
  if (page)
    for (const mark of created) {
      try {
        const r = (
          await api(page, '/annotations?document_id=' + mark.document_id)
        ).data.annotations.find((r) => r.id === mark.id);
        if (r)
          await api(page, `/annotations/${r.id}`, 'DELETE', {
            document_id: r.document_id,
            version: r.version,
            byline: 'QA cleanup',
          });
      } catch {}
    }
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
