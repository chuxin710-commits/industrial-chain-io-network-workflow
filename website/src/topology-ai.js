import { evidenceHTML, evidenceLabel, escapeEvidence as esc } from './research-evidence.js';
import './topology-ai.css';

const prompts = [
  ['结构解读', '请分析本次网络的密度、孤立节点和头部节点强度，区分实算观察、文献机制和不能推出的结论。'],
  ['韧性线索', '这些结构结果提供了哪些产业链韧性或脆弱性线索？请结合文献说明假设与下一步需要执行的检验。'],
  ['跨年比较', '请比较所选年份的结构和头部强度节点变化，明确可比性边界，不把变化解释成因果效应。'],
];

export function createTopologyAI({ section, getContext, refreshIcons, stopPlayback }) {
  const panel = document.createElement('section');
  panel.className = 'topology-ai';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'topology-ai-title');
  panel.innerHTML = `<header><div><p class="eyebrow">EVIDENCE / INTERPRETATION</p><h2 id="topology-ai-title">网络研究助理</h2><p id="topology-ai-context"></p></div><button type="button" class="icon-button" id="topology-ai-close" aria-label="关闭分析" title="关闭分析"><i data-lucide="x"></i></button></header>
    <div id="topology-ai-access" role="status"></div>
    <form id="topology-ai-form"><div class="topology-ai-options"><label>分析范围<select id="topology-ai-scope"><option value="current">当前年份</option><option value="all">全部已生成年份</option></select></label><label class="topology-ai-focus"><input id="topology-ai-node" type="checkbox" />聚焦所选节点</label></div>
    <div class="topology-ai-prompts">${prompts.map(([label], i) => `<button type="button" class="button button-outline" data-topology-prompt="${i}">${label}</button>`).join('')}</div>
    <label for="topology-ai-question">研究问题</label><textarea id="topology-ai-question" rows="2" maxlength="1000" required placeholder="例如：高强度节点意味着更容易传播冲击吗？"></textarea><div class="topology-ai-actions"><small>AI 解读不是新增实证计算，文献引用仍需核验。</small><button type="submit" id="topology-ai-send" class="button button-primary"><i data-lucide="sparkles"></i>分析结果</button></div></form>
    <p id="topology-ai-status" role="status" aria-live="polite"></p><div id="topology-ai-answer" aria-live="polite"></div>`;
  section.querySelector('#topo-year-tabs').after(panel);
  const button = document.createElement('button');
  button.type = 'button'; button.id = 'topology-ai-open'; button.className = 'button button-quiet';
  button.innerHTML = '<i data-lucide="sparkles"></i>AI 解读';
  section.querySelector('.topo-toolbar > div:first-child').append(button);
  const $ = (s) => panel.querySelector(s);
  let user = null, generation = 0, abort, busy = false, signature = '';
  function controls() {
    panel.querySelectorAll('textarea, select, [data-topology-prompt], #topology-ai-send').forEach((el) => { el.disabled = busy || !user; });
    $('#topology-ai-node').disabled = busy || !user || !getContext().selected;
    $('#topology-ai-answer').setAttribute('aria-busy', String(busy));
  }
  function clear() {
    generation++; abort?.abort(); abort = null; busy = false;
    $('#topology-ai-answer').replaceChildren(); $('#topology-ai-status').textContent = '';
    controls();
  }
  async function request(path, body, signal) {
    const response = await fetch('/api/library' + path, { signal,
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': user?.csrf || '' }, body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    if (!response.ok) { const error = new Error(value.error || '服务暂不可用'); error.status = response.status; throw error; }
    return value;
  }
  async function session() {
    const token = generation;
    try {
      const value = await request('/session');
      if (token !== generation || panel.hidden) return;
      user = value.user;
      $('#topology-ai-access').innerHTML = user ? '' : '<a href="#literature">登录课题组账号</a>后使用文献增强分析。';
      controls();
    } catch {
      if (token === generation) $('#topology-ai-access').textContent = '登录状态暂不可用，请关闭后重试。';
    }
  }
  function contextLabel() {
    const { frames, frameIndex, selected } = getContext();
    if (!frames.length) return;
    const frame = frames[frameIndex];
    if (!selected) $('#topology-ai-node').checked = false;
    const all = $('#topology-ai-scope').value === 'all';
    $('#topology-ai-context').textContent = `${all ? frames.map((f) => f.year).join('、') : frame.year} · ${{ sector: '全国行业', province: '省际关联', node: '省份 × 行业' }[frame.config.level]} · ${frame.config.weight} ≥ ${frame.config.threshold}${$('#topology-ai-node').checked && selected ? ' · 节点 ' + selected : ''}`;
    controls();
  }
  function render(result) {
    const facts = result.facts;
    $('#topology-ai-answer').innerHTML = `<article><h3>研究解读</h3><p class="topology-ai-summary">${esc(result.summary)}</p>
      <details class="topology-ai-facts"><summary>服务器实算依据 · ${facts.length} 个年度</summary><div class="topo-table-scroll"><table class="topo-table"><thead><tr><th>事实</th><th>年份</th><th>节点</th><th>全网边</th><th>密度</th><th>孤立点</th></tr></thead><tbody>${facts.map((f) => `<tr><td>${esc(f.id)}</td><td>${f.year}</td><td>${f.metrics.nodes}</td><td>${f.metrics.edges}</td><td>${(f.metrics.density * 100).toFixed(2)}%</td><td>${f.metrics.isolates}</td></tr>`).join('')}</tbody></table></div></details>
      <div class="topology-ai-sections"><section><h4>01 / 实算观察</h4>${result.observations.map((s) => `<p>${esc(s.text)} <small>${esc(s.fact_ids.join(' · '))}</small></p>`).join('')}</section><section><h4>02 / 机制与假设</h4>${result.interpretations.map((s) => `<p><small>${esc(s.basis || '')}</small><br>${esc(s.text)} <small>${esc(s.evidence_ids.map((id) => evidenceLabel(id, result.retrieval)).join(' · '))}</small></p>`).join('')}</section><section><h4>03 / 下一步检验</h4><ul>${result.next_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></section><section><h4>04 / 解释边界</h4><ul>${result.limitations.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></section></div>
      ${evidenceHTML(result.retrieval, result.citations)}<footer>${esc(result.model)} · ${esc(result.version)} · 实算指纹 ${esc(result.fact_sha256.slice(0, 12))}</footer></article>`;
  }
  async function ask(question) {
    if (busy || !user || !question.trim()) return;
    const context = getContext();
    const chosen = $('#topology-ai-scope').value === 'all' ? context.frames : [context.frames[context.frameIndex]];
    if (!chosen[0]) return;
    stopPlayback();
    const { year: _year, ...config } = chosen[0].config;
    const data = { years: chosen.map((f) => f.year), config, node: $('#topology-ai-node').checked ? context.selected : null, question: question.trim() };
    const token = ++generation;
    abort = new AbortController(); busy = true; controls();
    $('#topology-ai-answer').replaceChildren();
    $('#topology-ai-status').textContent = '正在核对实算结果、检索文献并生成分析…';
    const timeout = setTimeout(() => abort?.abort(), 420000);
    try {
      let job = await request('/ai/topology', data, abort.signal);
      const deadline = Date.now() + 410000;
      while (job.status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 1800));
        if (token !== generation) return;
        if (Date.now() > deadline) throw new Error('等待时间较长，请稍后重新提交相同问题查看结果');
        job = await request('/ai/topology/' + job.id, null, abort.signal);
      }
      if (token !== generation) return;
      if (job.status !== 'ready') throw new Error(job.error || '分析未完成，请重试');
      if (JSON.stringify(job.result.context) !== JSON.stringify({ years: data.years, config: data.config, node: data.node })) {
        // JSON key order is not a contract; compare individual canonical values below.
        const c = job.result.context;
        if (!c || c.node !== data.node || JSON.stringify(c.years) !== JSON.stringify(data.years) || Object.keys(config).some((k) => String(c.config[k]) !== String(config[k]))) throw new Error('分析口径不一致，请重新生成');
      }
      if (job.result.facts.length !== chosen.length || job.result.facts.some((f, i) => f.year !== chosen[i].year || f.source.sha256 !== chosen[i].source.sha256 || f.method.adapter_sha256 !== chosen[i].method.adapter_sha256 || f.method.kernel_sha256 !== chosen[i].method.kernel_sha256)) throw new Error('数据或计算代码已更新，请重新生成拓扑后分析');
      render(job.result);
      $('#topology-ai-status').textContent = '分析完成 · 证据与原文入口见下方';
    } catch (error) {
      if (token !== generation) return;
      if ([401, 403].includes(error.status)) { user = null; $('#topology-ai-access').innerHTML = '<a href="#literature">重新登录课题组账号</a>后提问。'; }
      $('#topology-ai-status').textContent = error.name === 'AbortError' ? '请求超时，请重试' : error.message;
      $('#topology-ai-question').value = question;
    } finally { clearTimeout(timeout); if (token === generation) { busy = false; controls(); } }
  }
  button.onclick = () => {
    clear(); user = null; panel.hidden = false; stopPlayback();
    $('#topology-ai-node').checked = !!getContext().selected;
    contextLabel(); controls(); refreshIcons(); session();
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $('#topology-ai-close').onclick = () => { clear(); panel.hidden = true; button.focus(); };
  $('#topology-ai-form').onsubmit = (event) => { event.preventDefault(); ask($('#topology-ai-question').value); };
  panel.querySelectorAll('[data-topology-prompt]').forEach((b) => { b.onclick = () => {
    const i = Number(b.dataset.topologyPrompt);
    if (i === 2) { $('#topology-ai-scope').value = 'all'; contextLabel(); }
    $('#topology-ai-question').value = prompts[i][1]; ask(prompts[i][1]);
  }; });
  for (const id of ['#topology-ai-scope', '#topology-ai-node']) $(id).onchange = () => { clear(); contextLabel(); };
  window.addEventListener('hashchange', () => { clear(); panel.hidden = true; });
  document.addEventListener('library-session-change', () => { clear(); user = null; controls(); if (!panel.hidden) session(); });
  return {
    reset() { clear(); panel.hidden = true; signature = ''; },
    update() {
      const c = getContext();
      const next = JSON.stringify([c.frames.map((f) => [f.year, f.config, f.source.sha256]), c.frameIndex, c.selected]);
      if (signature !== next) {
        clear(); signature = next;
        if (!panel.hidden) { contextLabel(); if (!user) session(); }
      }
    },
  };
}
