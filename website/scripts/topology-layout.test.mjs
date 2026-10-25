import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sharedLayout } from '../src/topology-layout.js';
import { launchBrowser } from './browser.mjs';
import { ensurePreview } from './preview.mjs';

const frames = [
  {
    nodes: ['A', 'B', 'C'].map((id, i) => ({ id, strength: i + 1 })),
    edges: [
      { source: 'A', target: 'B', weight: 0.1 },
      { source: 'B', target: 'C', weight: 0.2 },
    ],
  },
];

test('worker preserves deterministic shared layout and cancels promptly', async () => {
  const expected = await sharedLayout(frames);
  const browser = await launchBrowser();
  try {
    const preview = await ensurePreview();
    const page = await browser.newPage();
    await page.goto(preview.url + 'workspace.html');
    const result = await page.evaluate(async (frames) => {
      const { layoutInWorker } = await import('/src/topology-worker-client.js');
      const value = await layoutInWorker(frames, new AbortController().signal);
      const controller = new AbortController();
      const cancelled = layoutInWorker(frames, controller.signal).then(
        () => 'unexpected',
        (e) => e.name,
      );
      controller.abort();
      const aborted = await layoutInWorker(frames, controller.signal).then(
        () => 'unexpected',
        (e) => e.name,
      );
      return {
        positions: [...value.positions],
        maximum: value.maximum,
        radius: value.radius(1),
        cancelled: await cancelled,
        aborted,
      };
    }, frames);
    assert.deepEqual(result.positions, [...expected.positions]);
    assert.equal(result.maximum, expected.maximum);
    assert.equal(result.radius, expected.radius(1));
    assert.equal(result.cancelled, 'AbortError');
    assert.equal(result.aborted, 'AbortError');
  } finally {
    await browser.close();
  }
});
