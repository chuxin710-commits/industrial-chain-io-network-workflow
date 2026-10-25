# Daily briefing v1

Delivered 2026-10-23. Public entry: `/briefing.html`; JSON: `/api/briefing`.
The film landing page has a second destination, a navigation entry and a full
feature introduction. Existing research, library and authentication are unchanged.

## Collection boundary

`server/briefing.py` collects 12 public Google News RSS searches: three subjects
(industry, supply chain, AI developments) across US, GB, IN and Chinese/Taiwan
editions. These are search editions, NOT article geography labels or twelve
independent providers. Global topics are covered, but this is not a comprehensive
global event database. Sources and original languages remain visible.

Only title, publisher, source publication time and public news link are retained;
no paywall bypass, article body scraping or generated factual summaries. Links
pass through Google News to the publisher. Keyword curation excludes selected
investment-commentary noise, market-size advertising and off-topic AI titles.
It does not certify source reliability or independently establish a breakthrough.

The time window is publication time in `[now - 72h, now]`, using timezone-aware
timestamps. Invalid, timezone-less and future dates are rejected. Exact normalized
title hashes deduplicate cross-edition results; this is not semantic event
clustering. Multiple articles about one event can remain. Topics and editions
merge on duplicate titles. The UI sorts by recency, not an invented popularity
score, and explains that categories overlap.

## Operation

Install after normal feature deployment:

```sh
bash /opt/chainlab/current/deploy/install-briefing.sh
systemctl list-timers chainlab-briefing.timer
journalctl -u chainlab-briefing.service -n 20 --no-pager
```

The systemd timer runs at 07:00 Asia/Shanghai daily, with up to 30 seconds jitter;
Persistent=true catches a missed schedule after downtime. First collection runs
immediately at installation. No desktop session or API key is required. A refresh
button reads the stored issue; visitors cannot trigger external collection.

State lives in `/var/lib/chainlab/briefing`, outside immutable releases. The
collector runs as chainlab, not root. Feed requests have a 15-second timeout and
3 MB response cap. The service has a 600-second ceiling and cannot overlap itself.
Latest issue and dated daily snapshots are written atomically. Complete failure
preserves the previous issue and records failure status. Partial failure is
visible; still-valid prior headlines may remain. The read endpoint always filters
expired items, including when the previous collection failed. A delayed issue
is marked stale after 26 hours or a completely failed attempt.

## Checks and receipt

- Three backend tests pass: time bounds, invalid dates, safe links, title/topic
  merging, stale/expired data and preservation after all-source failure.
- Browser checks at 1440, 390 and 320 pixels pass: rendering, no horizontal
  overflow, categories, search, incremental loading, retained results on service
  failure and homepage entries. Desktop/mobile screenshots visually reviewed.
- Production browser endpoint check: 482 items, 12/12 feeds succeeded, unique
  IDs, HTTP(S) links, all publication dates within the current 72-hour window.
  Counts naturally change as headlines expire or the next collection runs.
- Production build passes; existing PDF/Three.js large-chunk warnings remain.
- Release: `/opt/chainlab/releases/20261023T023535Z`.
- Archive SHA-256: `61b7a4027ea7aaaa541659c1687eb4f45b5c4ae8e23bf7bd70f1b73a75b45c48`.
- First service execution succeeded. Timer enabled; next run was confirmed as
  2026-10-24 07:00 CST. This verifies scheduling, not a future execution.
- Reports/screenshots: `.artifacts/briefing/{local,public}`. No GitHub push.

## Remaining boundaries

RSS availability and indexing are third-party dependencies; failures are surfaced,
not silently filled with fabricated news. First version offers original-language
headlines, not Chinese translation or an editorially verified digest. Dated issue
files are retained server-side; an archive browser, semantic clustering, human
editorial review and email subscriptions are not part of this release.

## Homepage visual increment, 2026-10-23

Replaced the static three-topic index with the existing two-column research-band
layout. The right side now uses Three.js: a rotating geographic grid, three
colored incoming streams and a layered morning newspaper. The scene is explicitly
conceptual, not live event geography. Pointer parallax, pause/resume, offscreen
suspension and reduced-motion settings reuse the established scene lifecycle.
A generated bitmap poster is used when WebGL is unavailable.

`scripts/verify-briefing-scene.mjs` checks desktop/390/320 layouts, canvas pixel
content and animation changes, camera bounds, pointer response and pause/resume.
Screenshots under `.artifacts/briefing-scene` were visually reviewed. Separate
checks confirmed reduced-motion pause and WebGL fallback with HTTP 200 poster.

Package with `--incremental --include-media research-briefing.jpg`; all other
media and databases remain reused. Release `20261023T041738Z`, archive SHA-256
`05c7af0c792dca4985bf206f23b2b9f31ed10517d44dd917b7c8d0a97b3a7fd6`.
