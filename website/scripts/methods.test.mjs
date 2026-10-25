import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import katex from 'katex';
import { methods, stages, sources } from '../src/method-catalog.js';

test('server tutor definitions and version exactly match the published handbook', async () => {
  const catalog = JSON.parse(await readFile(resolve(import.meta.dirname, '../server/method_catalog.json'), 'utf8'));
  assert.deepEqual(catalog.methods, methods);
  assert.deepEqual(catalog.sources, sources);
  assert.equal(catalog.version, createHash('sha256').update(JSON.stringify({ methods, sources })).digest('hex'));
});

test('every method has complete formula, symbol, parameter, source and boundary sections', () => {
  assert.equal(new Set(methods.map((m) => m.id)).size, 15);
  assert.equal(stages.length, 5);
  for (const m of methods) {
    assert.ok(stages.some((s) => s.id === m.stage));
    for (const key of ['title', 'status', 'purpose', 'input', 'output'])
      assert.ok(m[key], `${m.id}.${key}`);
    for (const key of ['formulas', 'symbols', 'parameters', 'boundaries', 'source'])
      assert.ok(m[key].length, `${m.id}.${key}`);
    for (const path of m.source) assert.ok(sources.files.some((f) => f.path === path));
  }
});
test('all formula and symbol expressions render strictly without KaTeX errors', () => {
  for (const m of methods)
    for (const tex of [...m.formulas.map((f) => f.tex), ...m.symbols.map(([s]) => s)]) {
      assert.ok(
        katex
          .renderToString(tex, { throwOnError: true, strict: 'error', trust: false })
          .includes('katex'),
      );
    }
});
test('source hashes and published parameters match the actual repository files', async () => {
  const root = resolve(import.meta.dirname, '../..');
  for (const file of sources.files) {
    const bytes = await readFile(resolve(root, file.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
  }
  for (const [key, path] of [
    ['critical', 'critical_sectors'],
    ['structure', 'structure_resilience'],
  ]) {
    assert.deepEqual(
      sources[key],
      JSON.parse(await readFile(resolve(root, `research/${path}/published/config.json`), 'utf8')),
    );
  }
});
