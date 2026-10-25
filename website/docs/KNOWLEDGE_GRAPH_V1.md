# Evidence-backed Industry Knowledge Graph, v1

Date: 2026-10-22. Entry: `/workspace.html#knowledge`.

## Delivered boundary

This is the first, read-only data-and-method knowledge graph, not an enterprise supplier database or an automatically curated literature graph. Its typed entities are sectors, provinces, province-sector units, annual datasets and the direct-input method. Input, membership and provenance relations have distinct semantics and visual encodings. No private library records are exposed through these endpoints. Existing MRIO data, library, accounts and notes are not modified.

S01-S42 stay unmapped until a verifiable source-specific industry dictionary is available. Amount units, price bases, compilation documentation and redistribution permission remain unverified. Source directory labels identify 2D-LQ, not verified official annual observations. The 2005-2007 comparability warning remains.

## API and calculations

- `GET /api/knowledge/entities?year=2023&level=sector`: lists actual annual axis entities. Levels are `sector`, `province`, `node`.
- `GET /api/knowledge?year=2023&level=node&entity=Beijing_S01&threshold=0.005&direction=both&limit=12`: returns typed graph nodes/edges, the complete incident-relation list, source evidence, methodology and warnings.
- `expanded` optionally contains up to four additional comma-separated codes. The original center stays included; duplicate centers and edges are removed.
- `direction` is `incoming`, `outgoing` or `both`; `limit` is 1-30 per expanded object. Validation rejects unsupported years, nonfinite/negative thresholds, invalid entities and unknown/duplicate parameters.
- `A_ij = Z_ij / x_j`, directed supplier to buyer. Aggregation sums Z and x before division. A is dimensionless, not a probability or causal effect. Zero-output rows and columns must be all zero. Negative or nonfinite Z/x is rejected, not imputed.
- Input edges satisfy `A > 0 and A >= threshold`; self-loops are excluded consistently with the topology viewer.
- Each expanded object's strongest incident A edges are selected, ties by original matrix order. Display edges are their deduplicated union. The complete relationship table/export includes all qualifying incident edges of expanded objects, not all edges of the national network. Counts clearly distinguish displayed and hidden relations.
- Every input relation carries Z, buyer x, A, year, source/method IDs and exact filtered table links for numerator and denominator. Aggregated table links expose the original cells that must be summed, not a fabricated single raw cell.
- JSON includes source SHA-256, query parameters, implementation version, graph adapter hash, aggregation adapter hash and NumPy version. PNG is a view export; JSON is the machine-readable evidence companion.

## Interface

Year/level selection, entity search, direction and threshold filters, layered/network layouts, drag/pin, expand/collapse, optional provenance nodes, graph/table views, paginated full relations, relationship evidence, original-table links and PNG/JSON export. All query results remain scoped to one year. Filter edits mark the previous result stale and disable expansion; failed requests retain the last successful result. Cytoscape is loaded on demand.

## Verification

`scripts/test_knowledge.py`: hand-calculated formulas, edge direction, aggregation, membership, inclusive thresholds, empty/zero-output cases, deterministic expansion/deduplication, display-independent complete relations, invalid parameters, annual entity counts, HTTP contracts and independent original-table reconciliation at all three levels.

`scripts/verify-knowledge.mjs`: browser workflows at 1440, 390 and 320 pixels; actual node dragging; expansion/reset; complete-list invariance; evidence links; JSON/PNG downloads; all three levels; 2000/2023; direction filtering; empty graphs; service errors; no horizontal overflow. Reports and screenshots live under `.artifacts/knowledge/{local,public}`. Mobile tests are emulation, not physical-device performance evidence.

The 11 existing topology unit tests and 6 reader/worker browser regression tests are retained. No pre-existing scientific metric definitions are changed.

## Deployment receipt

- Release `/opt/chainlab/releases/20261022T033623Z` activated successfully on the existing server; database and media reused. No account, PDF or annotation migration.
- Archive `chainlab-20261022T033623Z.tar.gz`, SHA-256 `3cff0154dfbed93cf57ae6ce49e434debfb1a59325c057035d1f2304f44a1395`.
- Six new backend tests, eleven topology backend tests and six reader/worker browser regression tests passed. Full existing topology browser workflows also passed locally at desktop/390/320 widths.
- New knowledge workflows passed both locally and at `https://nn.rftf.cc.cd`, at 1440/390/320 widths, with no page errors. Public report: `.artifacts/knowledge/public/report.json`. Local desktop/mobile graph screenshots and exported graph were visually reviewed.
- Production build passed; existing large PDF/Three.js chunk warnings remain. No GitHub push was performed.

## Next increment

Choose a small, evidence-supported industry topic, then add reviewed literature assertions linked to native PDF highlights. Persistent assertion/evidence tables, review workflow, person-specific identity, enterprise/product datasets and knowledge Q&A are not implemented in v1. Do not mistake method nodes or data-derived edges for reviewed literature claims.
