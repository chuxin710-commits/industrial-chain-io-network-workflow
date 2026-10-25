import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { launchBrowser } from './browser.mjs';
import { ensurePreview } from './preview.mjs';

// A two-page text-only fixture keeps the regression independent of private papers.
function fixturePdf(count = 2) {
  const stream =
    'BT /F1 16 Tf 40 780 Td (Reader layout regression) Tj 0 -30 Td (Text and marks must remain stable after loading.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${count} >>`,
  ];
  for (let i = 0; i < count; i++) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${3 + count * 2} 0 R >> >> /Contents ${4 + i * 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let data = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(data.length);
    data += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = data.length;
  data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(data);
}

test('word highlights keep their DOM through delayed saves and stale polling', async () => {
  const browser = await launchBrowser();
  try {
    const preview = await ensurePreview();
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/library/documents/*/pdf', (route) =>
      route.fulfill({ contentType: 'application/pdf', body: fixturePdf() }),
    );
    await page.route('**/highlight-regression', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><link rel="stylesheet" href="/src/workspace.css"></head><body><script type="module">
      import {createLibraryReader} from '/src/library-reader.js';
      window.saved=[];window.holdRead=false;window.failWrite=false;
      window.testReader=createLibraryReader({api:async(path,options)=>{
        if(options?.method==='POST') {
          await new Promise(r=>setTimeout(r,400));
          if(window.failWrite) throw new Error('Synthetic write failure');
          const item={...JSON.parse(options.body),id:String(window.saved.length+1),origin:'team',author_id:'fixture',author:'Fixture',updated:1};
          window.saved.push(item);return item;
        }
        const annotations=structuredClone(window.saved);
        if(window.holdRead) await new Promise(r=>window.releaseRead=r);
        return {annotations,etag:'fixture'};
      },getUser:()=>({id:'fixture',role:'admin'}),refreshIcons:()=>{},toast:()=>{},onClose:()=>{}});
      await window.testReader.open({id:'${'c'.repeat(32)}',title:'Word highlights',authors:[],pdf:'fixture',pages:2},1);
    </script></body></html>`,
      }),
    );
    await page.goto(preview.url + 'highlight-regression');
    await page.locator('[data-ready="1"]').waitFor();
    await page.click('[data-reader-columns="2"]');
    await page.locator('[data-ready="2"]').waitFor();
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      window.holdRead = true;
    });
    await page.click('#reader-refresh-notes');
    await page.waitForFunction(() => !!window.releaseRead);
    await page.click('[data-reader-mode="highlight"]');
    const text = page.locator('[data-page="2"] .textLayer span').first();
    const rect = await text.boundingBox();
    await page.mouse.move(rect.x + 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width - 2, rect.y + rect.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.locator('[data-page="2"] .reader-marks g').waitFor();
    await page.evaluate(() => {
      window.highlightNode = document.querySelector('[data-page="2"] .reader-marks g');
      window.highlightMutations = 0;
      new MutationObserver((changes) => (window.highlightMutations += changes.length)).observe(
        document.querySelector('[data-page="2"] .reader-marks'),
        { subtree: true, childList: true },
      );
      window.highlightCanvas = document.querySelector('[data-page="2"] canvas');
    });
    await page.waitForFunction(() => window.saved.length === 1);
    assert.equal(await page.evaluate(() => window.saved[0].page), 2);
    assert.ok((await page.evaluate(() => window.saved[0].quote)).includes('Reader'));
    await page.evaluate(() => {
      window.holdRead = false;
      window.releaseRead();
    });
    await page.waitForTimeout(300);
    await page.click('#reader-refresh-notes');
    await page.waitForTimeout(600);
    assert.equal(
      await page.evaluate(() => window.highlightNode.isConnected),
      true,
      'A successful write and stale poll cannot remove the highlight',
    );
    assert.equal(
      await page.evaluate(() => window.highlightMutations),
      0,
      'No replace/remove/reinsert across save or unchanged sync',
    );
    assert.equal(
      await page.evaluate(
        () => window.highlightCanvas === document.querySelector('[data-page="2"] canvas'),
      ),
      true,
    );
    await page.evaluate(() => {
      window.failWrite = true;
    });
    await page.mouse.move(rect.x + 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(() =>
      document.querySelector('#reader-mark-status').textContent.includes('未保存'),
    );
    assert.equal(
      await page.locator('[data-page="2"] .reader-marks g').count(),
      2,
      'Failed writes retain their visible pending highlight',
    );
    await page.evaluate(() => {
      window.failWrite = false;
    });
    await page.click('#reader-retry-mark');
    await page.waitForFunction(() => window.saved.length === 2);
    assert.equal(await page.locator('[data-page="2"] .reader-marks g').count(), 2);
    await page.waitForTimeout(5500);
    assert.equal(await page.locator('[data-page="2"] .reader-marks g').count(), 2);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`continuous single/double pages, annotations and bounded canvases at ${viewport.width}px`, async () => {
    const browser = await launchBrowser();
    try {
      const preview = await ensurePreview();
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/api/library/documents/*/pdf', (route) =>
        route.fulfill({ contentType: 'application/pdf', body: fixturePdf(13) }),
      );
      await page.route('**/reader-continuous', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/workspace.css"></head><body><script type="module">
        import {createLibraryReader} from '/src/library-reader.js';
        import {createIcons, icons} from '/node_modules/lucide/dist/esm/lucide.js';
        window.saved=[];
        window.testReader=createLibraryReader({api:async(path,options)=>{
          if(options?.method==='POST') {
            const item={...JSON.parse(options.body),id:String(window.saved.length+1),origin:'team',author_id:'fixture',author:'Fixture',updated:1};
            window.saved.push(item); return item;
          }
          return {annotations:window.saved,etag:'fixture'};
        },getUser:()=>({id:'fixture',role:'admin'}),refreshIcons:()=>createIcons({icons}),toast:()=>{},onClose:()=>{}});
        window.testPaper={id:'${'b'.repeat(32)}',title:'Continuous reading fixture',authors:[],pdf:'fixture',pages:13};
        await window.testReader.open(window.testPaper,1);
      </script></body></html>`,
        }),
      );
      await page.goto(preview.url + 'reader-continuous');
      await page.locator('.reader-page-host[data-page="1"][data-ready]').waitFor();
      assert.equal(await page.locator('.reader-page-host').count(), 13);
      const first = await page.locator('[data-page="1"]').boundingBox();
      const second = await page.locator('[data-page="2"]').boundingBox();
      assert.ok(second.y > first.y + first.height, 'Single pages form a continuous column');
      await page.locator('#reader-paper-scroll').evaluate((el) => {
        el.scrollTop = el.querySelector('[data-page="3"]').offsetTop;
      });
      await page.waitForFunction(() => document.querySelector('#reader-page-number').value === '3');
      await page.locator('[data-page="3"][data-ready]').waitFor();
      assert.match(await page.locator('#reader-note-page-label').textContent(), /3/);
      await page.click('[data-reader-columns="2"]');
      await page.locator('[data-page="3"][data-ready]').waitFor();
      await page.locator('[data-page="4"][data-ready]').waitFor();
      const left = await page.locator('[data-page="3"]').boundingBox();
      const right = await page.locator('[data-page="4"]').boundingBox();
      assert.ok(
        Math.abs(left.y - right.y) < 1 && right.x > left.x + left.width,
        'Pages pair left-to-right',
      );
      const overflow = await page
        .locator('#reader-paper-scroll')
        .evaluate((el) => el.scrollWidth - el.clientWidth);
      assert.ok(overflow <= 1, 'Fit spread must not cause horizontal overflow');
      await page.click('[data-reader-mode="area"]');
      const surface = page.locator('[data-page="4"] .reader-draw');
      const rect = await surface.boundingBox();
      await page.mouse.move(rect.x + rect.width * 0.2, rect.y + rect.height * 0.2);
      await page.mouse.down();
      await page.mouse.move(rect.x + rect.width * 0.6, rect.y + rect.height * 0.3, { steps: 5 });
      await page.mouse.up();
      await page.waitForFunction(() => window.saved.length === 1);
      const mark = await page.evaluate(() => window.saved[0]);
      assert.equal(mark.page, 4, 'A right-hand annotation is not attached to the left page');
      assert.equal(mark.kind, 'area');
      assert.ok(Math.abs(mark.anchor.rects[0][0] - 0.2) < 0.02);
      assert.equal(await page.locator('[data-page="4"] .reader-marks rect').count(), 1);
      await page.click('[data-reader-mode="text"]');
      await page.fill('#reader-page-number', '11');
      await page.locator('#reader-page-number').press('Enter');
      await page.locator('#reader-page-number').blur();
      await page.locator('[data-page="11"][data-ready]').waitFor();
      await page.waitForTimeout(500);
      assert.ok(
        (await page.locator('.reader-pages canvas').count()) < 13,
        'Offscreen canvas resources are released',
      );
      assert.equal(await page.locator('[data-page="1"] canvas').count(), 0);
      await page.fill('#reader-page-number', '4');
      await page.locator('#reader-page-number').blur();
      await page.locator('[data-page="4"][data-ready]').waitFor();
      await page.click('[data-reader-columns="1"]');
      await page.locator('[data-page="4"][data-ready]').waitFor();
      assert.equal(
        await page.locator('[data-page="4"] .reader-marks rect').count(),
        1,
        'Annotations survive virtualization and layout switching',
      );
      await page.waitForTimeout(500);
      await mkdir('.artifacts/library/continuous', { recursive: true });
      await page.screenshot({ path: `.artifacts/library/continuous/single-${viewport.width}.png` });
      await page.click('[data-reader-columns="2"]');
      await page.locator('[data-page="4"][data-ready]').waitFor();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `.artifacts/library/continuous/double-${viewport.width}.png` });
      await page.evaluate(() => window.testReader.close());
      assert.equal(
        await page.locator('.reader-pages canvas').count(),
        0,
        'Closing clears the document',
      );
      await page.evaluate(() => window.testReader.open(window.testPaper, 13));
      await page.locator('[data-page="13"][data-ready]').waitFor();
      assert.equal(
        await page.locator('.reader-page-host').count(),
        13,
        'Odd last page survives reopening',
      );
      assert.equal(
        await page.locator('[data-reader-columns="2"]').getAttribute('aria-pressed'),
        'true',
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
}

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`reader stops rendering after load at ${viewport.width}px`, async () => {
    const browser = await launchBrowser();
    try {
      const preview = await ensurePreview();
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/api/library/documents/*/pdf', (route) =>
        route.fulfill({ contentType: 'application/pdf', body: fixturePdf() }),
      );
      await page.route('**/reader-regression', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/workspace.css"></head><body><script type="module">
        import {createLibraryReader} from '/src/library-reader.js';
        window.testReader=createLibraryReader({api:async()=>({annotations:[],etag:'fixture'}),getUser:()=>({id:'fixture',role:'admin'}),refreshIcons:()=>{},toast:()=>{},onClose:()=>{}});
        await window.testReader.open({id:'${'a'.repeat(32)}',title:'Synthetic layout fixture',authors:[],pdf:'fixture',pages:2},1);
      </script></body></html>`,
        }),
      );
      await page.goto(preview.url + 'reader-regression');
      await page.locator('#reader-page-host[data-ready="1"]').waitFor({ timeout: 30000 });
      await page.waitForTimeout(450);
      await page.evaluate(() => {
        window.readerChanges = { canvases: 0, status: 0 };
        new MutationObserver((changes) => {
          for (const change of changes) {
            if (change.target.id === 'reader-load-status') window.readerChanges.status++;
            for (const node of change.addedNodes)
              if (node.id === 'reader-pdf-canvas') window.readerChanges.canvases++;
          }
        }).observe(document.querySelector('.reader-paper-column'), {
          subtree: true,
          childList: true,
        });
        window.initialCanvas = document.querySelector('#reader-pdf-canvas');
      });
      await page.waitForTimeout(1800);
      assert.deepEqual(
        await page.evaluate(() => window.readerChanges),
        { canvases: 0, status: 0 },
        'Idle reading must not enter a render/loading loop',
      );
      await page.setViewportSize({ ...viewport, height: viewport.height - 100 });
      await page.waitForTimeout(500);
      assert.equal(
        await page.evaluate(
          () => window.initialCanvas === document.querySelector('#reader-pdf-canvas'),
        ),
        true,
        'Height-only changes must not rerender fit-width pages',
      );
      const before = await page.locator('#reader-page-host').boundingBox();
      await page.evaluate(
        () => (document.querySelector('#reader-load-status').textContent = 'Temporary status'),
      );
      const during = await page.locator('#reader-page-host').boundingBox();
      assert.equal(during.y, before.y, 'Loading status must not move the paper');
      await page.evaluate(() => (document.querySelector('#reader-load-status').textContent = ''));
      await page.setViewportSize({ ...viewport, width: viewport.width + 90 });
      await page.waitForTimeout(700);
      await page.locator('#reader-page-host[data-ready="1"]').waitFor();
      const canvasAfterResize = await page.locator('#reader-page-host').boundingBox();
      const expectedWidth = await page
        .locator('#reader-paper-scroll')
        .evaluate((el) => Math.max(0.2, Math.min(1.5, (el.clientWidth - 36) / 612)) * 612);
      assert.ok(
        Math.abs(canvasAfterResize.width - expectedWidth) < 1,
        'Fit-width still responds to width changes',
      );
      assert.equal(
        await page.evaluate(
          () => window.initialCanvas === document.querySelector('#reader-pdf-canvas'),
        ),
        Math.abs(canvasAfterResize.width - before.width) < 1,
      );
      await page.selectOption('#reader-zoom', '1.25');
      await page.locator('#reader-page-host[data-ready="1"]').waitFor();
      assert.equal(Math.round((await page.locator('#reader-page-host').boundingBox()).width), 765);
      await page.click('#reader-next');
      await page.locator('#reader-page-host[data-ready="2"]').waitFor();
      assert.ok(
        await page.locator('#reader-pdf-canvas').evaluate((c) => {
          const a = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let dark = 0;
          for (let i = 0; i < a.length; i += 4) if (a[i] < 180) dark++;
          return dark > 100;
        }),
      );
      await mkdir('.artifacts/library/render-stability', { recursive: true });
      await page.screenshot({ path: `.artifacts/library/render-stability/${viewport.width}.png` });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
}
