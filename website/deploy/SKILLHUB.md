# SkillHub

Entry: `/workspace.html#skills`, also linked from the homepage and workspace.

## Scope

- Public curated catalog with search, categories, repository-star sorting,
  pinned upstream source links, Markdown download and full-repository ZIP links.
- Account-scoped favorites and custom `SKILL.md` upload, preview, download and delete.
- Reuses library sessions, CSRF and same-origin validation. A shared group login
  has a shared skill space, not per-person isolation.
- No automatic installation, script execution or injection into agent prompts.
- Skill text is displayed as escaped plain text, never interpreted as HTML.
- Custom files require UTF-8, YAML `name` and `description`, a body, and a maximum
  of 40,000 bytes. Up to 100 custom skills per account; duplicate names return 409.
- Persistence uses two additive tables in the existing persistent library DB:
  `personal_skills` and `skill_favorites`. No deployment-release-relative uploads.

## Curated Sources

The initial catalog contains 11 skills from `anthropics/skills` and
`obra/superpowers`. The JSON snapshot records exact repository star counts,
UTC collection time, commit SHA, original text SHA-256 and upstream license text.
Chinese titles and short summaries are editorial descriptions, not upstream text.
Stars belong to the repository, not each skill. This is a curated selection, not
a claim to be a global skill ranking. Refresh is a deliberate publishing action,
not a live or scheduled crawler:

```sh
python scripts/sync-skillhub.py
```

Review upstream changes and licenses before publishing a new snapshot. Source
Markdown can reference scripts, other skills and dependencies; downloading only
`SKILL.md` is not a complete installation. The original repository ZIP includes
those files and the upstream licensing context.

## Verification And Rollback

```sh
python scripts/test_skillhub.py
python scripts/test_library.py
node scripts/verify-skillhub.mjs
```

The browser test creates an isolated temporary API and synthetic account by
default. `SKILLHUB_BASE=https://nn.fan-top.xyz` switches to production acceptance
and requests login through transient stdin. It creates and removes only its own
uniquely named test skill. Artifacts are in ignored `.artifacts/skillhub`.

Rollback tag: `skillhub-before-20261114`. Deployment uses the existing incremental
release installer; keep the previous `/opt/chainlab/current` release target for
rollback. The new tables are additive, and old code can ignore them without
deleting user uploads. No Newman deployment or existing literature-data change
is required.

## Release Receipt

Activated on 2026-11-14 at `https://nn.fan-top.xyz/workspace.html#skills`.
Release: `/opt/chainlab/releases/20261114T120122Z`.
Previous: `/opt/chainlab/releases/20261029T062100Z`.
Archive SHA-256: `d9868c0cb7e378a7bd0bd0a622c6ddfb8f01a511914c6d6b089c73faf7c9c06e`.

Six SkillHub backend tests and seven library regression tests passed locally.
The browser suite passed against both an isolated local API and the public
production hostname: search/category, login, upload, persistence after reload,
inert HTML preview, byte-identical Markdown download, favorites, deletion and
logout cleanup. Desktop 1440 px and mobile 390/320 px screenshots showed no
horizontal overflow or page errors. Both production health endpoints passed.
The temporary browser-test upload was deleted after verification.
