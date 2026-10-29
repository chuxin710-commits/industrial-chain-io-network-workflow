# ChainLab Research Toolbench

The real Newman runtime is integrated at `/toolbench/`. This is not a recreated
chat demo. `upstream.json` pins the MIT-licensed source revision; the full upstream
backend, frontend, skills and plugins are included in the deployed archive.
`NEWMAN_LICENSE.txt` retains the original copyright and license.

## Integration boundaries

- Homepage: two parallel destinations, research platform and research toolbench.
- UI: ChainLab blue/white, orange accents, shared logo, homepage return link.
- Login: existing group account and HttpOnly `chainlab_session` cookie. Newman
  instance-key setup is not exposed. Every API request checks the current group
  session; state-changing requests must carry the site's matching Origin.
- Model: server-side `DEEPSEEK_API_KEY` and optional `DEEPSEEK_MODEL`, using the
  same `deepseek-flash` default as the existing research agents. Keys are not
  written to browser assets, editable project YAML, or Git.
- Runtime: independent non-root systemd service on loopback port 8790, SQLite,
  private persistent workspace, bubblewrap terminal isolation, resource limits.
  Main website code, database, server configuration and home directories are
  inaccessible to the service. The scientific calculation backend is unchanged.
- Upstream retained: sessions, file uploads/output preview, tool execution,
  approvals, skills/plugins/MCP, memory, subagents, scheduler, audit and usage UI.
- Deployment-specific changes: PostgreSQL becomes SQLite; agent concurrency is
  reduced for the 2 GB server; unconfigured Feishu/WeCom channels are disabled.
  The knowledge-base plugin now uses the existing private ChainLab literature
  index. Other search/channel providers still need their own configuration.
- The current model configuration is text-only. Image interpretation fails with
  an explicit message instead of pretending an uploaded image was understood.
  Text extraction from supported PDF/Office files remains upstream functionality.
- Fixed an upstream plugin manifest containing `/root/newman/backend_data` so
  it works under the dedicated service account using a relative path.
- Local Python plugin entrypoints use the backend's Python interpreter in both
  the knowledge-base API and agent tool runner. Windows-built archives no longer
  need POSIX execute bits or a Linux-compatible shebang to start these scripts.
  Native CLI commands and existing sandbox/approval checks are unchanged.

## Rebuild

From `website/`:

```text
node integrations/newman/prepare.mjs
cd .artifacts/toolbench-build/frontend
npm ci
npm run build
cd ../../..
python integrations/newman/package.py
```

`prepare.mjs` verifies the pinned Git revision and reapplies explicit source
anchors; unexpected upstream changes fail instead of silently applying patches.
Python deployment dependencies are constrained by `requirements.lock`, captured
from the verified Linux runtime; frontend dependencies use upstream's lockfile.
Use Node 20+ and Python 3.11+ for the backend. On Windows, select a writable npm
cache if the global npm cache directory is restricted.

Build the main website separately with `npm run build` and
`python scripts/package-deploy.py --incremental`.

## Deploy And Roll Back

Upload the toolbench archive and `install.py` through the existing authenticated
deployment connection. Run `install.py --archive PATH --sha256 SHA256` on the
host. The installer verifies its hash, provisions a dedicated account and
service, starts the backend, then adds a prefix-preserving public entry through
Nginx (the prefix is stripped only when forwarding to Newman).

Prerequisites: bubblewrap, python3-venv, existing ChainLab API, and the existing
root-managed `/etc/chainlab/deepseek.env`. No credential belongs in this folder.

Runtime data is under `/var/lib/chainlab-toolbench`; releases are under
`/opt/chainlab-toolbench/releases`. Preserve data when rolling back. Switch the
`current` symlink to a verified previous release and restart
`chainlab-toolbench`. Homepage rollback tag: `toolbench-before-newman-20261028`.
The installer saves the prior Nginx site file separately before first exposure.

## Verification

- `test_boundary.py`: anonymous access, session verification, same-origin writes,
  auth-service failure, bootstrap isolation, and minimal public health response.
- `test_plugin_startup.py`: non-executable/CRLF Python scripts, JSON stdin, argument
  boundaries, relative paths, unchanged native commands, agent dispatch, and
  structured provider errors. Run with the built release on `PYTHONPATH` and its
  Python environment. Set `CHAINLAB_PLUGIN_SMOKE_ROOT=/var/lib/chainlab-toolbench`
  on Linux to also exercise the real installed plugin inside bubblewrap as the
  service user; this smoke test does not require external provider credentials.
- `scripts/verify-toolbench.mjs --login --model`: accepts credentials only through
  transient stdin; validates real login, desktop/mobile layout, tool/skill lists,
  a real DeepSeek execution with a sandbox calculation and downloadable file,
  and side-by-side homepage entries. It also checks both external-KB endpoints
  and waits for the knowledge-base page to finish loading. Provider availability
  is recorded separately from plugin startup. Test artifacts remain ignored.
- `scripts/verify-visual-theme.mjs`: regression checks for the existing website.

Do not claim external providers or image understanding are configured until
their credentials and real end-to-end tests have been completed.

## Current Knowledge Connection

The user selected the existing ChainLab library, not a new RAGFlow deployment.
`chainlab-literature` exposes original parsed PDF passages, and `chainlab-methods`
exposes project-authored method notes separately. The current inventory is 88
indexed PDFs / 9,869 paper chunks plus 8 method notes. These counts describe the
parsed corpus, not guaranteed full-text coverage of every PDF page.

