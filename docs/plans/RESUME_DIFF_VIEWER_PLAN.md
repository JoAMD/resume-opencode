# Resume JSON Diff Viewer — Plan

**Status:** Draft (implementation not started)
**Owner:** TBD
**Branch:** TBD

---

## TL;DR

After `POST /generate/applySuggestions` runs, the user can see "Backup: `jobs/<slug>/backups/v<N>`" as a read-only text label (`public/suggestions.js:268-284`) but **cannot compare** the pre-edit and post-edit `structured-output.json` from inside the app. Today the only way to see the diff is to open two terminals / a VS Code window and run `diff` or `code --diff` by hand.

This plan adds an in-app diff viewer that:

1. Surfaces the latest backup path as a clickable link in the existing suggestions panel.
2. Adds `GET /generate/diffResume?jobDir=…&version=…` (read-only, path-allowlisted) that returns the unified diff between the backup and the on-disk resume, plus a small structured summary.
3. Renders the diff in a modal/popover next to the existing panel — no new dependencies, no new styling system, reuses the popover pattern already in `public/suggestions.js` (`openFilePopover`).
4. Exposes the same `GET` so power users can `curl` it from the terminal as a one-liner.

The on-disk backup is already the source of truth (`createVersionedBackup` in `services/backupService.ts:48-66` is called by `fixSuggestionsService.ts:221` *before* any model edit, and the path is returned in `buildApplySuggestionsResult` at `routes/generate.ts:745-753`). This plan only adds the read side.

---

## Background — what already exists

| What | Where | Notes |
| --- | --- | --- |
| Pre-edit backup | `services/backupService.ts:48-66` | `createVersionedBackup(jobDir, 'resume')` copies `structured-output.json`, `resume.pdf`, `resume.tex` into `backups/v${nextVersion}/`. |
| Backup surfaced in apply result | `routes/generate.ts:750-751` | `backupPath`, `backupVersion` returned in the task result. |
| Backup surfaced in UI | `public/suggestions.js:268-284` | `backupPathNode.textContent = "Backup: " + backupPath;` (text only, not a link). |
| Canonicalize helper | `services/fixSuggestionsService.ts:63-72` | `canonicalize(value)` does a sorted-key JSON stringify. Already used by `resumesAreEqual` to detect no-ops. Extractable into a shared `services/diffUtil.ts`. |
| File popover UX | `public/suggestions.js:211-237` | `openFilePopover` is the existing pattern for a search-driven list in a modal. We reuse the modal scaffolding, not the search. |
| Path allowlist | `routes/generate.ts:797-799` | `safeRealpath(validated.value.jobDir)` + `ensureJobsRootRealpath()` — every new route that accepts a `jobDir` must reuse this. |
| `nextBackupVersion` | `services/backupService.ts:22-33` | Already returns the next version to use; needs a sibling helper `latestBackupVersion(backupsRoot)`. |

**No new runtime dependencies.** The plan uses only `fs`, `path`, and a ~20-line line-by-line diff (or `node:diff` via `unifiedDiff()` — see Step 2.2).

---

## Goals

1. User can see a side-by-side or unified diff of `structured-output.json` (backup) vs `structured-output.json` (current) in one click from the suggestions panel.
2. User can also see the diff via `curl` for scripting / log sharing.
3. The route is read-only, path-allowlisted, and reuses the existing `safeRealpath` guard.
4. Backup version is selectable (defaults to latest) so the user can compare against any prior version, not just the most recent.
5. Same on-disk data, no schema changes, no AI calls, no new state.

## Non-goals

- Field-level / structured diff (add/remove/change of nested objects and arrays). The plan returns a `summary: { changedPaths }` list for fast scanning, but the rendered view is a textual diff — the same view a developer gets in `code --diff`.
- Rendering the diff as colour-coded JSON in a side-by-side pane. Possible future work; deferred to keep scope tight.
- Diffing anything other than `structured-output.json` (`resume.pdf`, `resume.tex`, `cover-letter.json` are out of scope).
- Comparing two arbitrary backup versions (e.g. v1 vs v3) with no current. Always the chosen backup vs the current on-disk resume.
- A streaming / incremental / live diff. The user clicks "Compare", gets the result.
- Auto-running the diff on every `applySuggestions` success. The user clicks explicitly.

