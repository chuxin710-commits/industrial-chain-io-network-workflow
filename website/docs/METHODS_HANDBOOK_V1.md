# Methods Handbook v1

Date: 2026-10-22. Entry: `/workspace.html#methods`.

## Scope and navigation

Five stages connect data definitions, network construction, structural diagnostics,
shock/recovery scenarios and verification. Fifteen topics contain 44 display
formulas and 55 symbol entries, parameter tables, assumptions, calculation steps
where applicable, and implementation references. Topic routes are shareable as
`#methods/<id>`. Search, LaTeX copying and a complete Markdown handbook export
are included. The export contains calculation steps and the source manifest.

The page distinguishes online data/network functions from offline research
methods. It does not run the full empirical experiments. The website covers
2000-2023; the two documented research implementations cover 2009-2023 at the
42-sector national level. Unverified sector mappings, amount/price metadata,
2D-LQ provenance and 2005-2007 comparability caveats remain explicit.

## Scientific alignment

- Aggregate Z and x before computing A; use buyer output x_j as denominator.
- Separate website positive/inclusive thresholds from strict offline thresholds.
- Keep the full A diagonal for Leontief solving, remove graph self-loops only
  during graph construction, and report spectral radius and inverse residual.
- Distinguish binary structural metrics, weighted A efficiency and binary-hop
  L deletion efficiency. Deletion efficiency keeps the baseline denominator.
- Explain entropy TOPSIS constant columns, neutral fallback and tied rankings.
- Separate equal-proportion and equal-amount shocks; freeze annual A support and
  x in counterfactuals. Restoration is capped by losses and uses a common budget.
- Present SIR as a homogeneous aggregate-rate auxiliary model, not per-node
  network propagation. Report calibration, initial conditions, event detection,
  censoring, cumulative effects and solver tolerances.
- Document the mutualistic model's incoming W_ji convention, state-dependent
  denominator, parameter mapping and finite-horizon terminal consistency. It is
  not the source paper's ResInf learning implementation or causal identification.
- Explain synchronous capacity cascades, capacity-weighted redistribution and
  discarded-load accounting. Separate descriptive panel regressions from causal
  claims and retain Holm correction and cluster assumptions.

`scripts/build-method-sources.mjs` runs before each production build. It records
SHA-256 for ten implementation/document/configuration files and imports actual
published parameters. Tracked research links are pinned to repository commit
`8f239665caa07f45f49901996ec2cd9afd4f8e79`. The local website adapter is shown as a
local implementation reference, not falsely linked to unpublished GitHub code.

## Interactive illustration

`scripts/build-method-demo.py` calls the existing research kernel to generate a
three-sector synthetic example: five thresholds, five shock fractions and five
restoration shares, totaling 125 states. The matrix example links a selected
Z cell to its column denominator and directed graph edge. Sliders update the
threshold graph or baseline/damaged/restored weighted-efficiency comparison.
Every illustration is marked synthetic, not empirical. Monetary units are not
invented. Scientific backend calculations and published empirical results are
unchanged by this release.

## Verification

- `node --test scripts/methods.test.mjs`: three tests passed for schema, all
  99 strict KaTeX expressions, current source hashes and published parameters.
- `../.venv/Scripts/python.exe -m unittest discover -s scripts -p test_method_demo.py -v`:
  two tests passed. All 125 states independently check matrices, budget bounds,
  conservation and NetworkX-versus-SciPy efficiency. Directed Fagiolo matrix
  calculations agree with NetworkX on independent fixtures.
- Six existing reader/layout-worker regression tests passed, including delayed
  annotation saving, continuous single/double pages and render stability.
- Existing knowledge-graph workflows passed locally at 1440, 390 and 320 pixels.
- `node scripts/verify-methods.mjs`: all fifteen topics pass at 1440, 390 and
  320 pixels, with no global horizontal overflow or page errors. Tests cover
  search/no-match, repeat-stage reset, matrix selection, restoration recovery,
  handbook export and usability when the data API returns 503.
- Desktop/mobile screenshots were visually inspected. Formula regions scroll
  horizontally on narrow screens without stretching the page. These are browser
  emulation checks, not physical-device performance measurements.

Reports and screenshots: `.artifacts/methods/{local,public}/`.
Production build passed; existing large PDF and Three.js chunk warnings remain.
KaTeX and its local fonts load only when the methods section is opened.

## Deployment

Release `/opt/chainlab/releases/20261022T133453Z` activated successfully. The
existing database and media were reused; accounts, literature PDFs and shared
annotations were not migrated or changed.

Archive: `chainlab-20261022T133453Z.tar.gz`.
SHA-256: `9ef4c64f67ecc00c2383110f3533a9fd366977d51c2453e58aa1871af0127d30`.
The server's data health check and Nginx configuration test passed.
No GitHub push or full empirical rerun was performed.
