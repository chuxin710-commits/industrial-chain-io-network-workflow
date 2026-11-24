import { TableProperties, FlaskConical, Upload, FileCheck2 } from 'lucide';
import { safe } from './library.js';
import { assess, CANDIDATES, EVIDENCE, POLICY, PURPOSES, RULES, SAMPLE } from './io-compilation-rules.js';
import './io-compilation.css';

export const compilationIcons = { TableProperties, FlaskConical, Upload, FileCheck2 };
const STATES = { unknown: '未核实', verified: '已核实', missing: '缺失', incompatible: '不相容', forbidden: '未授权' };
const STATUSES = { missing: '待补资料', conflict: '约束冲突', reuse: '可复用成品表', estimated: '估计可编', partial: '仅可估计 Z', feasible: '具备编制前提' };
const OPERATORS = { ras: '网站已实现 RAS；仍须通过数值预检', reuse: '使用原发布表；本工具不代替导入或对账', not_implemented: '可评估 · 暂未实现计算算子' };
const START_YEAR = new Date().getFullYear();
const amount = value => String(Number(value.toPrecision(8)));

function saveFile(filename, data, type = 'application/json') {
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([data], { type }));
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function resultCSV(result) {
  const { input: i, table: t } = result;
  const q = v => typeof v === 'number' ? String(v) : '"' + (/^\s*[=+@-]/.test(v) ? "'" + v : v).replaceAll('"', '""') + '"';
  return '\ufeff' + [
    ['行类别', '产品 / 分项', ...i.sectors, ...i.final_uses.map(v => '最终使用：' + v), '国内总产出 x', '进口 m'],
    ...i.sectors.map((name, j) => ['产品', name, ...t.z[j], ...t.y[j], t.x[j], t.m[j]]),
    ...i.value_added.map((name, j) => ['增加值', name, ...t.va[j], ...Array(i.final_uses.length + 2).fill('')]),
  ].map(row => row.map(q).join(',')).join('\r\n');
}

