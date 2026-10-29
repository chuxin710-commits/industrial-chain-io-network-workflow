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
  External knowledge-base/search/channel providers still need their own valid
  service configuration. Copying their UI does not provision those services.
- The current model configuration is text-only. Image interpretation fails with
  an explicit message instead of pretending an uploaded image was understood.
  Text extraction from supported PDF/Office files remains upstream functionality.
- Fixed an upstream plugin manifest containing `/root/newman/backend_data` so
  it works under the dedicated service account using a relative path.

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
- `scripts/verify-toolbench.mjs --login --model`: accepts credentials only through
  transient stdin; validates real login, desktop/mobile layout, tool/skill lists,
  a real DeepSeek execution with a sandbox calculation and downloadable file,
  and side-by-side homepage entries. Test artifacts remain ignored.
- `scripts/verify-visual-theme.mjs`: regression checks for the existing website.

Do not claim external providers or image understanding are configured until
their credentials and real end-to-end tests have been completed.

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
