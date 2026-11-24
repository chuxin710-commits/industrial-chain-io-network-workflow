import assert from 'node:assert/strict';
import test from 'node:test';
import { assess, EVIDENCE, RULES } from '../src/io-compilation-rules.js';

const verify = (...keys) => Object.fromEntries(keys.map(key => [key, { state: 'verified', note: 'synthetic fixture' }]));
const ras = 'update_competitive_ras';
const status = (id, keys) => assess(id, verify('scope_ok', ...keys)).status;

test('policy evidence and deployment support are distinct', () => {
  assert.equal(Object.keys(RULES).length, 18);
  for (const [id, rule] of Object.entries(RULES)) {
    for (const name of [...rule.requires, ...rule.conflicts]) assert.ok(EVIDENCE[name]);
    assert.equal(assess(id, {}).status, 'missing');
    assert.equal(assess(id, verify(...rule.requires)).status, rule.status);
  }
  assert.equal(assess('transform_product_B', verify(...RULES.transform_product_B.requires)).operator, 'not_implemented');
});

test('published reuse, competitive update and partial Z', () => {
  assert.equal(status('reuse_published', ['published_target']), 'reuse');
  assert.equal(status(ras, ['published_target']), 'missing');
  const z = ['base_aligned', 'z_margins', 'support_ok', 'estimate_allowed'];
  assert.equal(status('estimate_z_only', z), 'partial');
  assert.equal(status(ras, z), 'missing');
  assert.equal(status(ras, [...z, 'target_blocks']), 'estimated');
});

test('scope gate precedes conflict; a conflict takes precedence over missing facts', () => {
  assert.equal(assess(ras, verify('support_conflict')).status, 'missing');
  assert.equal(status(ras, ['support_conflict']), 'conflict');
  assert.equal(assess('reuse_published', { ...verify('scope_ok'), published_target: { state: 'verified', note: ' ' } }).status, 'missing');
});

test('rectangular SUT and imports remain conditional', () => {
  assert.equal(status('transform_product_A', ['sut_balanced', 'sut_product_B_ok']), 'missing');
  assert.equal(status('transform_product_B', ['sut_balanced', 'sut_product_B_ok']), 'feasible');
  assert.equal(status('split_observed_imports', ['total_uses_ready']), 'missing');
  assert.equal(status('split_estimated_imports', ['total_uses_ready', 'origin_use_prior', 'estimate_allowed']), 'estimated');
  assert.equal(status('multi_region', ['regional_blocks_ready']), 'missing');
  assert.equal(status('constant_price', ['current_table_ready']), 'missing');
});
