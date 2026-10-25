# Selected Research Plan Flow

## Change

The knowledge atlas's second tab is now the selected-plan research flow, replacing the input-output relation explorer in this module. The standalone network-topology module and existing backend data APIs are unchanged.

The framework panel publishes its current result and selected option IDs. `research-flow-model.js` derives a deterministic graph with stable semantic IDs; Dagre lays out the nodes and Cytoscape provides interaction. No additional AI request is made for diagram construction, selection changes or export. Frame changes, regeneration and logout invalidate and clear diagram content. Plans are in-memory for the current page session, not persisted as shared team projects.

The overview is a research-question/stage/selected-alternative mind map. Detailed mode expands data preparation, the exact original ordered steps and the validation method. Stage numbers express order; parallel branches do not assert verified compatibility. Data requirements, formulas, parameters, assumptions, limitations and citations remain accessible in a keyboard-selectable inspector. Unselected stages are explicitly incomplete rather than silently bypassed.

## draw.io

Installed `Agents365-ai/drawio-skill` under `D:/CodexData/home/skills/drawio-skill` using the Codex skill installer. Its XML authoring and flowchart conventions informed editable export, and its `validate.py` validates generated examples.

Exports use native XML DOM serialization, plain-text labels, semantic object IDs, orthogonal edges with relative geometry and private-library deep links. Page one preserves the current layout, including manual node movement. Subsequent pages contain the complete steps for each selected option. Full unabridged method text remains in object tooltips/properties even where canvas captions are shortened. Export runs locally in the browser; there is no third-party editor iframe or upload.

This machine has no draw.io desktop binary or Graphviz. Native draw.io rendering was not tested. The skill's structural validator and the website's actual canvas/PNG were checked independently; auto-routed XML edges still depend on the draw.io renderer.

## Verification

```powershell
& D:/Galgame/node.exe --test scripts/research-flow.test.mjs
& D:/Galgame/node.exe scripts/verify-knowledge.mjs --base https://nn.rftf.cc.cd
python scripts/verify-literature-ai.py --base https://nn.rftf.cc.cd
python D:/CodexData/home/skills/drawio-skill/scripts/validate.py .artifacts/research-flow/selected-flow.drawio --score
```

Synthetic tests cover selected-only branches, stage order, missing stages, nonoverlapping layout, step order, drag interaction, export XML structure, PNG pixels, mobile overflow, selection synchronization, no extra AI requests and clearing private content after logout. The public smoke test verifies the replacement tab and keyboard navigation; authenticated acceptance also exercises real cached frameworks, source-page navigation and exports. Test artifacts are ignored under `.artifacts/research-flow/` and `.artifacts/literature-ai/`.

Deployment: `/opt/chainlab/releases/20261024T054036Z`; archive SHA-256 `4e1dba3030d8990d4965b269f0b1f85b20730170485200d78857f946197109e0`. Existing databases, annotations and media reused.

Acceptance on 2026-10-24: both synthetic tests passed; authenticated production checks passed for all four themes, selected-plan diagram, steps, stage focus, draw.io/PNG export and reader links. Desktop 1440px and mobile 390px/320px had no horizontal overflow or page errors. The skill validator reported zero errors and zero warnings for both synthetic and live exported files. Final release additionally restores the sidebar graph icon.
