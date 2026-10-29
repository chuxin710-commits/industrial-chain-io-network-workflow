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
edit('plugins/external-kb-retrieval/plugin.yaml', 'executable: scripts/external_kb_cli.py', 'executable: scripts/chainlab_kb_cli.py');
fs.copyFileSync(path.join(here, 'chainlab_kb_cli.py'), path.join(dest, 'plugins/external-kb-retrieval/scripts/chainlab_kb_cli.py'));
fs.copyFileSync(path.join(here, 'knowledge-SKILL.md'), path.join(dest, 'plugins/external-kb-retrieval/skills/external-kb-retrieval/SKILL.md'));
edit('backend/api/routes/external_kb.py', 'def _external_kb_capabilities(provider_type: str | None) -> dict[str, Any]:', `def _external_kb_capabilities(provider_type: str | None) -> dict[str, Any]:
    if provider_type == "chainlab":
        return {"provider_type": "chainlab", "read_only": True, "retrieve": True,
                "list_knowledge_bases": True, "list_provider_datasets": True, "health_check": True,
                "highlights": False, "document_filters": True, "metadata_filters": False,
                "search_modes": ["hybrid"], "tunable_params": ["top_k", "score_threshold"], "mutations": []}`);
edit('frontend/src/pages/KnowledgeBasePage.tsx', 'const ragflowWebUrl = resolveRagflowWebUrl(providerStatus?.base_url);', 'const ragflowWebUrl = providerStatus?.provider_type === "chainlab" ? "/workspace.html#literature" : resolveRagflowWebUrl(providerStatus?.base_url);');
edit('frontend/src/pages/KnowledgeBasePage.tsx', 'useState(0.2)', 'useState(0.06)');
edit('frontend/src/pages/KnowledgeBasePage.tsx', 'source?: {', 'source?: {\n    uri?: string | null;');
edit('frontend/src/pages/KnowledgeBasePage.tsx', '<code key={datasetId}>RAGFlow: {datasetId}</code>', '<code key={datasetId}>Dataset: {datasetId}</code>');
edit('frontend/src/pages/KnowledgeBasePage.tsx', '<p>{resultPreview(result)}</p>', `<p>{resultPreview(result)}</p>
                        {result.source?.uri?.startsWith("/workspace.html#") && <a className="knowledge-link-button" href={result.source.uri} target="_blank" rel="noopener noreferrer">查看来源</a>}`);
for (const file of ['backend/api/routes/external_kb.py', 'backend/tools/impl/plugin_cli.py']) {
  edit(file, 'import json', 'import json\nfrom backend.plugin_runtime.command_argv import plugin_command_argv\nfrom backend.plugin_runtime.chainlab_knowledge import is_chainlab_command, run_chainlab_command');
}
edit('backend/api/routes/external_kb.py', 'argv = [command.executable, *command.default_args, *args]', 'if is_chainlab_command(command):\n        return await run_chainlab_command([*command.default_args, *args], stdin_payload)\n    argv = plugin_command_argv(command, args)');
edit('backend/tools/impl/plugin_cli.py', '        argv = [self.command.executable, *self.command.default_args, *args]', `        if is_chainlab_command(self.command):
            try:
                payload = json.loads(stdin_text) if stdin_text else {}
                if not isinstance(payload, dict):
                    raise ValueError("Expected JSON object")
            except (ValueError, TypeError):
                return ToolExecutionResult(success=False, tool=self.meta.name, action="knowledge retrieval", summary="Invalid JSON input")
            value = await run_chainlab_command([*self.command.default_args, *args], payload)
            return ToolExecutionResult(success=bool(value.get("success")), tool=self.meta.name,
                                       action="chainlab knowledge " + " ".join(args), stdout=json.dumps(value, ensure_ascii=False))

        argv = [self.command.executable, *self.command.default_args, *args]`);
edit('backend/tools/impl/plugin_cli.py', 'argv = [self.command.executable, *self.command.default_args, *args]', 'argv = plugin_command_argv(self.command, args)');
fs.copyFileSync(path.join(here, 'command_argv.py'), path.join(dest, 'backend/plugin_runtime/command_argv.py'));
fs.copyFileSync(path.join(here, 'chainlab_knowledge.py'), path.join(dest, 'backend/plugin_runtime/chainlab_knowledge.py'));
fs.copyFileSync(path.join(here, 'chainlab_kb_cli.py'), path.join(dest, 'backend/plugin_runtime/chainlab_kb_cli.py'));
fs.copyFileSync(path.join(here, 'LoginPage.tsx'), path.join(dest, 'frontend/src/pages/LoginPage.tsx'));
fs.copyFileSync(path.join(here, 'chainlab.css'), path.join(dest, 'frontend/src/chainlab.css'));
fs.copyFileSync(path.join(here, 'chainlab_app.py'), path.join(dest, 'chainlab_app.py'));
fs.copyFileSync(path.join(here, 'newman.yaml'), path.join(dest, 'newman.yaml'));
fs.copyFileSync(path.join(here, 'upstream.json'), path.join(dest, 'CHAINLAB_UPSTREAM.json'));
fs.copyFileSync(path.join(here, 'requirements.lock'), path.join(dest, 'requirements.lock'));
fs.copyFileSync(path.join(root, 'public/mark.svg'), path.join(dest, 'frontend/src/assets/chainlab-mark.svg'));
console.log(JSON.stringify({ dest, upstream: pin.commit }));
