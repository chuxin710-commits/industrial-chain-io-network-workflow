# Private Literature AI and Research Frameworks

## Scope

- Library listing: AI abstracts, searchable keyword tags, extraction coverage and OCR disclosure.
- Knowledge atlas: four themes (network construction, resilience, security, shock), paired with a selected-plan research flow view. The separate network-topology module is unchanged.
- Retrieval: DeepSeek ranks the catalog of completed summaries and tags, selecting at most six real documents.
- Evidence: seven relevant PDF pages per selected paper are extracted from the stored text, with physical PDF page numbers. These are excerpts, not a systematic full-text review.
- Framework: four ordered stages with at least two selectable alternatives per stage. Each alternative includes data requirements, assumptions, formula/parameters, steps, validation, limitations and combination conditions.
- Method review: a separate model pass checks normalization direction, spectral-radius stability, fixed-effect identification, missing data and supply-versus-demand shock assumptions against the source excerpts. It revises the draft and exposes review notes. This is AI self-review, not human peer review or executed empirical verification.
- References open the existing private reader at the cited page. Selected alternatives can be exported to Markdown.
- Research flow: only checked alternatives are mapped to stage branches. Detailed view follows each option's data preparation, original ordered steps and validation. Branches are organizational, not inferred causal dependencies; missing stages remain visible. Selection changes do not call the model again.
- Flow interaction: stage focus, overview/steps, horizontal/vertical layout, node dragging, zoom, fit and node details with source-page links. PNG exports the current canvas. Editable draw.io exports the current view plus a complete step page for every selected alternative, with full method text in object metadata. No literature data is sent to diagrams.net.

## Scientific Boundaries

AI summaries are not author abstracts. A page reference is checked for membership in the actual source pages provided to the model; this does not establish that the cited passage supports every generated claim. Verbatim snippets in summary provenance are separately checked against whitespace-normalized source text. Suggestions without direct library support are explicitly classified as AI additions.

The model receives current data constraints: 2000-2023, 31 provinces, 42 unverified sector codes, 1302 province-sector nodes, 2D-LQ compilation, uncertain price/unit metadata and cross-year comparability. Scenario simulation is not causal identification. Branch compatibility remains a researcher judgment, not an automatic proof. Generated framework formulas are draft text and need scientific review before implementation.

Long PDFs are sampled to at most 60 pages for summarization, with a 100,000-character budget; individual page text may also be truncated. The UI distinguishes sampled text, full extracted text and OCR. Missing PDFs are not summarized from titles. Unreadable documents remain explicitly incomplete.

## Runtime and Storage

- Provider: `https://api.deepseek.com/chat/completions`, configured model `deepseek-flash` by default.
- Method review uses `DEEPSEEK_REVIEW_MODEL` (default `deepseek-v4-pro`) with thinking enabled. Summaries and initial drafts retain the faster model. Review replaces complete affected options plus overall boundaries, rather than patching a formula while retaining incompatible steps. Model self-review is still fallible. Protocol reference: [DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/).
- Server-side secret only: `/etc/chainlab/deepseek.env`, root-owned, mode `0600`, consumed via systemd `EnvironmentFile`.
- Local configuration helper: `python scripts/configure-deepseek.py <authorized-ssh-key-path>`, using hidden input. Never put credentials into shell arguments, source files, browser code or Git.
- Private cache: `/var/lib/chainlab/library/ai/analysis.sqlite3`, separate from original library records and shared annotations.
- `papers`: source SHA-256, prompt version, status, AI metadata, extracted pages, usage and coverage.
- `jobs`: cache key, phase, result, failure, timestamps. Cached by theme, model, prompt version and corpus revisions.
- `raw_outputs`: private model responses for debugging failed schema validation; no public or browser API serves these records.
- PyMuPDF extraction is serialized because MuPDF is not thread-safe. Model requests may run concurrently (maximum three in a batch). OCR uses a separate Tesseract process for each page to bound memory.
- At most two framework jobs run concurrently. The API never waits synchronously for an entire model response. Identical ready/running jobs are reused.
- Malformed or truncated model JSON receives at most one provider-side repair; prose strings returned in place of single-item lists are normalized without inventing content. Unrecoverable results are not published.