export function createCompilation({ refreshIcons }) {
  const root = document.createElement('section');
  root.hidden = true; root.className = 'workspace-panel io-builder';
  root.dataset.workspacePanel = 'compilation';
  root.setAttribute('aria-labelledby', 'io-builder-title');
  document.querySelector('#framework-panels').append(root);
  const $ = selector => root.querySelector(selector);
  let evidence = {}, extra = '', current = null, result = null, revision = 0, busy = false;
  root.innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">INPUT–OUTPUT COMPILATION</p><h1 id="io-builder-title">投入产出表编制</h1><p class="page-description">资料可行性判断与竞争型表调平</p></div><span class="io-edition">研究试验版 · v${POLICY}</span></div>
    <div class="io-tabs" role="group" aria-label="编制阶段"><button type="button" data-io-view="assessment" aria-pressed="true">01　可行性评估</button><button type="button" data-io-view="compilation" aria-pressed="false">02　预检与编表</button></div>
    <div id="io-assessment">
      <div class="io-band io-form">
        <label class="field"><span>研究用途</span><select id="io-purpose">${Object.entries(PURPOSES).map(([id, [title]]) => `<option value="${id}">${title}</option>`).join('')}</select></label>
        <label class="field"><span>统计范围</span><input id="io-region" maxlength="80" placeholder="地区或统计边界" /></label>
        <label class="field"><span>目标年</span><input id="io-year" type="number" min="1900" max="2100" value="${START_YEAR - 1}" /></label>
        <label class="field"><span>期望部门数</span><input id="io-size" type="number" min="1" max="2000" placeholder="待确定" /></label>
        <label class="field"><span>目标计价口径</span><select id="io-valuation"><option>现价</option><option>不变价</option><option>待确定</option></select></label>
      </div>
      <div class="io-split">
        <div class="io-band">
          <div class="io-head"><h2>证据清单</h2><button class="inline-button" id="io-demo"><i data-lucide="flask-conical"></i>载入合成算例</button></div>
          <label class="field"><span>增选候选路线</span><select id="io-extra"><option value="">仅查看用途推荐</option>${Object.entries(RULES).map(([id, rule]) => `<option value="${id}">${rule.title}</option>`).join('')}</select></label>
          <div id="io-evidence"></div>
        </div>
        <div class="io-band">
          <div class="io-head"><h2>候选与缺口</h2><button class="icon-button" id="io-export-assessment" title="导出评估 JSON" aria-label="导出评估 JSON"><i data-lucide="download"></i></button></div>
          <p id="io-purpose-note" class="io-note"></p><div id="io-candidates" aria-live="polite"></div>
          <p class="io-note">自填证据不等于系统独立核验。期望粒度与价格是目标，不代表已取得该口径；可行也不等于获准发布。</p>
        </div>
      </div>
    </div>
    <div id="io-compilation" hidden>
      <div class="io-split">
        <div class="io-band">
          <div class="io-head"><h2>标准化输入</h2><button id="io-example" class="inline-button"><i data-lucide="flask-conical"></i>合成算例</button></div>
          <p class="io-note">单区域、现价竞争型产品表；上限 42 部门。仅提交获准用于本站的汇总数据，不接收涉密或可识别调查对象的材料。输入不存档，也不发送给模型。</p>
          <div class="io-actions"><label class="io-file"><span>导入 JSON</span><input id="io-file" type="file" accept=".json,application/json" aria-label="导入 JSON" /></label><button id="io-template" class="inline-button"><i data-lucide="download"></i>输入模板</button></div>
          <label class="field"><span>编表数据 JSON</span><textarea id="io-input" rows="13" spellcheck="false" placeholder="粘贴模板数据，或导入本工具的运行报告重跑"></textarea></label>
          <button id="io-check" class="button button-primary"><i data-lucide="file-check-2"></i>检查数据与边际</button>
          <p class="io-note">计算沿用课题组登录。<a href="/workspace.html#literature" target="_blank" rel="noopener">打开登录入口</a></p>
        </div>
        <div class="io-band">
          <h2>数值预检与配方</h2>
          <div class="io-formulas"><code>u = x + m − Y·1</code><code>v = x − VAᵀ·1</code></div>
          <p class="io-note">Z 行为供给部门，列为使用部门；进口为正向供给，原先验的零单元保持为零。</p>
          <p id="io-run-status" class="io-note" role="status">尚未预检</p><div id="io-preflight"></div>
          <div id="io-confirm" hidden><label class="io-approval"><input id="io-approval" type="checkbox" />我确认当前数据、口径及非负 RAS 配方，仅用于研究试算</label><button id="io-run" class="button button-primary" disabled>运行编表</button></div>
        </div>
      </div>
      <div id="io-result" class="io-band" hidden>
        <div class="io-head"><h2>调平结果</h2><div class="io-actions"><button id="io-csv" class="button button-outline"><i data-lucide="download"></i>表体 CSV</button><button id="io-json" class="button button-outline"><i data-lucide="download"></i>运行报告 JSON</button></div></div>
        <p class="io-note" id="io-verification"></p><p class="io-note">结果仅通过会计平衡检验，尚无独立验证或发布审批；不输出国内乘数。</p>
        <label class="field io-block-select"><span>查看矩阵块</span><select id="io-block"><option value="z">调平后 Z</option><option value="z0">调平前 Z⁰</option><option value="delta">调整量 ΔZ</option><option value="y">最终使用 Y</option><option value="va">增加值 VA</option><option value="xm">总产出 x 与进口 m</option></select></label>
        <div class="io-table-scroll" tabindex="0" aria-label="调平结果表"><table id="io-table"></table></div>
        <p class="io-hash">结果 SHA-256 <code id="io-hash"></code></p>
      </div>
    </div>`;

  const candidates = () => [...new Set([...CANDIDATES[$('#io-purpose').value], ...(extra ? [extra] : [])])];
  function renderEvidence() {
    const keys = [...new Set(candidates().flatMap(id => [...RULES[id].requires, ...RULES[id].conflicts]))];
    $('#io-evidence').innerHTML = keys.map(key => `<div class="io-evidence-line"><label for="io-state-${key}">${EVIDENCE[key]}</label><select id="io-state-${key}" data-state="${key}">${Object.entries(STATES).map(([id, title]) => `<option value="${id}" ${(evidence[key]?.state ?? 'unknown') === id ? 'selected' : ''}>${title}</option>`).join('')}</select><input data-note="${key}" aria-label="${EVIDENCE[key]} 的依据" maxlength="200" placeholder="来源、工作表或核验依据" value="${safe(evidence[key]?.note)}" /></div>`).join('');
    renderCandidates();
  }
  function renderCandidates() {
    $('#io-purpose-note').textContent = PURPOSES[$('#io-purpose').value][1];
    $('#io-candidates').innerHTML = candidates().map(id => {
      const a = assess(id, evidence);
      return `<article class="io-candidate"><div class="io-head"><h3>${a.title}</h3><span class="io-status" data-state="${a.status}">${STATUSES[a.status]}</span></div><p>${a.output}</p><small>${OPERATORS[a.operator]}</small>
      ${a.conflict ? `<p class="io-warn">${safe(evidence[a.conflict].note)}</p>` : ''}
      ${a.gaps.length ? `<details><summary>待核实或补齐 ${a.gaps.length} 项</summary><ul>${a.gaps.map(key => `<li>${EVIDENCE[key]} <small>· ${evidence[key]?.state === 'verified' ? '缺依据' : (STATES[evidence[key]?.state] || STATES.unknown)}</small></li>`).join('')}</ul></details>` : ''}
      ${a.operator === 'ras' && a.status === 'estimated' ? '<button data-open-io-run class="inline-button">进入数值预检</button>' : ''}</article>`;
    }).join('');
  }
  function view(next) {
    $('#io-assessment').hidden = next !== 'assessment';
    $('#io-compilation').hidden = next !== 'compilation';
    root.querySelectorAll('[data-io-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ioView === next)));
  }
  function setBusy(value) {
    busy = value; $('#io-check').disabled = busy; $('#io-run').disabled = busy || !current || !$('#io-approval').checked;
  }
  function invalidate() {
    revision++; current = null; result = null;
    $('#io-approval').checked = false; $('#io-confirm').hidden = true; $('#io-result').hidden = true;
    $('#io-preflight').textContent = ''; $('#io-run-status').textContent = '尚未预检';
    setBusy(busy);
  }
  function error(text) { $('#io-run-status').textContent = text; }
  function importInput(data) {
    const input = data?.status === 'balanced_estimate' ? data.input : data;
    if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('需要 JSON 对象');
    $('#io-input').value = JSON.stringify(input, null, 2); invalidate();
  }
  async function request(action, body) {
    const session = await fetch('/api/library/session', { cache: 'no-store' });
    if (!session.ok) throw new Error('无法读取课题组会话，请重试');
    const { user } = await session.json();
    if (!user) throw new Error('请先登录课题组，再返回当前页面执行。');
    const response = await fetch('/api/library/io-compilation/' + action, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': user.csrf },
      body: JSON.stringify(body),
    });
    if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error(response.status === 413 ? '请求体过大，请缩减输入' : '编表服务暂不可用');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '编表失败');
    return data;
  }
  function renderTable() {
    const { input: i, table: t } = result, block = $('#io-block').value;
    const headings = block === 'y' ? i.final_uses : block === 'xm' ? ['国内总产出 x', '进口 m'] : i.sectors;
    const rows = block === 'va' ? i.value_added : i.sectors;
    const matrix = block === 'xm' ? t.x.map((x, j) => [x, t.m[j]]) : block === 'z0' ? i.z0 : block === 'delta' ? t.z.map((r, j) => r.map((v, k) => v - i.z0[j][k])) : t[block];
    $('#io-table').innerHTML = `<caption>${safe(i.region)} · ${i.year} 年 · ${safe(i.unit)}</caption><thead><tr><th scope="col">行 / 列</th>${headings.map(h => `<th scope="col">${safe(h)}</th>`).join('')}</tr></thead><tbody>${matrix.map((row, j) => `<tr><th scope="row">${safe(rows[j])}</th>${row.map(v => `<td>${amount(v)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  }
  $('#io-evidence').addEventListener('input', e => {
    const { state, note } = e.target.dataset;
    const key = state || note;
    if (!key) return;
    evidence[key] = { ...evidence[key], [state ? 'state' : 'note']: e.target.value };
    renderCandidates();
  });
  $('#io-purpose').addEventListener('change', renderEvidence);
  $('#io-extra').addEventListener('change', e => { extra = e.target.value; renderEvidence(); });
  for (const selector of ['#io-purpose', '#io-region', '#io-year', '#io-size', '#io-valuation']) {
    $(selector).addEventListener('change', () => {
      if (evidence.scope_ok?.state === 'verified') {
        evidence.scope_ok = { ...evidence.scope_ok, state: 'unknown' };
        renderEvidence();
      }
    });
  }
  $('#io-demo').addEventListener('click', () => {
    $('#io-purpose').value = 'structure'; $('#io-region').value = SAMPLE.region; $('#io-year').value = SAMPLE.year;
    $('#io-size').value = SAMPLE.sectors.length; $('#io-valuation').value = '现价';
    evidence = Object.fromEntries(RULES.update_competitive_ras.requires.map(key => [key, { state: 'verified', note: 'v0.4 §7.1 合成算例；不代表真实资料' }]));
    importInput(SAMPLE); renderEvidence();
  });
  $('#io-export-assessment').addEventListener('click', () => {
    const year = $('#io-year'), size = $('#io-size');
    if (!year.reportValidity() || !size.reportValidity()) return;
    saveFile('chainlab-feasibility.json', JSON.stringify({
      policy_version: POLICY, evidence_basis: 'self_reported', purpose: $('#io-purpose').value,
      target: { region: $('#io-region').value, year: year.valueAsNumber || null, departments: size.valueAsNumber || null, valuation: $('#io-valuation').value },
      evidence, candidates: candidates().map(id => assess(id, evidence)),
    }, null, 2));
  });
  $('#io-input').addEventListener('input', invalidate);
  $('#io-approval').addEventListener('change', () => setBusy(busy));
  $('#io-block').addEventListener('change', renderTable);
  $('#io-example').addEventListener('click', () => importInput(SAMPLE));
  $('#io-template').addEventListener('click', () => saveFile('chainlab-ras-template.json', JSON.stringify({
    ...SAMPLE, usage_authorized: false, scope_aligned: false, estimation_allowed: false,
  }, null, 2)));
  $('#io-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.size > 800000) throw new Error('JSON 文件过大');
      importInput(JSON.parse(await file.text()));
    } catch (err) { error('导入失败：' + err.message); }
    finally { e.target.value = ''; }
  });
  $('#io-check').addEventListener('click', async () => {
    invalidate(); const token = revision;
    setBusy(true); error('正在核对会计边际和正支撑…');
    try {
      const input = JSON.parse($('#io-input').value);
      if (input?.usage_authorized !== true) throw new Error('确认已经获得本站计算授权后，方可将 usage_authorized 设为 true 并提交。');
      const report = await request('preflight', { input });
      if (token !== revision) return;
      error(report.status === 'ready' ? '预检通过 · 等待确认配方' : report.blocking.message);
      const blocked = report.blocking;
      $('#io-preflight').innerHTML = `<p class="io-note">行目标合计 <strong>${amount(report.row_total)}</strong> · 列目标合计 <strong>${amount(report.column_total)}</strong></p>
        <details><summary>查看分部门边际及配方</summary><div class="io-table-scroll" tabindex="0" aria-label="分部门边际"><table><thead><tr><th>产品</th><th>行目标 u</th><th>列目标 v</th></tr></thead><tbody>${input.sectors.map((label, j) => `<tr><th>${safe(label)}</th><td>${amount(report.row_targets[j])}</td><td>${amount(report.column_targets[j])}</td></tr>`).join('')}</tbody></table></div><p class="io-hash">快照 SHA-256 <code>${safe(report.snapshot_hash)}</code></p><p class="io-note">最多 ${report.recipe.max_iterations} 轮；绝对容差 ${report.recipe.atol}，相对容差 ${report.recipe.rtol}。</p></details>
        ${blocked?.rows?.length ? `<p class="io-warn">相关行：${safe(blocked.rows.join('、'))}</p>` : ''}
        ${blocked?.columns?.length ? `<p class="io-warn">相关列：${safe(blocked.columns.join('、'))}</p>` : ''}
        ${blocked?.unallocated == null ? '' : `<p class="io-warn">无法分配量：${amount(blocked.unallocated)}</p>`}`;
      if (report.status === 'ready') { current = { input, snapshot_hash: report.snapshot_hash }; $('#io-confirm').hidden = false; }
    } catch (err) {
      if (token === revision) error(err instanceof SyntaxError ? 'JSON 格式不正确，请参照输入模板。' : err.message);
    } finally { setBusy(false); }
  });
  $('#io-run').addEventListener('click', async () => {
    if (!current || !$('#io-approval').checked) return;
    const token = revision;
    result = null; $('#io-result').hidden = true;
    setBusy(true); error('正在进行双向迭代调平…');
    try {
      const response = await request('run', { ...current, confirmed: true });
      if (token !== revision) return;
      result = response; const v = result.verification, max = a => amount(Math.max(...a.map(Math.abs)));
      $('#io-verification').textContent = `迭代 ${v.iterations} 轮 · 最大行残差 ${max(v.row_residuals)} · 最大列残差 ${max(v.column_residuals)} · 绝对调整额 ${amount(v.absolute_adjustment)}`;
      $('#io-hash').textContent = result.result_hash; $('#io-block').value = 'z';
      renderTable(); $('#io-result').hidden = false; error('会计平衡通过 · 估计结果待独立验证');
    } catch (err) { if (token === revision) error(err.message); }
    finally { setBusy(false); }
  });
  $('#io-json').addEventListener('click', () => saveFile('chainlab-ras-report.json', JSON.stringify(result, null, 2)));
  $('#io-csv').addEventListener('click', () => saveFile('chainlab-ras-estimate.csv', resultCSV(result), 'text/csv;charset=utf-8'));
  root.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (button?.dataset.ioView) view(button.dataset.ioView);
    if (button?.hasAttribute('data-open-io-run')) { view('compilation'); $('#io-input').focus(); }
  });
  document.addEventListener('library-session-change', () => {
    $('#io-input').value = ''; invalidate();
  });
  renderEvidence(); refreshIcons();
}
