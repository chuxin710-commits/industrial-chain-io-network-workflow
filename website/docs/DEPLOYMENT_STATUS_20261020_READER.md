# Continuous Literature Reader

Date: 2026-10-20 (Asia/Shanghai).

## Delivery

- Entry: https://nn.rftf.cc.cd/workspace.html#literature
- Active release: `/opt/chainlab/releases/20261020T033655Z`.
- Archive SHA-256: `4fecac086f4002710f028793192028e41762c9950cdd2323785be2d39e6974fe`.
- The existing MRIO database, private library, accounts, original PDFs, shared annotations, media, domain and TLS were reused. No scientific network method or API contract changed.

## Reader Behavior

- Default continuous single-column reading; an icon segmented control switches to two pages per row, ordered 1/2, 3/4, etc. Both layouts scroll continuously. An odd final page remains visible.
- Page number follows scrolling and right-hand page selection. Previous/next and page-number input are now scroll shortcuts rather than replacement-page navigation.
- Switching columns or zoom retains the reading position. Layout choice persists within the browser session.
- Page-specific text, native PDF annotations, team highlights, rectangles, ink, bookmarks and notes remain tied to their original page and normalized coordinates. Shared synchronization and conflict handling are unchanged.
- Page boxes remain in the scroll document; only visible and neighboring pages are rasterized. Distant canvases/text layers are released, and a selected text page may be retained. Each canvas backing store is bounded at approximately six million pixels.
- The prior width-only resize observer and out-of-flow loading status are retained to avoid idle render loops.

## Verification

- Four focused Playwright regressions pass at 1440 and 390 widths: continuous page geometry, right-page area annotation and normalized coordinates, single/double switching, scroll-driven page identity, offscreen canvas eviction, reopening an odd-page document, zoom/resize, nonblank pixels and idle stability.
- Full authenticated local reader regression passes: two sessions, five-second note synchronization, concurrent-edit conflict retention, all mark types, selectable text, PDF-native highlights, special source PDFs, Markdown/JSON exports, metadata-only records, logout and mobile 390/320 layouts. Only test-created local annotations were cleaned up.
- Real Chinese source PDF continuous-layout checks pass locally at 1440/390/320 widths, including production icon registration and zero canvas/status churn across a 6.2-second polling interval.
- Vite production build passes; existing large-chunk warnings remain.
- Eight existing topology tests pass. `scripts/audit-topology.py` provides a read-only network display/threshold diagnostic; recommendations are recorded in `TOPOLOGY_METHOD_REVIEW_20261020.md`, not silently applied to production calculations.

Evidence: `.artifacts/library/continuous/`, `.artifacts/library/local/report.json`, `.artifacts/library/local/continuous.json`, `.artifacts/topology/method-audit-20261020.json`.

Public-domain acceptance passed after deployment at 1440/390/320 widths using the real Chinese PDF: both continuous layouts, production icons, page tracking, no fit-width overflow, and zero idle canvas/status changes across polling. Evidence: `.artifacts/library/public/continuous.json` and `continuous-single-*.png` / `continuous-double-*.png`. This public test was read-only. It used the browser's existing network/proxy configuration, not an SSH tunnel.

Browser mobile checks are emulation, not physical-device performance measurements. Private credentials and PDF content are excluded from the source release; no GitHub push was performed.
