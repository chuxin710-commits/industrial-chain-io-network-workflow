# Private Shared Literature Library

Entry: `/workspace.html#literature`. The public research portal and MRIO APIs remain available as before; all bibliography, covers, PDFs and annotations require a library session.

## Imported Source

The supplied Zotero ZIP contributes 111 entries, 88 original PDF attachments (2,832 pages), 111 native PDF highlights and one RDF memo. 23 bibliography entries have no PDF; they remain searchable and support whole-document notes. Seven orphan PDF attachments are retained with missing-parent metadata explicitly identified. Catalog/Extra fields are not misrepresented as reading notes.

The import receipt preserves the source archive SHA-256, source RDF IDs and paths, PDF hashes and parser warnings. Unicode Path ZIP metadata is validated against its CRC before falling back to UTF-8/GBK. Originals are immutable content-addressed files, not publicly served static assets.

## Access And Collaboration

There is one enabled shared account, `zeltears`, provisioned interactively. No password is stored in source code or plaintext configuration. Passwords use salted PBKDF2-SHA256 with 600,000 iterations. Browser sessions have HttpOnly, SameSite=Strict cookies and HTTPS Secure cookies; authenticated writes require a session CSRF token and matching Origin.

Everyone using this account has the same editing rights. A reading byline is optional and explicitly self-reported, not an independently authenticated identity. The creator's byline and most recent editor's byline are separate fields. Do not treat these as evidence of individual authorship.

Team highlights, rectangle marks, freehand strokes, bookmarks and notes are separate database records; source PDFs are never rewritten. Page geometry is normalized against the rendered PDF page, so marks follow zoom and responsive sizing. Native PDF highlights render from the original PDF and are listed read-only without a duplicate overlay.

Other open sessions poll for updates every five seconds, with an ETag shortcut for unchanged records. Optimistic versions reject stale edits with HTTP 409; the reader preserves the draft and supports saving it as a separate note. Deletes are soft deletes. The events table retains version snapshots. Browser drafts use sessionStorage and are removed on logout; they are not cross-device server drafts. PDF links embedded in the original are not additional third-party uploads.

## Storage And Deployment

Production data lives at `/var/lib/chainlab/library`, outside immutable releases. Only this directory is writable by `chainlab-api`; existing MRIO tables remain read-only. Use SQLite backup rather than copying an active WAL database.

```powershell
../.venv/Scripts/python.exe scripts/import_library.py --archive "PATH_TO_ZIP"
../.venv/Scripts/python.exe scripts/provision_library.py --username zeltears
../.venv/Scripts/python.exe scripts/package-library.py
```

Provisioning prompts without echo and invalidates previous sessions. Remote provisioning accepts the existing authorized key path through `--identity` and sends the password over SSH stdin, never command-line arguments. Do not run provisioning during routine releases unless intentionally rotating credentials.

`package-library.py` includes documents and source-only annotations, never users, passwords, sessions or shared team notes. `deploy/import-library.py` verifies every file checksum and merges source records without overwriting live accounts or team annotations. After import, restore ownership to `chainlab:chainlab` and restart the API. Re-imports preserve existing shared work.

Private PDFs, SQLite files, exports and deployment artifacts are ignored by Git. Do not add them to the public research repository. Sharing inside the library does not imply public redistribution rights to the source papers.

## Verification

```powershell
../.venv/Scripts/python.exe -m unittest discover -s scripts -p test_library.py -v
../.venv/Scripts/python.exe scripts/verify-library.py
../.venv/Scripts/python.exe scripts/verify-library.py --base https://nn.rftf.cc.cd
```

The browser suite takes its password through hidden stdin, opens two independent sessions of the same account, verifies PDF pixels/text, marks, polling, conflict preservation, exports, logout and mobile viewports, and removes only records with that run's unique QA byline. Reports and screenshots live in `.artifacts/library/`. Browser emulation is not physical-device performance testing.

The PDF.js legacy build includes its maintained compatibility polyfills; the default 6.x build requires browser APIs unavailable in the installed Edge version. Workers, CMaps, standard fonts, WASM and ICC assets are hosted locally. See [PDF.js examples](https://mozilla.github.io/pdf.js/examples/) and [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
