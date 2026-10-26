import './research-evidence.css';

export const escapeEvidence = (value) => String(value ?? '').replace(/[&<>"']/g, (s) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[s]);

export function evidenceLabel(id, retrieval) {
  const index = retrieval?.sources.findIndex((s) => s.id === id) ?? -1;
  return index < 0 ? id : `证据 ${index + 1}`;
}

export function evidenceHTML(retrieval, citations = []) {
  if (!retrieval) return '';
  const esc = escapeEvidence;
  const used = new Set(citations.map((s) => s.id));
  return `<section class="research-evidence"><h4>本次检索依据</h4><p>${esc(retrieval.documents)} 篇文献 · ${esc(retrieval.chunks)} 个知识片段 · ${esc(retrieval.retrieval_ms)} ms</p><p>${esc(retrieval.notice)}</p>
    ${retrieval.sources.map((s, i) => {
      const href = /^(#literature\/read\/[a-f0-9]{32}\/[1-9]\d*|#methods\/[a-z]+)$/.test(s.href) ? s.href : '';
      return `<details><summary><span>证据 ${i+1} · ${s.kind === 'paper' ? '文献原文' : '项目知识卡'} · ${used.has(s.id) ? '回答引用' : '检索候选'}</span><strong>${esc(s.title)}</strong>${s.page ? `<small>PDF 第 ${esc(s.page)} 页</small>` : ''}</summary><blockquote>${esc(s.text)}</blockquote><p>${href ? `<a href="${esc(href)}">${s.page ? '阅读原文' : '查看方法'} ↗</a>` : ''}<small>索引 ID ${esc(s.id)}</small></p></details>`;
    }).join('')}
    <small>TF-IDF + LSA 向量检索 · 索引 ${esc(retrieval.version.slice(0, 12))}</small></section>`;
}