## Batch Operations

Install optional OCR support on Debian using `apt-get install tesseract-ocr-eng tesseract-ocr-chi-sim`. The first import already contains 111 catalog entries and 88 PDF attachments; coverage should be read from the authenticated status endpoint rather than hard-coded in the application.

Install `deploy/chainlab-literature-ai.service` into `/etc/systemd/system/`, run `systemctl daemon-reload`, then `systemctl start --no-block chainlab-literature-ai`. This is an explicit batch, not a recurring automation. Re-running skips valid completed summaries and retries incomplete records. Inspect `journalctl -u chainlab-literature-ai`; no PDF text or key is logged.

Documents and shared annotations remain in the original private library. Model requests include PDF text and bibliographic metadata, not member profiles, passwords or shared notes. All new HTTP routes require the existing library session; POST additionally requires CSRF and same-origin checks.

## API

- `GET /api/library/documents`: existing catalog enriched with `ai` per document and aggregate `ai_status`.
- `GET /api/library/ai/status`: ready, pending, failed and OCR-required counts.
- `POST /api/library/ai/framework`, JSON `{ "theme": "network|resilience|security|shock" }`: returns job identity/state.
- `GET /api/library/ai/framework/<id>`: authenticated job phase/result.

## Verification

```powershell
python -m unittest discover -s scripts -p test_literature_ai.py -v
python -m unittest discover -s scripts -p test_library.py -v
python scripts/verify-literature-ai.py --base https://nn.rftf.cc.cd
& D:/Galgame/node.exe scripts/verify-knowledge.mjs --base https://nn.rftf.cc.cd
```

Synthetic tests do not call DeepSeek. The browser acceptance script uses hidden credential input and exercises the actual provider/cache, all four themes, selection, export, PDF navigation, logout clearing and desktop/mobile layout. Test evidence stays under ignored `.artifacts/literature-ai/`. Public browser success and direct command-line network reachability are distinct checks.

## Corpus Receipt (2026-10-23)

Server batch completed successfully: 88/88 PDFs summarized; zero failed, pending or OCR-required records. Four documents used OCR on 122 pages in total, including one 117-page scanned book. Seventy-five summaries contain at least one verbatim snippet that passed source-text matching; a missing matching snippet is not replaced with an invented quotation. The saved successful summary responses account for 1,613,199 provider-reported tokens; this is not the complete bill because failed attempts and framework generation are excluded.

The original library remains 111 entries; the 23 entries without PDF are retained as bibliographic records, not falsely labeled as full-text analyzed. A complete cache audit verified 207 retained verbatim excerpts against the extracted pages. Every analyzed paper has 7-8 keyword tags.

## Deployment and Acceptance (2026-10-24)

- Active release: `/opt/chainlab/releases/20261024T001303Z`; existing MRIO database, private library, annotations and media reused.
- Release archive SHA-256: `9ffb6000db3edd00ed6887f8c39a3c8ee2e0b77b2ccef2b47a2172d490a3acf5`.
- Production build passed. Vite retains a non-blocking large-chunk warning for existing PDF/3D bundles.
- Eleven synthetic AI tests, seven library/API tests and five continuous-reader/highlight regression tests passed.
- Live acceptance at `https://nn.rftf.cc.cd`: all four themes generated four stages and eight selectable alternatives. Tag filtering, branch selection, Markdown export, source-page navigation and logout clearing passed; no JavaScript errors; no horizontal overflow at 1440, 390 and 320 pixels.
- All four cached themes completed `method-review-v3`. Review uses the reasoning-enabled model to reduce formula/step inconsistency, but this is not a mathematical proof, independent peer review or executed empirical experiment. Remaining identification, notation and source interpretation still require researcher review.
- Original input-output relation graph regression passed at 1440/390/320 pixels, including node dragging, expansion, complete relations, source links, exports, 42/31/1302-node levels, year changes and retention after request errors.
- Acceptance reports and screenshots: ignored local `.artifacts/literature-ai/` and the knowledge-graph verifier's artifact directory. The public-browser result is distinct from direct command-line connectivity.
