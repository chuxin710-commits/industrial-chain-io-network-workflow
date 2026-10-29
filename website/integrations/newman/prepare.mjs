// Materialize an exact upstream release plus the small ChainLab integration layer.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const pin = JSON.parse(fs.readFileSync(path.join(here, 'upstream.json'), 'utf8'));
const clone = path.join(root, '.artifacts/newman-upstream');
const dest = path.join(root, '.artifacts/toolbench-build');
if (!fs.existsSync(path.join(clone, '.git'))) execFileSync('git', ['clone', pin.repository, clone], { stdio: 'inherit' });
execFileSync('git', ['cat-file', '-e', `${pin.commit}^{commit}`], { cwd: clone });
fs.mkdirSync(dest, { recursive: true });
const archive = path.join(root, '.artifacts/newman-source.tar');
execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, pin.commit], { cwd: clone });
execFileSync('tar', ['-xf', archive, '-C', dest]);
function edit(relative, from, to) {
  const file = path.join(dest, relative);
  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes(from)) throw new Error(`Upstream integration anchor missing: ${relative}: ${from}`);
  fs.writeFileSync(file, source.replaceAll(from, to));
}
for (const file of ['frontend/src/lib/api.ts', 'frontend/src/App.tsx', 'frontend/src/pages/UsageDemoPage.tsx']) {
  edit(file, 'return import.meta.env.VITE_API_BASE;', 'return new URL(import.meta.env.VITE_API_BASE, window.location.origin).href.replace(/\\/$/, "");');
  edit(file, 'return window.location.origin;', 'return window.location.origin + "/toolbench";');
}
edit('frontend/vite.config.ts', 'base: "/",', 'base: "/toolbench/",');
edit('frontend/vite.config.js', 'base: "/",', 'base: "/toolbench/",');
edit('frontend/src/RootPage.tsx', 'import "./styles.css";', 'import "./styles.css";\nimport "./chainlab.css";');
edit('frontend/src/RootPage.tsx', 'window.location.pathname.replace(/\\/+$/, "")', 'window.location.pathname.replace(/^\\/toolbench/, "").replace(/\\/+$/, "")');
edit('frontend/src/RootPage.tsx', 'window.location.replace("/");', 'window.location.replace("/toolbench/");');
edit('frontend/src/RootPage.tsx', 'window.location.replace("/login");', 'window.location.replace("/toolbench/");');
edit('frontend/src/RootPage.tsx', 'await fetchJson(`${apiBase}/api/auth/logout`, { method: "POST" });', `const session = await fetchJson<{ user: { csrf: string } }>("/api/library/session");
    await fetchJson("/api/library/auth/logout", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": session.user.csrf }, body: "{}" });`);
edit('frontend/src/App.tsx', '<h1>NewMan</h1>', '<a className="chainlab-home" href="/"><h1>链研<small>科研工具台 / NEWMAN</small></h1></a>');
edit('frontend/src/App.tsx', 'import logo from "./assets/newman-logo.png";', 'import logo from "./assets/chainlab-mark.svg";');
edit('frontend/src/App.tsx', '<span className="chat-empty-brand-name">NewMan</span>', '<span className="chat-empty-brand-name">科研工具台</span>');
edit('frontend/src/App.tsx', '<span className="chat-empty-brand-cn">牛马</span>', '<span className="chat-empty-brand-cn">CHAINLAB</span>');
edit('frontend/src/App.tsx', 'const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);', 'const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);\n  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);\n  useEffect(() => { setMobileMenuOpen(false); }, [activePage, activeSessionId]);');
edit('frontend/src/App.tsx', '<aside className={`left-rail ${compactLeftRail ? "compact" : ""}`}>', `{isMobile && <header className="chainlab-mobile-header"><a href="/" className="chainlab-home"><img src={logo} alt="" />链研 <small>科研工具台</small></a><button type="button" aria-label={mobileMenuOpen ? "关闭导航" : "打开导航"} title={mobileMenuOpen ? "关闭导航" : "打开导航"} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(!mobileMenuOpen)}><RailToggleIcon collapsed={!mobileMenuOpen} /></button></header>}
      <aside className={\`left-rail \${compactLeftRail ? "compact" : ""} \${mobileMenuOpen ? "mobile-open" : ""}\`}>`);
for (const [label, hint] of [['Chat','对话'],['Automations','定时'],['Memory','记忆'],['Skills','技能'],['Evolution','进化'],['Knowledge','知识库']]) {
  edit('frontend/src/App.tsx', `label: "${label}", hint: "${hint}"`, `label: "${hint}", hint: "${label}"`);
}
edit('frontend/src/App.tsx', 'Settings & Plugins', '设置与插件');
edit('frontend/src/App.tsx', '输入你的任务，可附附件；按 Enter 发送，Shift + Enter 换行', '输入研究任务…');
edit('frontend/index.html', '<title>Newman</title>', '<title>科研工具台 | 链研 ChainLab</title>');
edit('frontend/index.html', '/src/assets/newman-logo.png', '/src/assets/chainlab-mark.svg');
edit('frontend/src/styles.css', '@import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap");', '/* System fonts keep the toolbench independent of external font services. */');
edit('backend/providers/multimodal.py', '        if self.config.type == "mock":', '        if self.config.capabilities.get("supports_images") is False:\n            raise ValueError("当前 DeepSeek 配置未启用视觉识别，请上传可提取文字的文档，或由管理员配置视觉模型。")\n\n        if self.config.type == "mock":');
edit('plugins/external-kb-retrieval/plugin.yaml', '/root/newman/backend_data', '../../backend_data');
fs.copyFileSync(path.join(here, 'LoginPage.tsx'), path.join(dest, 'frontend/src/pages/LoginPage.tsx'));
fs.copyFileSync(path.join(here, 'chainlab.css'), path.join(dest, 'frontend/src/chainlab.css'));
fs.copyFileSync(path.join(here, 'chainlab_app.py'), path.join(dest, 'chainlab_app.py'));
fs.copyFileSync(path.join(here, 'newman.yaml'), path.join(dest, 'newman.yaml'));
fs.copyFileSync(path.join(here, 'upstream.json'), path.join(dest, 'CHAINLAB_UPSTREAM.json'));
fs.copyFileSync(path.join(here, 'requirements.lock'), path.join(dest, 'requirements.lock'));
fs.copyFileSync(path.join(root, 'public/mark.svg'), path.join(dest, 'frontend/src/assets/chainlab-mark.svg'));
console.log(JSON.stringify({ dest, upstream: pin.commit }));
