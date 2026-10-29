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