The bridge reuses `ResearchRAG` TF-IDF + LSA retrieval, source hashes, page links,
and index version invalidation. It does not copy the corpus into a second index.
Top-K, similarity threshold, corpus selection and document filters are supported;
arbitrary metadata filters and standalone semantic search are explicitly rejected.
Existing topology/method agents retain their original retrieval defaults.

Only the read-only catalog and retrieval operations are exposed on the service
bridge. A scoped credential is generated on the server under
`/etc/chainlab/toolbench-kb.env` and loaded by both systemd services. It is never
passed into the plugin sandbox, model context, browser, or Git. The stock sandbox
correctly strips secret-like environment variables; instead of weakening that
rule, the ChainLab binding uses a fixed, trusted backend HTTP transport. Other
Python plugin commands retain the sandboxed interpreter launcher.

The knowledge page shows document/chunk counts and offers original-page links.
The management button returns to the existing library, not a localhost RAGFlow
address. A ChainLab-specific `SKILL.md` replaces the old RAGFlow instructions;
the installer preserves the previous skill as `SKILL.before-chainlab.md`.

Verification commands:

```text
python scripts/test_research_rag.py
node scripts/verify-toolbench.mjs --login --knowledge --knowledge-model
```

Use the research Python environment for the first command. The second accepts
login only through transient stdin and makes one real, read-only DeepSeek tool
call. Linux plugin smoke tests use `test_plugin_startup.py` with
`CHAINLAB_PLUGIN_SMOKE_ROOT` and the service EnvironmentFile, without printing it.

Current releases: main site `20261029T062100Z`, toolbench `20261029T061753Z`.
Toolbench archive SHA-256:
`26bf14bc6ac6ecefbf3908daf90e3dc48d78b4d762ec8ad34d8de875593e8fde`.
The earlier startup-hotfix findings below are historical; their missing-RAGFlow
limitation is resolved by this direct library connection, not by adding RAGFlow.

Acceptance: nine research/RAG tests, nine plugin/transport tests and seven auth
boundary tests passed. Public browser checks passed at 1440/390/320 pixels,
including live retrieval, original PDF page navigation, denied anonymous bridge
access, and a real DeepSeek knowledge-tool call with source references. A broad
topic query can rank references/abstracts highly; retrieval candidates still need
original-context review and are not evidence of a paper's substantive conclusions.
The pre-change Git checkpoint is `knowledge-bridge-before-20261029`.

## Release Verification (2026-10-29)

- Main site: `/opt/chainlab/releases/20261028T070252Z`.
- Toolbench: `/opt/chainlab-toolbench/releases/20261028T141113Z`.
- Toolbench archive SHA-256:
  `1242c2e9d02936b86ef622fdc4e261012f7321afa7c8724ea3aa144c2882ee23`.
- Seven authentication-boundary tests passed on the deployed Python environment.
- Public browser verification passed at 1440, 390 and 320 pixels: group login,
  anonymous API rejection, tool/skill lists, six section destinations, mobile
  navigation, and parallel homepage entries. No browser page errors or horizontal
  overflow. Mobile chat and composer have separate non-overlapping layout regions.
- A real `deepseek-flash` run successfully executed `python3 -c "print(21*2)"`
  inside the sandbox and used `write_file` to create a unique downloadable file
  containing `42`. The test asserts tool-success events and a completed outcome,
  not just the presence of an old file. Session/files persist across releases.
- Existing main-site visual regression passed at 1440/390/320/844 widths,
  including the homepage scenes, workspace panels and briefing route.
- Existing MRIO health verification retained complete 2000-2023 coverage.
- Artifacts are in ignored `.artifacts/toolbench-qa/` and `.artifacts/visual-theme/`.
  Real-model evidence is separate from layout-only runs. External provider services
  (RAGFlow, search credentials, Feishu/WeCom) were not provisioned or acceptance-tested.

## Plugin Startup Hotfix (2026-10-29)

- Release: `/opt/chainlab-toolbench/releases/20261029T005013Z`.
- Archive SHA-256:
  `72cd206478fd95d91f6a6d42761ea359a7e841bb98feaa58869a6a58e839db9e`.
- Rollback release: `20261028T141113Z`; persistent plugin files and research data
  were preserved. No new provider, key, dataset, or model was provisioned.
- Root cause: the persisted `external_kb_cli.py` had mode `0666`, while upstream
  directly executed it. Authenticated catalog requests returned HTTP 502.
  The shared interpreter launcher fixes API calls and agent calls without
  broad chmod changes or weakening sandbox permissions.
- All eight startup tests passed under `chainlab-tools`, including the real
  plugin's `doctor` command inside bubblewrap. Seven boundary tests also passed.
- Public authenticated catalog/provider endpoints now return HTTP 200. Desktop
  and mobile browser regression passed; the startup-failure banner is absent.
- External retrieval is **not yet connected**: the default RAGFlow address
  `http://127.0.0.1:6661` refuses connections, provider credentials are absent,
  and the catalog is empty. These are correctly surfaced as provider errors,
  not a plugin startup failure. Existing ChainLab literature/RAG is a separate
  backend and is not automatically attached by this patch.
