# ChainLab visual system

## Identity

The 2026-10-27 refresh uses white and blue as the primary identity, with orange
highlights and near-black typography. The Intern InkStone reference informed the
restrained navigation and research-oriented hierarchy; its branding, fonts and
artwork are not redistributed.

`src/theme.css` owns the shared semantic colors. All workbench modules, including
lazy-loaded library styles, inherit those tokens. `home-visual.css`,
`workbench-visual.css` and `briefing-visual.css` define the page-level composition.

| Role | Value | Use |
| --- | --- | --- |
| Brand | `#205ecf` | Primary actions, selection, navigation, network nodes |
| Brand hover | `#174aa7` | Hover and active action feedback |
| Brand soft | `#edf3ff` | Selected surfaces and section backgrounds |
| Accent | `#e77932` | Small markers, highlighted nodes, directional paths |
| Accent ink | `#a64b17` | Orange text on light surfaces |
| Text | `#20242b` | Headings and main content |
| Secondary text | `#465166` | Supporting content |
| Muted text | `#69768a` | Metadata and captions |
| Surface | `#ffffff` | Reading and working surfaces |
| Border | `#e0e6ef` | Dividers and component boundaries |

## Scope and boundaries

- White sidebar, blue selected navigation and consistent focus rings.
- Home film gets a light monochrome treatment only in the background. The
  original video, audio, playback controls and full-screen film remain intact.
- Six interactive research scenes use blue, white and orange materials; shock
  damage and recovery retain distinct semantic colors.
- Database heatmaps, topology canvas, exported topology figures, method demos
  and editable research-flow exports use the updated visual palette.
- PDF contents and users' persisted annotation colors are not recolored.
- Scientific formulas, metrics, thresholds, RAG retrieval, access controls and
  stored research data are unchanged.
- Home entrance motion clears its temporary transforms on completion; this
  prevents the primary entry overlapping the briefing link on short screens.
- Updated local poster fallbacks match the six WebGL scenes.

## Acceptance

Run from `website/`:

```sh
npm run build
node scripts/verify-visual-theme.mjs
node scripts/verify-workspace.mjs
node scripts/verify-topology.mjs
node scripts/verify-methods.mjs
node scripts/verify-briefing.mjs
node scripts/verify-method-tutor.mjs
node scripts/verify-topology-ai.mjs
node scripts/verify-research.mjs --production
node scripts/verify-briefing-scene.mjs
node --test scripts/methods.test.mjs scripts/research-flow.test.mjs scripts/library-reader.test.mjs
```

The visual sweep covers 1440, 390, 320 and landscape 844-pixel viewports,
home navigation/playback, all eight workbench routes and the briefing page.
The dedicated suites cover query/export precision, node dragging, complete
neighbors, year comparison, formula rendering, reading/highlight stability,
flow exports, AI panel lifecycle and failure recovery. AI-panel checks use
fixtures; they do not imply a new live-model evaluation. WebGL checks sample
nonblank/moving/pointer-responsive canvas pixels on desktop and mobile.

Reports and screenshots live in ignored `.artifacts/` directories.
`verify-visual-theme.mjs --base https://nn.rftf.cc.cd` repeats the visual sweep
against the public deployment without modifying research records.

## Release and rollback

The pre-refresh Git checkpoint is `visual-before-blue-white-20261027`.
Use the existing incremental feature deployment, including these six media files:
`research-mechanism.jpg`, `research-network.jpg`, `research-globe.jpg`,
`research-resilience.jpg`, `research-evidence.jpg`, `research-briefing.jpg`.
No database migration is required. The preceding server release is
`/opt/chainlab/releases/20261026T074523Z`.