---

## Scope

### Step 1 — Shared `diffUtil` (no behaviour change for existing code)

1. **New file** `services/diffUtil.ts`:
   - Move `canonicalize` from `services/fixSuggestionsService.ts:63-72` verbatim.
   - Move `resumesAreEqual` from `services/fixSuggestionsService.ts:74-76` verbatim, re-exported.
   - New: `unifiedDiffText(a: string, b: string, labelA: string, labelB: string): string` — line-by-line LCS-free diff is fine for resume JSONs (~10–30 KB pretty-printed). If `node:diff` is available (`require('node:diff')` returns truthy on Node 22+), use it; otherwise fall back to a minimal "same prefix / change hunks" implementation.
   - New: `summariseJsonDiff(a: unknown, b: unknown): { changedPaths: string[], addedKeys: string[], removedKeys: string[] }` — recursive walk over the two parsed values, collecting dot/bracket paths. Reuses `canonicalize` for sub-tree comparison.
2. **Update** `services/fixSuggestionsService.ts` to import `resumesAreEqual` from `./diffUtil` and delete the local copy. Confirm no other callers (`grep -n "resumesAreEqual\|canonicalize" services/`).
3. **Tests** new file `services/diffUtil.test.ts`:
   - `resumesAreEqual` parity (object key reorder is still equal).
   - `unifiedDiffText` produces no output for identical inputs, and produces an output containing a known changed line for a known input.
   - `summariseJsonDiff` returns the expected paths for a known added key, removed key, and changed scalar.

### Step 2 — Read-only `GET /generate/diffResume` route

1. **New route** in `routes/generate.ts`:
   - `GET /generate/diffResume?jobDir=…&version=…&format=unified|summary|both` (default `format=both`).
   - Query validation mirrors `applySuggestions`:
     - `jobDir` required, validated by the same `safeRealpath` + `ensureJobsRootRealpath` pattern.
     - `version` optional; if omitted, use `latestBackupVersion(backupsRoot)`. Reject values that don't match `/^v\d+$/` after `Number` parse.
   - Reads:
     - `path.join(realJobDir, 'backups', version, 'structured-output.json')`
     - `path.join(realJobDir, 'structured-output.json')`
   - Both files must exist; otherwise 404 with `{ error: 'Backup not found' | 'Resume not found', jobDir, version }`.
   - 200 response shape:
     ```json
     {
       "jobDir": "shopify-swe",
       "backupVersion": 1,
       "backupPath": "/abs/path/jobs/shopify-swe/backups/v1/structured-output.json",
       "currentPath": "/abs/path/jobs/shopify-swe/structured-output.json",
       "unifiedDiff": "@@ -1,3 +1,3 @@\n ...",
       "summary": {
         "changedPaths": ["contact.email", "summary", "experience.0.bullets.1"],
         "addedKeys": ["skills.newTool"],
         "removedKeys": ["skills.legacyTool"]
       }
     }
     ```
     - When `format=unified`, omit `summary`; when `format=summary`, omit `unifiedDiff`.
   - Files are read and pretty-printed via `JSON.parse` + `JSON.stringify(_, null, 2)` before diffing, so key reordering doesn't show as noise. (Sorted-key canonicalization is *not* used for display — only `summariseJsonDiff` uses it for the path list, since paths depend on the original structure.)
   - No PII handling needed on the route itself; the route is admin-gated via the existing basic-auth middleware (already wrapping admin endpoints in `server.ts`).
2. **New helper** in `services/backupService.ts`:
   - `latestBackupVersion(backupsRoot: string): number | null` — returns the max `vN` directory version, or `null` if none exist. Pure read; no side effects.
