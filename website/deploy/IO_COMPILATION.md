# Input-output compilation pilot

Entry: `/workspace.html#compilation`, under 投入产出表编制 in the workspace.
Implements the feasibility-first workflow and the competitive RAS example
from the supplied v0.4 design, sections 3.4 and 7.1.

## Scope and use

- The public assessment lists all 18 v0.4 candidate rules. Only evidence marked
  verified with a note satisfies a gate. Scope precedes any recorded conflict;
  a verified conflict precedes other missing prerequisites. Facts are
  self-reported; the browser does not independently verify source documents.
- Computation requires the existing group login and explicit confirmation of
  the preflight snapshot. No new database writes or model calls are made.
  Submit only authorized, non-sensitive aggregate data. This pilot has no
  server-side project history or multi-role approvals.
- Import a UTF-8 JSON template or a prior run report. The input covers one target
  year and one statistical area, 1–42 product codes in the same order on both
  axes, up to 20 final-use and 20 value-added items, current prices
  (`valuation: "current"`), and a common currency/unit/valuation basis.
  Include the base year, source/version and classification information.
  `usage_authorized`, `scope_aligned` and `estimation_allowed` are attestations,
  not independently validated data licenses or formal approvals.
- `z0[i][j]` is nonnegative base intermediate use. `x[i]` is domestic
  output, `m[i]` is nonnegative import supply, `y[i][k]` is final use,
  and `va[a][j]` is value added. Y and VA can contain signed fixed values.
  The compiler rejects unknown fields, negative Z targets, inconsistent target
  totals, empty active support and global support conflicts (minimum cut).
  It does not silently change control totals or add links.
- RAS alternates row/column scaling, checks both residual vectors at
  absolute tolerance 1e-9 and relative tolerance 1e-10, and fails without an
  output table if the run reaches its 1,200 iteration limit. Margin total and
  support comparisons use a tighter machine precision budget. Constraint
  feasibility does not guarantee RAS convergence within the iteration budget.
- Export CSV for table review, or JSON for full precision, metadata, input
  snapshot, parameters, dependencies, residuals and result hash. Importing a
  report reuses only its input and requires new preflight and confirmation.
  Same normalized input, engine/dependency versions and settings can be replayed.
- Balance is not accuracy. The only shipped validation evidence is numerical and
  synthetic; production use needs source review and independent holdout data.
  SUT conversion, GRAS, locked cells, detailed spreadsheet parsing, domestic
  multipliers, persistent projects, formal publication and conversational tools
  are outside this pilot.

## Verification

```sh
python scripts/test_io_compilation.py
node --test scripts/io-compilation-rules.test.mjs
node scripts/verify-io-compilation.mjs
```

The browser test uses an isolated temporary API by default (configure
`PYTHON` if needed). Set `IO_COMPILATION_BASE` for public verification; provide
the group login over stdin. Screenshots are written under ignored
`.artifacts/io-compilation`. The production test uses only the synthetic
example and does not save any persistent records.

Deploy via the existing incremental release mechanism; retain the previous
release and the tag `portal-before-io-compilation-20261124` for rollback.
