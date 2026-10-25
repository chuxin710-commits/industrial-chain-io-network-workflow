import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterItems, normalizeItems, cleanPersonal, safeUrl, toMarkdown } from '../src/briefing-model.js';
const now = Date.parse('2026-10-25T00:00:00Z');
const item = (n, hours = 0, topic = 'ai') => ({ id: n.toString(16).padStart(20, '0'), title: `Research ${n}`, source: n % 2 ? 'Publisher A' : 'Publisher B', topics: [topic], editions: ['US:en'], published_at: new Date(now - hours * 3600000).toISOString(), url: 'https://example.com/' + n });
const filters = { view: 'feed', topic: 'all', query: '', source: '', hours: '72', read: 'all', sort: 'newest' };
test('time boundaries, sorting and compound filtering', () => {
  const items = normalizeItems([item(1, 0), item(2, 24), item(3, 72), item(4, 73), item(5, -1), item(6, 4, 'supply')]);
  const personal = cleanPersonal({ read: { [item(2).id]: 10 } });
  assert.deepEqual(filterItems(items, filters, personal, now).map((a) => a.id), [1, 6, 2, 3].map((n) => item(n).id));
  assert.equal(filterItems(items, { ...filters, topic: 'ai', hours: 24, read: 'read', source: 'Publisher B', query: 'research' }, personal, now).length, 1);
  assert.equal(filterItems(items, { ...filters, sort: 'oldest' }, personal, now)[0].id, item(3).id);
  assert.equal(filterItems([item(4, 73)], { ...filters, view: 'saved' }, personal, now).length, 1);
});
test('snapshots and exports reject unsafe input, retain notes and bound local storage', () => {
  const a = item(1, 1);
  assert.equal(normalizeItems([a, a, { ...a, id: 'wrong' }, { ...a, url: 'javascript:alert(1)' }]).length, 1);
  assert.equal(safeUrl('https://user:secret@example.com'), '');
  const p = cleanPersonal({ saved: { [a.id]: a }, notes: { [a.id]: '学习笔记', wrong: '<script>' }, read: null });
  assert.ok(toMarkdown([a], p, '导出').includes('学习笔记'));
  assert.equal(Object.keys(p.notes).length, 1);
  assert.equal(cleanPersonal({ saved: Object.fromEntries(Array.from({ length: 600 }, (_, n) => [item(n, 1).id, item(n, 1)])) }).saved[ item(0).id ], undefined);
});
