import { safe } from './library.js';
import './framework.css';

const themes = [
  ['network', '产业链建网', '节点 · 关系 · 权重'],
  ['resilience', '韧性', '承压 · 适应 · 恢复'],
  ['security', '安全', '依赖 · 瓶颈 · 替代'],
  ['shock', '冲击', '情景 · 传导 · 连锁'],
];
const phases = {
  matching: '正在匹配文献标签与概述',
  reading: '正在下钻相关文献原文',
  framework: '正在构建方法分支',
  review: '正在自检公式、识别条件与数据要求',
  complete: '框架已生成',
};

export function createFrameworkPanel(root, { refreshIcons, toast, onSelectionChange = () => {}, onOpenFlow = () => {} }) {
  const $ = (selector) => root.querySelector(selector);
  let user,
    result,
    theme = 'network',
    generation = 0,
    selected = new Set(),
    pending = false;
  root.innerHTML = `<div class="framework-heading"><div><p class="eyebrow">LITERATURE → EVIDENCE → RESEARCH</p><h2>从一个问题，组织一条研究路径。</h2></div><span class="state-tag">DeepSeek · 文献方法框架</span></div>
    <div class="framework-themes" role="group" aria-label="研究主题">${themes.map(([id, title, detail], i) => `<button type="button" data-theme="${id}" aria-pressed="${i === 0}"><span>0${i + 1}</span><strong>${title}</strong><small>${detail}</small></button>`).join('')}</div>
    <div class="framework-command"><span id="framework-corpus">正在连接私有文献库</span><button class="button button-primary" id="framework-generate" type="button"><i data-lucide="git-fork"></i>生成研究框架</button></div>
    <p id="framework-status" role="status"></p><div id="framework-result" hidden></div>
    <div class="framework-empty" id="framework-empty"><div><i data-lucide="book-open"></i><strong>文献匹配</strong></div><span>→</span><div><i data-lucide="search"></i><strong>原文证据</strong></div><span>→</span><div><i data-lucide="git-fork"></i><strong>方法分支</strong></div><span>→</span><div><i data-lucide="check-check"></i><strong>研究核验</strong></div></div>`;

  async function request(path, body) {
    const response = await fetch(
      `/api/library${path}`,
      body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': user?.csrf || '' },
            body: JSON.stringify(body),
          }
        : {},
    );
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || 'AI 服务暂不可用');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function clearPrivate() {
    generation++;
    pending = false;
    user = null;
    result = null;
    selected.clear();
    onSelectionChange(null, []);
    $('#framework-result').innerHTML = '';
    $('#framework-result').hidden = true;
    $('#framework-empty').hidden = false;
    $('#framework-generate').disabled = false;
  }
  async function session() {
    try {
      user = (await request('/session')).user;
      if (!user) {
        clearPrivate();
        $('#framework-corpus').innerHTML = '<a href="#literature">登录课题组文献库</a>后生成';
        return false;
      }
      const status = await request('/ai/status');
      $('#framework-corpus').textContent =
        `${status.ready} 篇已解析 · ${status.pending} 篇待解析${status.needs_ocr ? ` · ${status.needs_ocr} 篇待 OCR` : ''}${status.failed ? ` · ${status.failed} 篇解析失败` : ''}`;
      return true;
    } catch (error) {
      if (error.status === 401) clearPrivate();
      $('#framework-status').textContent = error.message;
      return false;
    }
  }
  function references(option) {
    return option.citations
      .map((ref) => {
        const source = result.sources.find((s) => s.id === ref.document_id);
        return `<a href="#literature/read/${safe(ref.document_id)}/${ref.page}" class="framework-citation" title="${safe(source?.title)}"><i data-lucide="book-open"></i>${safe(source?.title)} · PDF 第 ${ref.page} 页</a>`;
      })
      .join('');
  }
  function render() {
    $('#framework-empty').hidden = true;
    $('#framework-result').hidden = false;
    $('#framework-result').innerHTML =
      `<div class="framework-title"><div><p class="eyebrow">${safe(themes.find(([id]) => id === result.theme)?.[1])} / RESEARCH PATH</p><h2>${safe(result.title)}</h2><p>${safe(result.question)}</p></div><button type="button" class="button button-quiet" id="framework-export"><i data-lucide="download"></i>导出所选框架</button></div>
      <div class="framework-route" aria-label="所选研究路径"></div>
      <div class="framework-flow-command"><span id="framework-selected-count"></span><button type="button" class="button button-primary" id="framework-open-flow"><i data-lucide="git-fork"></i>生成流程导图</button></div>
      <div class="framework-layout"><div class="framework-stages">${result.stages.map((stage, index) => `<section class="framework-stage"><header><span>0${index + 1}</span><h3>${safe(stage.title)}</h3></header><div class="framework-options">${stage.options.map((option) => `<article class="framework-option" data-option="${option.id}"><label class="framework-option-title"><input type="checkbox" value="${option.id}" ${selected.has(option.id) ? 'checked' : ''}/><strong>${safe(option.title)}</strong></label><span class="framework-basis ${option.basis === 'ai' ? 'is-ai' : ''}">${option.basis === 'literature' ? '本库文献方法参考' : 'AI 补充建议 · 待核验'}</span><p>${safe(option.theory)}</p><details><summary>实施步骤与参数</summary><dl><dt>数据口径</dt><dd>${safe(option.data)}</dd><dt>公式</dt><dd class="framework-formula">${safe(option.formula || '本方案无统一计算式')}</dd><dt>变量与参数</dt><dd>${safe(option.parameters)}</dd><dt>假设条件</dt><dd>${safe(option.assumptions)}</dd></dl><ol>${option.steps.map((step) => `<li>${safe(step)}</li>`).join('')}</ol><dl><dt>核验方法</dt><dd>${safe(option.validation)}</dd><dt>局限</dt><dd>${safe(option.limitations)}</dd></dl></details>${option.requires.length ? `<div class="framework-requires"><strong>搭配条件</strong>${option.requires.map((r) => `<p>${safe(r)}</p>`).join('')}</div>` : ''}<div class="framework-references">${references(option)}</div></article>`).join('')}</div></section>`).join('')}</div>
      <aside class="framework-evidence"><p class="eyebrow">SOURCE NOTES</p><h3>本次匹配文献</h3><p class="framework-note">${result.corpus_count} 篇已解析文献中匹配 ${result.sources.length} 篇。以下为 AI 相关性判断；页码指 PDF 物理页。</p>${result.sources.map((source, i) => `<details ${i === 0 ? 'open' : ''}><summary><span>0${i + 1}</span> ${safe(source.title)}</summary><p>${safe(source.reason)}</p><p class="framework-note">原文下钻页：${source.pages.map((p) => `<a href="#literature/read/${source.id}/${p.page}">${p.page}</a>`).join(' · ')}</p><a class="inline-button" href="#literature/read/${source.id}/${source.pages[0]?.page || 1}">查看原文 <i data-lucide="arrow-up-right"></i></a></details>`).join('')}<p class="framework-note">${safe(result.model)} · ${new Date(result.created * 1000).toLocaleDateString('zh-CN')}<br/>文献按页节选下钻，非逐篇系统综述。引用定位已核验，方法解释和方案兼容性仍须研究者确认。</p></aside></div>
      <section class="framework-cautions">${result.review_notes?.length ? `<h3>AI 方法自检</h3><ul>${result.review_notes.map((c) => `<li>${safe(c)}</li>`).join('')}</ul>` : ''}<h3>研究边界</h3><ul>${result.cautions.map((c) => `<li>${safe(c)}</li>`).join('')}</ul><p>所选分支是研究草案；AI 自检不能替代人工审稿，不代表组合已通过科学有效性检验，也不代表已运行实证计算。</p></section>`;
    updateSelection();
    refreshIcons();
  }
  function updateSelection() {
    onSelectionChange(result, [...selected]);
    $('#framework-selected-count').textContent = `已选 ${selected.size} 个方案`;
    $('#framework-open-flow').disabled = selected.size === 0;
    root
      .querySelectorAll('[data-option]')
      .forEach((element) =>
        element.classList.toggle('is-selected', selected.has(element.dataset.option)),
      );
    $('.framework-route').innerHTML = result.stages
      .map(
        (stage, i) =>
          `<div><small>0${i + 1} / ${safe(stage.title)}</small><strong>${safe(
            stage.options
              .filter((o) => selected.has(o.id))
              .map((o) => o.title)
              .join(' + ') || '尚未选择',
          )}</strong></div>`,
      )
      .join('<span aria-hidden="true">→</span>');
  }
  async function generate() {
    if (pending || !(await session())) return;
    const token = ++generation;
    pending = true;
    onSelectionChange(null, []);
    $('#framework-generate').disabled = true;
    $('#framework-result').hidden = true;
    $('#framework-empty').hidden = false;
    $('#framework-status').textContent = '正在提交研究主题';
    try {
      let job = await request('/ai/framework', { theme });
      while (job.status === 'running' && token === generation) {
        $('#framework-status').textContent =
          `${phases[job.phase] || '正在生成'}${job.result?.matched ? ` · ${job.result.matched} 篇` : ''}`;
        await new Promise((resolve) => setTimeout(resolve, 2500));
        if (token !== generation) return;
        job = await request(`/ai/framework/${job.id}`);
      }
      if (token !== generation) return;
      if (job.status !== 'ready') throw new Error(job.error || '生成未完成，请重试');
      result = job.result;
      selected = new Set(result.stages.map((s) => s.options[0].id));
      render();
      $('#framework-status').textContent = '框架已生成 · 可选择分支组成研究草案';
    } catch (error) {
      if (token !== generation) return;
      if (error.status === 401) clearPrivate();
      $('#framework-status').textContent = error.message;
    } finally {
      if (token === generation) {
        pending = false;
        $('#framework-generate').disabled = false;
      }
    }
  }
  function exportSelection() {
    if (!result) return;
    const lines = [
      `# ${result.title}`,
      result.question,
      `生成模型：${result.model}；时间：${new Date(result.created * 1000).toISOString()}`,
      'AI 研究草案，未执行实证；引用定位不等于内容已由研究者复核。',
    ];
    for (const stage of result.stages) {
      lines.push(`\n## ${stage.title}`);
      for (const option of stage.options.filter((o) => selected.has(o.id))) {
        lines.push(
          `### ${option.title}`,
          option.basis === 'literature' ? '本库文献方法参考' : 'AI 补充建议，待核验',
        );
        for (const key of [
          'theory',
          'data',
          'formula',
          'parameters',
          'assumptions',
          'validation',
          'limitations',
        ])
          lines.push(`${key}: ${option[key]}`);
        lines.push(
          ...option.steps.map((s, i) => `${i + 1}. ${s}`),
          ...option.requires.map((s) => `搭配条件：${s}`),
        );
        lines.push(
          ...option.citations.map(
            (c) =>
              `[${result.sources.find((s) => s.id === c.document_id)?.title}，PDF 第 ${c.page} 页](${location.origin}${location.pathname}#literature/read/${c.document_id}/${c.page})`,
          ),
        );
      }
    }
    lines.push('\n## AI 方法自检', ...(result.review_notes || []), '\n## 边界', ...result.cautions);
    const url = URL.createObjectURL(
      new Blob([lines.join('\n\n')], { type: 'text/markdown;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `chainlab-${result.theme}-framework.md`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出所选研究框架');
  }
  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme]');
    if (button) {
      generation++;
      pending = false;
      $('#framework-generate').disabled = false;
      theme = button.dataset.theme;
      root
        .querySelectorAll('[data-theme]')
        .forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      result = null;
      onSelectionChange(null, []);
      $('#framework-result').hidden = true;
      $('#framework-result').innerHTML = '';
      $('#framework-empty').hidden = false;
      $('#framework-status').textContent = '';
    }
    if (event.target.closest('#framework-export')) exportSelection();
    if (event.target.closest('#framework-open-flow') && result && selected.size) onOpenFlow();
  });
  root.addEventListener('change', (event) => {
    if (event.target.matches('[data-option] input')) {
      event.target.checked ? selected.add(event.target.value) : selected.delete(event.target.value);
      updateSelection();
    }
  });
  $('#framework-generate').addEventListener('click', generate);
  document.addEventListener('library-session-change', session);
  window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#knowledge')) session();
  });
  refreshIcons();
  return { activate: session };
}