3. **Tests** in `routes/generate.test.ts`:
   - 200 on happy path with two known JSONs; assert `unifiedDiff` contains a known changed line and `summary.changedPaths` contains the expected path.
   - 404 when backup is missing; 404 when current is missing; error message names the missing file.
   - 400 when `jobDir` is missing.
   - 400 when `version` is not a positive integer (`v0`, `v-1`, `vabc` all rejected).
   - 403 / 400 on path-traversal: `jobDir=../etc` (rejected by `safeRealpath`).
   - `format=summary` omits `unifiedDiff`; `format=unified` omits `summary`; `format=both` (default) includes both.

### Step 3 — UI: clickable backup link + diff modal

1. **`public/suggestions.html`**: add a single modal scaffold (hidden by default) with id `suggestions-diff-modal`, containing a close button, a header with `Job: <slug> · Backup: v<N>`, and a `<pre>` body for the unified diff. No new CSS framework; reuse the existing modal backdrop class already used by `suggestions-file-popover`.
2. **`public/suggestions.js`**:
   - In `showResult` (`public/suggestions.js:268-284`): change `backupPathNode.textContent` from text to a `<button>`/`<a>` that calls a new `openDiffModal(backupVersion)`.
   - New `openDiffModal(version)`:
     - Validates `getJobSlug()` is set.
     - Fetches `GET /generate/diffResume?jobDir=…&version=v${version}`.
     - Renders `unifiedDiff` into the `<pre>` body and the `summary.changedPaths` as a bullet list in a side panel.
     - Reuses the popover backdrop close-on-outside-click pattern at `public/suggestions.js:235-237`.
   - New `closeDiffModal()`: hide the modal, restore focus to the trigger.
3. **`public/suggestions.js` modal styles**: add a small block to `public/style.css` (or wherever the existing modal CSS lives — verify by grep on `popover-empty` / `.popover`). Reuse existing classes where possible.
4. **No new JS dependencies**; no CDN, no bundler change.

### Step 4 — Docs sync (mandatory per AGENTS.md §3)

1. **`README.md`** — under the existing "Apply suggestions to an existing resume" section, add one paragraph:
   > "After apply runs, click **Compare with backup v1** to see the unified diff and a list of changed JSON paths between the pre-edit backup and the on-disk `structured-output.json`. The same data is available as JSON via `GET /generate/diffResume?jobDir=<slug>&version=v1`."
2. **`docs/FEATURES.md`** — extend the existing entry for the second-generation edit flow with a new bullet: "Compare current resume against any backup version (`GET /generate/diffResume`, UI link in the suggestions panel)."

### Step 5 — Safeguard

1. Run `pre_commit_code_health_safeguard` after all changes; refactor until no regression.
2. Run `npm test` and `npm run build`; both must be clean.
3. Manual smoke (see runbook below).

---

## Out of scope (explicit)

- Side-by-side field-level diff with colour-coded JSON.
- Diffing `resume.pdf` / `resume.tex` / `cover-letter.json`.
- Comparing two backups against each other (no "current").
- Auto-running the diff after every `applySuggestions` success.
- Live / streaming diff.
- Caching the diff response on the server (resumes are < 50 KB pretty-printed; negligible).

---

## Test plan

### Unit / route tests (vitest)

- `services/diffUtil.test.ts` — `resumesAreEqual` parity, `unifiedDiffText` smoke, `summariseJsonDiff` known outputs.
- `routes/generate.test.ts` — happy path, 404s, 400s, traversal rejection, format variants.

### Manual runbook

Pre-reqs: an OpenCode server, a `.env`, `node_modules` (same as `AI_PROMPT_TIMEOUT_PLAN.md` §Runbook §Prereqs).

1. **Baseline**
   ```bash
   npm run build
   npx vitest run
   ```
   Expect all tests passing.

2. **Pick or create a job with an apply-suggestions history**
   ```bash
   ls jobs/ | head
   ls jobs/<slug>/backups/
   ```
   Confirm at least one `vN/structured-output.json` exists.

