export const topics = { industry: '产业链', supply: '供应链', ai: 'AI 前沿' };
export function safeUrl(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function normalizeItems(items) {
  const unique = new Map();
  for (const a of Array.isArray(items) ? items : []) {
    if (!a || !/^[a-f0-9]{20}$/.test(a.id) || !a.title || !safeUrl(a.url) || !Number.isFinite(Date.parse(a.published_at))) continue;
    unique.set(a.id, { id: a.id, title: String(a.title).slice(0, 500), source: String(a.source || '未知来源').slice(0, 120), url: safeUrl(a.url), published_at: a.published_at,
      topics: (Array.isArray(a.topics) ? a.topics : []).filter((t) => topics[t]), editions: (Array.isArray(a.editions) ? a.editions : []).map(String).slice(0, 12) });
  }
  return [...unique.values()];
}
export function filterItems(items, filters, personal, reference) {
  const query = filters.query.trim().toLocaleLowerCase();
  return items.filter((a) => {
    const age = reference - Date.parse(a.published_at);
    return (filters.topic === 'all' || a.topics.includes(filters.topic)) && (!filters.source || a.source === filters.source) &&
      (!query || `${a.title} ${a.source} ${a.topics.map((t) => topics[t]).join(' ')}`.toLocaleLowerCase().includes(query)) &&
      (filters.view === 'saved' || (age >= 0 && age <= Number(filters.hours) * 3600000)) &&
      (filters.read === 'all' || (filters.read === 'read' ? !!personal.read[a.id] : !personal.read[a.id]));
  }).sort((a, b) => (Date.parse(b.published_at) - Date.parse(a.published_at) || a.id.localeCompare(b.id)) * (filters.sort === 'oldest' ? -1 : 1));
}
export function cleanPersonal(value) {
  const valid = (o) => o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  const saved = normalizeItems(Object.values(valid(value?.saved))).slice(-500);
  return { saved: Object.fromEntries(saved.map((a) => [a.id, a])),
    read: Object.fromEntries(Object.entries(valid(value?.read)).filter(([id, at]) => /^[a-f0-9]{20}$/.test(id) && Number.isFinite(at)).slice(-2000)),
    notes: Object.fromEntries(Object.entries(valid(value?.notes)).filter(([id, note]) => /^[a-f0-9]{20}$/.test(id) && typeof note === 'string').slice(-500).map(([id, note]) => [id, note.slice(0, 2000)])), compact: !!value?.compact };
}
export function toMarkdown(items, personal, title) {
  const escape = (s) => String(s).replace(/[\\`*_{}\[\]<>#]/g, '\\$&').replace(/\r?\n/g, ' ');
  return `# ${escape(title)}\n\n标题与来源索引，非新闻全文或已核验事实。\n\n` + items.map((a) =>
    `## ${escape(a.title)}\n\n${escape(a.source)} · ${a.published_at} · ${a.topics.map((t) => topics[t]).join(' / ')}\n\n[查看原文](<${encodeURI(a.url).replace(/>/g, '%3E')}>)\n${personal.notes[a.id] ? `\n个人笔记：${escape(personal.notes[a.id])}\n` : ''}`
  ).join('\n');
}
