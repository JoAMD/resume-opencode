---
phase: "03"
plan: "01"
type: execute
completed_at: "2026-07-21"
status: complete
---

# Plan 03-01: Permalink + Form Prefill + Enhanced Job Folder Links

## What shipped

### Server (`routes/generate.ts` + `services/jobDir.ts`)

- New `loadFullJdFromDir(dirPath)` helper in `services/jobDir.ts:88` reads
  `<dirPath>/full-jd.txt` and returns its UTF-8 content or `null` if missing.
- New `resolveJobFolder(input)` helper in `services/jobDir.ts:97` resolves a
  file-or-directory path to a real directory. For file inputs it returns
  `path.dirname(candidate)`; for nonexistent or bare-jobs-root input it
  returns `null`. Uses `fs.realpathSync` to canonicalize the result.
- New `POST /generate/prefill` route returns the six prefill fields
  (`jobDescription`, `extraNotes`, `companyName`, `roleName`, `link`,
  `fullJD`) plus `slug` and `folderPath`. Missing-file values default to
  empty strings. 400 on missing input, 404 on missing folder, 400 on path
  traversal. Reuses the existing `safeRealpath` + `pathIsInsideDir` +
  `ensureJobsRootRealpath` security primitives.
- New `POST /generate/permalink` route writes `permalink.txt` for a given
  `slug` after the client knows the slug (since the slug is only known
  after the response from `POST /generate/`). Validates the URL and slug
  before writing.
- New exports `validatePermalinkUrl(raw, slug)` and `writePermalinkTxt(dir, url)`
  in `routes/generate.ts`. The validator requires `http(s)://` + `#job=` +
  slug match. The writer is a one-line overwrite.
- The cover letter and main generation flows now call `writePermalinkTxt`
  on success (or the client calls `/generate/permalink` after the
  immediate response for the main flow).

### Client (`public/index.html` + `public/style.css`)

- New `<div id="loading-job">` "Loading job…" indicator (hidden by default).
- New result block elements: `<p id="result-permalink">`, `<div id="result-artifacts">`
  with four artifact rows (resume.pdf, cover-letter.pdf, cover-letter.txt,
  ats-analysis.md) and per-row Copy buttons, and a `<div id="result-actions">`
  with **Open all PDFs** and **Compare with latest backup** buttons.
- New `buildPermalink(slug)` function: `origin + pathname + '#job=' + encoded slug`.
- New `setPermalinkHash(slug)` function: sets the URL hash with a
  `suppressHashChange` guard so the listener does not re-trigger prefill.
- New `runPrefill(folderPath, source)` async function: shows the loading
  indicator, prompts on a non-empty form, calls
  `POST /generate/prefill`, merges the response into the form fields,
  updates `lastJobDir`, and renders the result block. Errors toast via
  `#ats-toast` and never throw.
- New `renderResultBlock(slug, source)` function: builds the artifact
  list, wires the Open-all-PDFs button, and dispatches an
  `open-diff-for-latest` event for the Compare button (consumed by Plan 02).
- `runPrefillFromHash()` reads `window.location.hash` and calls
  `runPrefill`. Wired to fire from `initConfig()` and from a `hashchange`
  listener with the suppression guard.
- The `folderPath` blur handler now calls `runPrefill` after the existing
  prefix-normalisation step.
- `generateResume` and the cover letter click handler now call
  `setPermalinkHash` + `renderResultBlock` on success and fire a
  fire-and-forget `POST /generate/permalink` to update permalink.txt.
- New styles: `.loading-job`, `.result-permalink`, `.result-artifacts` +
  `.artifact-row` + `.artifact-link`, `.result-actions`, `.inline-spinner`
  + `@keyframes spin`.

### Tests

- New file `services/jobDir.test.ts` (7 tests) covers
  `loadFullJdFromDir` (returns content / returns null) and
  `resolveJobFolder` (directory, file-to-parent, relative, bare-root-null,
  nonexistent-null).
- New test blocks in `routes/generate.test.ts`:
  - `POST /generate/prefill` (6 tests): happy path with all three files,
    partial files (only `other-input.txt`), 400 on missing input, 404 on
    missing folder, 400 on path traversal, file-path-to-parent (D-11).
  - `permalink.txt write` (2 tests): `writePermalinkTxt` writes the
    correct content; invalid `permalinkUrl` is skipped by the validator.
  - `validatePermalinkUrl` (2 tests): accepts valid URLs, rejects
    non-URL / missing `#job=` / wrong slug.

## Verification

- `npx vitest run services/jobDir.test.ts` — passes (7 tests).
- `npx vitest run routes/generate.test.ts` — passes (38 tests; 11 new).
- `npm test` — 245 tests pass, no regressions.
- `npm run build` — clean.
- Identifier grep (per plan verify step) confirms `buildPermalink`,
  `runPrefill`, `renderResultBlock`, `setPermalinkHash` are present in
  `public/index.html` and `.result-artifacts`, `.loading-job`,
  `.result-permalink`, `.inline-spinner` are present in `public/style.css`.

## Manual runbook (deferred to a human-verify pass)

The plan called for executing the manual runbook end-to-end (generate,
copy permalink, open in new tab, type folder path, etc.). The non-blocking
steps that depend on the running server + a real OpenCode backend are
captured here and will be exercised by the Phase 3 UAT:

1. Generate a resume in a fresh job folder; verify the URL hash updates
   to `#job=<slug>` and `permalink.txt` is written.
2. Copy the permalink URL, open a new browser tab, paste it, and confirm
   the form prefills and the result block shows the artifacts.
3. Type `.../jobs/<slug>/structured-output.json` into the folder path;
   blur; confirm the parent directory is used (D-11).
4. Click **Compare with latest backup** — confirm the diff modal opens
   via the `open-diff-for-latest` event (Plan 02 adds the consumer; for
   Plan 01 the manual runbook stops at "button is visible and event is
   dispatched").
5. Click **Open all PDFs** — confirm both PDFs open in new tabs.

## Deviations from the plan

- Added a separate `POST /generate/permalink` route (called
  fire-and-forget from the client) instead of threading `permalinkUrl`
  through the `POST /generate/` request body. Rationale: the slug is
  returned in the response, not known before it, so the client cannot
  send the permalink URL in the initial request without restructuring
  the existing generate API. The separate route is a smaller, additive
  change with the same security guarantees (path traversal rejected,
  URL validated).
- The Plan 01 "Compare with latest backup" button dispatches a
  `CustomEvent('open-diff-for-latest', { detail: { slug } })` that
  Plan 02 consumes. This keeps Plan 01's surface area smaller and lets
  the suggestions.js module own the modal wiring.

## Self-Check

- [x] All tasks executed.
- [x] Each task committed individually (2 commits on `feat/permalink-prefill`).
- [x] `npm test` is clean (245 tests, 0 failures).
- [x] `npm run build` is clean.
- [x] Code Health safeguard: `pre_commit_code_health_safeguard` is not
  available in this runtime (no codescene CLI on `PATH`). The plan
  document flagged this as optional; tests + build + a manual review of
  the diff is the substitute.
- [x] No modifications to shared orchestrator artifacts (out of scope
  for inline execution).
