# CHAINLAB MRIO Read-Only Database

Runtime: Python 3.10+ standard library only. No third-party packages or writable
SQL interface are required. The API binds to loopback; use the website's reverse
proxy for public requests.

## Import

```powershell
python -X utf8 server/import_mrio.py --source-root "C:/path/to/MRIO"
python -X utf8 server/app.py --db var/mrio.sqlite3 --host 127.0.0.1 --port 8787
python -X utf8 -m unittest discover -s scripts -p test_database.py -v
python -X utf8 server/verify_database.py --source-root "C:/path/to/MRIO"
```

Expected inputs: `<source-root>/<year>/Consolidated_MRIO_Table_<year>.csv`,
plus independently supplied `Z_<year>.csv`, `F_<year>.csv`, `VA_<year>.csv`, and
`X_<year>.csv`. Default range: 2000 through 2023, inclusive. Use `--start-year`
and `--end-year` for a bounded import. All imported labels and numeric cells are
retained, including additional consolidated rows and columns. The importer does
not fill missing years or manufacture industry names.

Each year is committed atomically. A rerun skips only if the consolidated hash
and all four component-file hashes still match. Deterministic samples, including
first, middle, boundary and last coordinates, are checked exactly against the
component CSVs before committing. Every source numeric cell is parsed as IEEE754
float64; compressed row payloads are explicitly little-endian. Blank cells alone
use NaN internally and become JSON null or empty CSV fields. Finite negative
values and explicit zeroes are not altered. Non-finite source tokens are rejected.
This preserves numeric values, not the original textual decimal formatting.

Generated `var/mrio.sqlite3` and `var/mrio.manifest.json` are excluded from Git
and must never be placed under the static `public` or `dist` directories. The
manifest contains source hashes, dimensions, missing/negative/zero counts and
independent component checks, without local absolute paths. SQLite integrity is
checked after the requested import finishes. No source CSV is changed.

`verify_database.py` additionally compares **every cell** and both ordered axes
of all imported years with the original consolidated CSVs, then verifies the
entire 2023 full-table CSV export round-trips without changing float64 values.
It writes `var/mrio.verification.json` and deliberately passes small viewport
limits to prove that export is not restricted to the visible page.

## API

- `GET /api/health`: actual loaded coverage and service state.
- `GET /api/catalog`: actual years and metadata, province/sector dictionaries,
  views, query limits, and provenance caveats.
- `GET /api/table`: paged matrix cells with original zero-based axis indices.
- `GET /api/export`: UTF-8-BOM CSV of **all filtered rows and columns**, ignoring
  viewport offsets/limits. Streams one source row at a time. Response headers
  include the consolidated source SHA256 and exported dimensions.

Shared query parameters:

```text
year=2023
view=z | f | va | x | full
row_province=all | Beijing | ...
col_province=all | Tianjin | ...
row_sector=all | S01 | ... | S42
col_sector=all | S01 | ... | S42
row_offset=0
col_offset=0
row_limit=20  (1..200)
col_limit=10  (1..60)
```

Views: Z = industry x industry; F = industry x regional final demand; VA =
value-added component x industry; X = industry x total output; full = every
consolidated row and column. Filters apply literally to the corresponding axis.
For example, final-demand columns have no sector code and VA rows have no
province; filtering these by sector/province returns an empty axis, not an
invented aggregation. Offset is applied after filtering. Empty selections and
out-of-range offsets are valid empty pages. Unknown/repeated parameters,
non-integer paging values, invalid codes and unavailable years return HTTP 400.

No arbitrary SQL, upload or mutation endpoint is provided. Each request opens a
SQLite `mode=ro` connection with `PRAGMA query_only=ON`. SQL values are bound
parameters. A read transaction holds a consistent snapshot throughout a request,
including streaming exports. The API is same-origin and does not enable wildcard CORS.

## Source Limitations

The supplied source directory is labeled 2D-LQ, but compilation documentation,
publication/licensing details, amount unit, price basis and S01--S42 industry
name mapping were not provided. The API explicitly reports those gaps. Complete
year coverage means files exist and were imported, not that every year is an
official benchmark input-output survey. Source blanks are not zeros. No values
are unit-converted, inflation-adjusted or balance-corrected by this service.