3. **Curl the new route**
   ```bash
   curl -s "http://localhost:3001/generate/diffResume?jobDir=<slug>&version=v1" | jq '{backupVersion, summary, unifiedDiffLength: (.unifiedDiff | length)}'
   ```
   Expect HTTP 200, `backupVersion: 1`, `summary.changedPaths` non-empty (if the post-apply resume actually differs from v1), and `unifiedDiff` present.

4. **UI smoke**
   - `npm start` in one terminal.
   - Open `http://localhost:3001`, fill the form, generate a resume, then run **Apply suggestions** with any short text.
   - After the apply task completes, click **Compare with backup v1**.
   - Expect: modal opens, shows the unified diff and a `summary.changedPaths` bullet list. Close button + click-outside both close the modal.

5. **Negative path**
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3001/generate/diffResume?jobDir=<slug>&version=v999"
   ```
   Expect `404`.

6. **Tear down**
   ```bash
   # Ctrl-C the server
   ```

---

## Rollout checklist

- [ ] Branch + PR opened; this plan linked from the PR description.
- [ ] `npm run build` clean.
- [ ] `npx vitest run` passing (target: +5 new tests, all existing tests still green).
- [ ] `pre_commit_code_health_safeguard` shows no regression.
- [ ] Manual runbook steps 1–5 executed and observed.
- [ ] `README.md` and `docs/FEATURES.md` updated in the same commit.
- [ ] PR merged → main re-deployed.

---

## Refactor notes

- `canonicalize` and `resumesAreEqual` move from `fixSuggestionsService.ts` to `diffUtil.ts`. The move is pure relocation; behaviour is unchanged. The `fixSuggestionsService.ts:188` no-op check (`unchangedSince`) reads the file as text rather than comparing parsed JSON, so the canonicalize is only used for the post-edit equality test; the move has no observable effect on apply-suggestions behaviour.
- The `latestBackupVersion` helper is a 4-line addition to `backupService.ts`; it does not change `nextBackupVersion`'s behaviour.
- No new dependencies. `node:diff` is used opportunistically (Node 22+ is the project's target; verify in `package.json` `engines` if present, otherwise default to the local fallback). The local fallback is a 30-line "common prefix + change block" implementation, deliberately simpler than LCS — adequate for a 10–30 KB text diff.

---

## Open questions

1. **Modal vs. inline panel.** Plan proposes a modal (reuses `popoverRoot` backdrop pattern). An inline expandable panel below the existing buttons would keep the user in the form. Recommendation: modal — minimal new CSS, isolated from the form layout, and consistent with the existing popover UX. Easy to swap later.
2. **`format=summary` first-class?** If a future use case wants just the path list (e.g. a CI check that resumes changed in a specific section), the `format=summary` variant is cheap to add now. Plan includes it. If the user pushes back, drop to just `unified` + `both`.
3. **Cap on backup version list.** The modal currently only shows the *latest* backup. If the user wants to pick v1 vs v2, we'd need a small dropdown. Plan defers this; latest-only covers the "what did apply just change" use case.

---

## References

- `services/backupService.ts:48-66` — `createVersionedBackup`
- `services/fixSuggestionsService.ts:218-252` — `applySuggestions` lifecycle; calls `createVersionedBackup` on line 221 before any model edit
- `services/fixSuggestionsService.ts:63-76` — `canonicalize` / `resumesAreEqual` (to be moved)
- `routes/generate.ts:745-753` — `buildApplySuggestionsResult` (already returns `backupPath`, `backupVersion`)
- `routes/generate.ts:790-799` — `applySuggestions` route; pattern for `safeRealpath` + `ensureJobsRootRealpath`
- `public/suggestions.js:211-237` — existing `openFilePopover` pattern (backdrop, search, click-outside close)
- `public/suggestions.js:268-284` — `showResult` (the line that becomes clickable)
- `docs/plans/RESUME_PAGE_LIMIT_UI_PLAN.md` — sibling deferred-UI plan; same "small UI addition on top of settled server work" shape
