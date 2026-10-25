# Private Literature Library Deployment

Date: 2026-10-19 (Asia/Shanghai).

Subsequent reader release: see `DEPLOYMENT_STATUS_20261020_READER.md` for continuous single/double-page reading and the newer active deployment. This receipt records the earlier library release.

## Active Delivery

- Entry: https://nn.rftf.cc.cd/workspace.html#literature
- Release: `/opt/chainlab/releases/20261019T105413Z` (reader stability patch).
- Release archive SHA-256: `34579e7b4f9ba2a7ceef1455ae806d60c025f03a459916267c192a6bd48ebfd1`.
- Exactly one enabled account: `zeltears`. Use the password supplied privately by the user; no credential appears in this repository or receipt.
- Persistent private storage: `/var/lib/chainlab/library`; owner `chainlab:chainlab`, directory 0750, database 0640.
- Consistent SQLite backup: `/var/backups/chainlab/library-20261019-final.sqlite3`, mode 0600.
- Existing MRIO database, media, domain TLS and independent loopback service on port 3000 were preserved.

## Imported Material

Source archive SHA-256: `e9e7560a9273b36682677906956c5f0b3cfe8c5ddb9b69ed5be9e1c4a7f9b766`.

There are 111 records, 88 PDF attachments and 2,832 pages. 23 records have bibliography only and need PDFs supplied later. Seven orphan PDF attachments are retained rather than discarded or assigned guessed authors. The original PDFs contain 111 native highlights; one actual Zotero RDF memo was imported. These 112 source records remain read-only.

PDFs and covers are authenticated API resources, not files in the public website tree. Imported originals retain their hashes. Source packaging excludes users, sessions and team notes. Future source imports merge records without replacing live shared notes.

## Delivered Workflow

Authenticated catalog search and category/attachment filters; in-browser PDF reading and selectable text; text highlights, rectangle marks, ink, page bookmarks and document/page notes; optional self-entered byline; five-second cross-session synchronization; version conflicts that retain the local draft and allow separate saving; original PDF download; shared records exported as Markdown or JSON.

All people using the shared login have the same permissions. Byline values are self-reported, not verified personal identities. Soft deletes and an append-only event ledger retain change snapshots. Unsaved text drafts are session-local, not server-synchronized drafts.

## Verification Evidence

- Seven library unit/integration tests passed, including single enabled account, password hashing, two sessions, simultaneous edits, soft deletion, source read-only behavior, normalized coordinates, private PDF byte ranges, CSRF and ETag behavior.
- Seven existing database tests and eight topology tests passed (22 total).
- Production build and Python compilation passed. The existing large-chunk warning remains; the PDF reader is lazy-loaded.
- Full public-domain browser suite passed on the functional release: two independent sessions using the same account; notes synchronized; stale edit returned 409 with draft retained; all five shared mark/note types; selectable text; zoom-stable anchors; Markdown/JSON downloads; both blank-password-readable source PDFs; original highlights; metadata-only records; anonymous PDF requests rejected; logout cleared catalog and reader content.
- Desktop 1440x960 and mobile emulation 390x844 / 320x568 were checked with screenshots and nonblank PDF canvas pixels. The final CSS-only refinement keeps the mobile library heading on one line; it has a separate layout/PDF smoke report.
- Public topology regression passed at 1440, 390 and 320 widths: multi-year views, stable layout/scales, 42/31/1302-node levels, dense-node dragging, full neighbors, PNG/JSON exports and overflow behavior.

Evidence: `.artifacts/library/local/report.json`, `.artifacts/library/public/report.json`, `.artifacts/library/public/layout-final.json`, screenshots beside those files, and `.artifacts/topology/verification-public.json`. Test-created shared records were soft-deleted using a unique per-run QA byline; source records were not altered.

Two deployment compatibility defects were found and repaired: the PDF.js default build used browser APIs missing from the installed Edge, so the maintained legacy build is used; Nginx initially returned `.mjs` as a download MIME type, so module workers now receive `text/javascript`. Nginx library traffic has a separate request budget from network computation.

Public-domain checks used an ordinary browser with the machine's existing proxy settings, without an SSH tunnel. This confirms the tested browser path, not all direct network paths. Mobile viewports are browser emulation, not physical-device performance tests.

No GitHub push was performed for this request. Actual PDFs, SQLite data, account material and private exports remain outside Git.

## Reader Stability Patch

The loading status previously changed the scroll area's height. A height-sensitive ResizeObserver then requested another fit-width render, which showed and removed the status again. Before repair, the focused regression measured 9 desktop / 10 mobile canvas replacements in just 1.8 seconds of idle reading.

The observer now compares actual client width only; loading status is positioned outside normal flow, scrollbar space is stable, and closing a reader clears pending resize work. `npm run test:reader` passes at 1440 and 390 widths, including idle stability, height-only resize, actual width adaptation, loading-status geometry, zoom, page navigation and nonblank canvas pixels.

The production browser test opened the exact Chinese paper shown in the user's report at desktop and mobile widths. Over a 6.2-second idle period spanning annotation polling, both recorded zero canvas replacements and zero loading-status mutations. Height-only changes, page navigation and zoom also passed. Evidence: `.artifacts/library/public/render-stability.json` and `stable-reader-*.png`. Neither accounts, original PDFs nor shared annotations were modified by this patch or its production test.
