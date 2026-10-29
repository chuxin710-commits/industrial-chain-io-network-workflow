import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import readline from 'node:readline/promises';
import { launchBrowser } from './browser.mjs';

const base = (process.env.TOOLBENCH_BASE || 'https://nn.rftf.cc.cd').replace(/\/$/, '');
const output = '.artifacts/toolbench-qa';
await mkdir(output, { recursive: true });
const browser = await launchBrowser();
const report = { base, viewports: [], checks: [], errors: [] };
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(`${base}/toolbench/`);
  async function request(url, options = {}) {
    const result = await page.evaluate(async ({ url, options }) => {
      const response = await fetch(url, { method: options.data ? 'POST' : 'GET', credentials: 'include',
        headers: options.data ? { 'Content-Type': 'application/json' } : {},
        body: options.data ? JSON.stringify(options.data) : undefined });
      return { status: response.status, body: await response.text() };
    }, { url, options });
    return { status: () => result.status, text: async () => result.body, json: async () => JSON.parse(result.body) };
  }
  const anonymous = await request(`${base}/toolbench/api/sessions`);
  assert.equal(anonymous.status(), 401);
  report.checks.push('anonymous sessions denied');
  await page.getByLabel('课题组账号').waitFor();
  await page.screenshot({ path: `${output}/login.png` });
  if (process.argv.includes('--login')) {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    const input = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    console.log('Provide login JSON through stdin (not retained).');
    const credentials = JSON.parse(await input.question(''));
    input.close();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    await page.getByLabel('课题组账号').fill(credentials.username);
    await page.getByLabel('密码', { exact: true }).fill(credentials.password);
    credentials.password = '';
    await page.getByRole('button', { name: '进入科研工具台', exact: true }).click();
    await page.locator('.screen-shell').waitFor({ timeout: 60000 });
    if (process.argv.includes('--style-preview')) await page.addStyleTag({ content: await readFile('integrations/newman/chainlab.css', 'utf8') });
    await page.waitForTimeout(1500);
    await page.locator('.chat-session-loading').waitFor({ state: 'hidden', timeout: 60000 });
    report.checks.push('group account login');
    report.navigation = await page.locator('.rail-nav').innerText();
    for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      await page.screenshot({ path: `${output}/toolbench-${viewport.width}.png` });
      const offenders = overflow ? await page.evaluate(() => [...document.querySelectorAll('body *')].map(e => ({ className: String(e.className), right: e.getBoundingClientRect().right, width: e.getBoundingClientRect().width })).filter(e => e.right > innerWidth + 1).slice(0, 15)) : [];
      report.viewports.push({ ...viewport, overflow, offenders });
      if (!process.argv.includes('--inspect')) assert.equal(overflow, false, `Toolbench overflow ${viewport.width}`);
      if (viewport.width <= 820 && !process.argv.includes('--inspect')) {
        const layout = await page.evaluate(() => {
          const input = document.querySelector('.composer-bar-floating')?.getBoundingClientRect();
          const conversation = document.querySelector('.conversation-pane-floating')?.getBoundingClientRect();
          return input && conversation ? { bottom: conversation.bottom, inputTop: input.top, inputBottom: input.bottom, height: innerHeight } : null;
        });
        if (layout) assert.ok(layout.bottom <= layout.inputTop + 1 && layout.inputBottom <= layout.height, 'Mobile conversation and composer do not overlap');
      }
    }
    const tools = await (await request(`${base}/toolbench/api/tools`)).json();
    assert.ok(tools.tools.length > 0);
    report.tools = tools.tools.map(t => t.name);
    const skills = await request(`${base}/toolbench/api/skills`);
    assert.equal(skills.status(), 200);
    report.checks.push('skills/tools available');
    for (const endpoint of ['knowledge-bases?refresh=true', 'providers']) {
      const response = await request(`${base}/toolbench/api/external-kb/${endpoint}`);
      assert.equal(response.status(), 200, `External KB ${endpoint}: ${await response.text()}`);
      const payload = await response.json();
      assert.equal(payload.available, true, 'External KB plugin is installed and starts');
      if (endpoint.startsWith('knowledge-bases')) {
        assert.ok(Array.isArray(payload.knowledge_bases));
        report.externalKnowledgeBase = {
          available: payload.available, count: payload.knowledge_bases.length,
          authConfigured: payload.provider_status.auth_configured,
          health: payload.provider_status.health,
          errors: payload.errors,
        };
      }
    }
    report.checks.push('external KB catalog and provider endpoints start without 502');
    if (process.argv.includes('--knowledge')) {
      assert.equal(report.externalKnowledgeBase.authConfigured, true);
      assert.equal(report.externalKnowledgeBase.health.ok, true);
      assert.equal(report.externalKnowledgeBase.count, 2);
      const response = await request(`${base}/toolbench/api/external-kb/retrieve/test`, { data: {
        query: '投入产出网络与产业链韧性', knowledge_base_ids: ['chainlab-literature'],
        top_k: 3, score_threshold: 0.06, search_mode: 'hybrid',
      } });
      assert.equal(response.status(), 200);
      const result = await response.json();
      assert.equal(result.success, true, JSON.stringify(result.error));
      assert.ok(result.total > 0);
      assert.ok(result.results.every(r => r.metadata.kind === 'paper' && r.source.page > 0 && r.source.uri.startsWith('/workspace.html#literature/read/')));
      report.knowledgeRetrieval = { total: result.total, sources: result.results.map(r => ({ title: r.document_name, page: r.source.page, href: r.source.uri })) };
      const internal = await request(`${base}/api/internal/toolbench-kb/catalog`);
      assert.equal(internal.status(), 403, 'Private bridge rejects public requests');
      report.checks.push('live library retrieval, original-page links, private bridge denied');
      if (process.argv.includes('--knowledge-model')) {
        const session = await (await request(`${base}/toolbench/api/sessions`, { data: { title: '文献知识库接入验收' } })).json();
        const response = await request(`${base}/toolbench/api/sessions/${session.session_id}/messages`, { data: {
          content: '做一次只读检索验收。请调用 external_kb_retrieve，args 为 ["retrieve"]，stdin 为 JSON 字符串，查询投入产出网络与产业链韧性，knowledge_base_ids 为 ["chainlab-literature"]，top_k 为 2，score_threshold 为 0.06。不要调用外部搜索或修改文件。根据实际返回结果列出两条文献标题、页码和 source.uri 原文链接，不要推断文献结论。',
          approval_mode: 'auto_allow',
        } });
        assert.equal(response.status(), 200);
        const stream = await response.text();
        await writeFile(`${output}/knowledge-model-stream.txt`, stream);
        const events = stream.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
        assert.ok(events.some(e => e.event === 'tool_call_finished' && e.data.tool === 'external_kb_retrieve' && e.data.success));
        assert.ok(events.some(e => e.event === 'final_response' && ['answered', 'task_completed'].includes(e.data.turn_outcome) && e.data.content.includes('/workspace.html#literature/read/')));
        report.checks.push('real DeepSeek knowledge tool call and cited library links');
        report.knowledgeSession = session.session_id;
      }
    }
    if (!process.argv.includes('--inspect')) {
      await page.getByRole('button', { name: '打开导航', exact: true }).click();
      await page.getByRole('button', { name: '技能 Skills', exact: true }).click();
      await page.waitForTimeout(700);
      assert.equal(await page.locator('.left-rail.mobile-open').count(), 0, 'Mobile navigation closes after choosing a page');
      await page.screenshot({ path: `${output}/skills-mobile.png` });
      await page.setViewportSize({ width: 1440, height: 960 });
      for (const name of ['定时 Automations', '记忆 Memory', '技能 Skills', '进化 Evolution', '知识库 Knowledge', '对话 Chat']) {
        await page.getByRole('button', { name, exact: true }).click();
        await page.waitForTimeout(450);
        if (name === '知识库 Knowledge') {
          await page.getByText('正在加载知识库...', { exact: true }).waitFor({ state: 'hidden', timeout: 60000 });
          await page.getByRole('button', { name: '刷新', exact: true }).waitFor({ timeout: 60000 });
          assert.equal(await page.getByText(/外部知识库插件启动失败/).count(), 0);
          if (process.argv.includes('--knowledge')) {
            await page.locator('.knowledge-row').filter({ hasText: '课题组文献原文' }).click();
            await page.getByPlaceholder('输入测试问题', { exact: true }).fill('投入产出网络与产业链韧性');
            await page.getByRole('button', { name: '测试检索', exact: true }).click();
            await page.locator('.knowledge-result').first().waitFor({ timeout: 60000 });
            assert.ok(await page.getByRole('link', { name: '查看来源', exact: true }).count() > 0);
            const sourceLink = page.getByRole('link', { name: '查看来源', exact: true }).first();
            const target = await sourceLink.getAttribute('href');
            const readerPromise = context.waitForEvent('page');
            await sourceLink.click();
            const reader = await readerPromise;
            const number = Number(target.split('/').at(-1));
            await reader.waitForFunction(n => document.querySelector(`#reader-page-number`)?.value === String(n), number, { timeout: 60000 });
            await reader.locator(`.reader-page-host[data-page="${number}"] canvas`).waitFor({ timeout: 60000 });
            await reader.screenshot({ path: `${output}/knowledge-source-reader.png` });
            await reader.close();
            report.checks.push('source link opens the cited PDF page');
            for (const width of [390, 320]) {
              await page.setViewportSize({ width, height: 844 });
              await page.waitForTimeout(300);
              assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Knowledge page overflow ${width}`);
              await page.screenshot({ path: `${output}/knowledge-${width}.png` });
            }
            await page.setViewportSize({ width: 1440, height: 960 });
          }
          await page.screenshot({ path: `${output}/external-knowledge-base.png` });
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Navigation overflow: ${name}`);
      }
      report.checks.push('mobile navigation and six desktop sections');
    }
    if (process.argv.includes('--model')) {
      const session = await (await request(`${base}/toolbench/api/sessions`, { data: { title: '工具台上线验收' } })).json();
      assert.ok(session.session_id);
      const outputPath = `outputs/toolbench-verification-${Date.now()}.txt`;
      const response = await request(`${base}/toolbench/api/sessions/${session.session_id}/messages`, {
        headers: { Origin: base }, timeout: 240000,
        data: { content: `这是一次工具台上线验收，不涉及真实科研结果。请使用 terminal 工具执行 python3 -c "print(21*2)"，再用文件写入工具在 ${outputPath} 中保存一行 42。最后用中文一句话报告实际执行结果。不调用外部搜索、不创建定时任务、不修改其他文件。`, approval_mode: 'auto_allow' },
      });
      assert.equal(response.status(), 200);
      const stream = await response.text();
      await writeFile(`${output}/model-stream.txt`, stream);
      assert.ok(stream.includes('stream_completed'), 'Real model run completed');
      const events = stream.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
      assert.ok(events.some(e => e.event === 'tool_call_finished' && e.data.tool === 'terminal' && e.data.success && e.data.output_preview.trim() === '42'));
      assert.ok(events.some(e => e.event === 'tool_call_finished' && e.data.tool === 'write_file' && e.data.success));
      assert.ok(events.some(e => e.event === 'final_response' && e.data.turn_outcome === 'task_completed'));
      const file = await request(`${base}/toolbench/api/workspace/file-content?path=${encodeURIComponent(outputPath)}`);
      assert.equal(file.status(), 200, 'Agent generated an accessible output file');
      assert.equal((await file.text()).trim(), '42');
      report.session = session.session_id;
      report.checks.push('real DeepSeek agent run; sandbox terminal; persistent file download');
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.reload();
      await page.locator('.screen-shell').waitFor();
      await page.waitForTimeout(1500);
      await page.locator('.chat-session-loading').waitFor({ state: 'hidden', timeout: 60000 });
      await page.screenshot({ path: `${output}/verified-conversation.png` });
    }
  }
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await page.goto(base);
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => window.chainlabReady && !document.querySelector('.hero-center').classList.contains('is-entering'));
    await page.waitForTimeout(400);
    const links = page.locator('.hero-entries .portal-entry');
    assert.equal(await links.count(), 2);
    const a = await links.nth(0).boundingBox(), b = await links.nth(1).boundingBox();
    await page.screenshot({ path: `${output}/home-${viewport.width}.png` });
    report.home ??= [];
    report.home.push({ viewport, a, b });
    assert.ok(Math.abs(a.y - b.y) < 2 && a.x + a.width < b.x, 'Homepage entries sit side by side');
    assert.ok(b.x + b.width <= viewport.width);
    assert.equal(await links.nth(1).getAttribute('href'), '/toolbench/');
    await page.screenshot({ path: `${output}/home-${viewport.width}.png` });
  }
  report.checks.push('homepage parallel entries at 1440/390/320');
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
