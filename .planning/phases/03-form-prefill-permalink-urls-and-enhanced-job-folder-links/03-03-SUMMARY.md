---
phase: "03"
plan: "03"
type: execute
gap_closure: true
completed_at: "2026-07-21"
status: complete
---

# Plan 03-03: Phase 3 UAT Gap Closure — openDiffModal ref, copyToClipboard, permalink restyle

## What shipped

### G-03-2 (blocker) — `public/suggestions.js`

- Removed file-level `globalThis.openDiffModal = openDiffModal;` (was at
  line 685, outside the `initSuggestionsPanel` IIFE that defines
  `openDiffModal`).
- Added `globalThis.openDiffModal = openDiffModal;` inside the IIFE,
  immediately after the closing `}` of the `openDiffModal` function
  (now at line 342). The function stays in the IIFE — its closure over
  `diffModalTrigger`, `currentDiffSlug`, `cachedWordDiffHtml`, etc. is
  not exportable.

### G-03-3 (major) — `public/index.html`

- New `async function copyToClipboard(text: string): Promise<boolean>`
  helper near the top of the inline `<script>` block (just after the
  auto-apply checkbox handler). The helper:
  1. Tries the Async Clipboard API on secure contexts
     (`navigator.clipboard && window.isSecureContext`) and returns
     `true` on success.
  2. Falls back to a temporary off-screen `<textarea>` +
     `document.execCommand('copy')` on insecure origins (e.g. the
     user's LAN setup at `http://192.168.x.x:3000`).
  3. Returns `false` if both paths fail.
- Migrated all four `navigator.clipboard.writeText` call sites to
  `copyToClipboard`:
  1. `session-id-copy` click handler — kept the 1200 ms "Copied!" dance
     and the console.error fallback.
  2. `renderResultBlock` artifact copy buttons (4 buttons) — kept the
     1200 ms "Copied!" dance.
  3. `renderResultBlock` permalink copy button — kept the 1200 ms
     "Copied!" dance.
  4. `copy-path-btn` click handler — refactored from `.then(...)` to
     `async/await` to await the helper. Kept the 2000 ms "Copied!" dance.
- After migration, the only `navigator.clipboard.writeText` reference
  in the file is inside the `copyToClipboard` helper itself (the
  intended single point of contact with the Async Clipboard API).

### G-03-1 (cosmetic) — `public/index.html` + `public/style.css`

- The permalink anchor on line 214 now carries
  `class="result-permalink__url"` and `rel="noopener noreferrer"`
  (alongside the existing `target="_blank"`).
- `public/style.css` adds a `.result-permalink__url` rule that styles
  the anchor as a monospace code-style text link — matching the
  existing `.result-permalink code` background (`#1a1a2e` / `#e0e0e0`
  text, 2px/6px padding, 3px border-radius, `word-break: break-all`,
  `text-decoration: none`) — plus a `:hover` state (`#2a2a4e`
  background, white text).
- The Copy button next to the permalink keeps its `.button-tiny` class
  for visual consistency with the artifact copy buttons.

### Docs — `docs/FEATURES.md`

- The "Permalink URL" bullet (line 25) now ends with: "The permalink
  is rendered as a monospace code-style anchor with a small Copy
  button next to it." Per AGENTS.md "Keep Docs in Sync With Code" —
  the visual change is user-noticeable, so the feature doc gets a
  trailing sentence describing the new visual treatment.

## Verification

### Grep-based checks (per plan Sub-step F.1-7)

| # | Check | Expected | Actual |
|---|-------|----------|--------|
| 1 | `grep -c "navigator.clipboard.writeText" public/index.html` | 1 (helper's internal ref) | **1** ✓ |
| 2 | `grep -c "globalThis.openDiffModal = openDiffModal;" public/suggestions.js` | 1 | **1** ✓ |
| 3 | `grep -n "globalThis.openDiffModal" public/suggestions.js` | line inside IIFE (< 669) | **line 342** ✓ |
| 4 | `grep -c "function copyToClipboard" public/index.html` | 1 | **1** ✓ |
| 5 | `grep -c "result-permalink__url" public/index.html` | ≥ 1 | **1** ✓ |
| 6 | `grep -c "result-permalink__url" public/style.css` | ≥ 2 (base + hover) | **2** ✓ |
| 7 | `grep -c "result-permalink__url" docs/FEATURES.md` | 0 | **0** ✓ |

### Plan verification note

The plan's `<verify>` block contains a strict
`grep -c "navigator.clipboard.writeText" public/index.html | grep -q '^0$'`
assertion. This is a defect in the plan: a correct implementation
necessarily has 1 reference (the helper itself). The plan's `<done>`
section correctly describes the intent ("zero direct calls — only the
helper references it"), so the implementation matches the intent and
the verification string is treated as overly strict. The grep returns
1 (helper-only) — the correct outcome per the `<done>` text.

### Build + test

- `npm test` — 248 tests pass, 0 failures (no regressions).
- `npm run build` — clean.

### Code Health

- `pre_commit_code_health_safeguard` is unavailable in this runtime
  (CodeScene CLI exits with code 1 due to the worktree's `node_modules`
  symlink being followed as a directory; not a code issue). Manual
  review of the diff confirms:
  - No new dependencies.
  - No new server routes or test-suite changes.
  - One single-concern helper (`copyToClipboard`).
  - Four call-site migrations, each a mechanical `try/await/catch` →
    `await copyToClipboard/return` swap.
  - One two-line CSS addition (base + hover), BEM-named to match the
    existing `.result-permalink code` rule.
  - One `globalThis` assignment moved from file-level into the IIFE
    (no net code change, just scope).

## Manual runbook (deferred to a human-verify pass on a running dev server)

The test suite cannot exercise these client-side UI behaviours
(non-secure-context HTTP, browser-only DOM, clipboard API). They need
a human on a running dev server (`npm start`) on the user's LAN
(e.g. `http://192.168.x.x:3000`):

1. Load the page; open DevTools console. Confirm there is NO
   `ReferenceError: openDiffModal is not defined` log.
2. Generate a resume (or load an existing permalink). Confirm the
   result block appears.
3. Visually inspect the permalink line. It should read as a monospace
   code-style text link, not a button.
4. Click the "Copy" button next to the permalink. Confirm the
   clipboard now contains the permalink URL and the button shows
   "Copied!" for 1.2 seconds.
5. Click each of the four artifact Copy buttons in turn. Confirm the
   clipboard contains the absolute URL of that artifact and the
   button shows "Copied!" for 1.2 seconds.
6. Click "Compare with latest backup". Confirm the diff modal opens
   (not the "Diff modal not yet loaded" toast). Close the modal.
7. Type a folder path into `#folderPath` and click the Folder Path
   "Copy" button. Confirm the clipboard contains the folder path.
8. If a session id has been generated, click the session-id Copy
   button. Confirm the clipboard contains the session id.
9. Run the manual runbook on `localhost` (a secure context) and
   confirm Copy buttons still work there too (no regression).

## Deviations from the plan

- **Plan verification string overly strict:** as noted above, the
  plan's `<verify>` asserts `navigator.clipboard.writeText` count is
  exactly 0. The `<done>` text correctly allows 1 (the helper's
  internal reference). Implementation matches `<done>`, not
  `<verify>`. This is a planning defect, not a code defect; the
  implementation is correct per the plan's stated intent.
- **No additional commits beyond what the plan allows.** The plan
  states "Treat each sub-step as a labeled commit, but execute them
  in one task" — landed as a single `fix(03)` commit covering all
  four files (the three sub-step themes share a single client-side
  UI concern and the plan explicitly warns that separating the
  permalink visual change from the `copyToClipboard` migration would
  leave the permalink pointing at the old call site mid-rollout).

## Post-ship dev fix (commit 289c12f)

User feedback on the ship: the chip-style monospace pill + Copy button
read as a UI component, not a URL. Replaced the visual treatment:

- `.result-permalink__url` no longer carries the `#1a1a2e` background,
  padding, or border-radius. The monospace font stays (URLs benefit
  from it) and the color switches to the link-blue `#4f8ef7` with
  `text-decoration: underline` on `:hover` so it visibly behaves like
  a browser link.
- `.result-permalink` is now a flex row (`display: flex;
  align-items: baseline; gap: 6px; flex-wrap: wrap`) with the URL
  flexing (`flex: 1 1 auto; min-width: 0`) so the Copy button sits
  cleanly to the right regardless of URL length. The "Permalink:"
  label remains the first flex item as a text node.
- `docs/FEATURES.md` "Permalink URL" bullet rewritten to describe the
  plain-link treatment.

Not in scope: the user also reported "Open all PDFs" only opens
`resume.pdf`. Root cause is the browser popup blocker — `window.open`
called twice from the same click handler — the second call returns
`null` silently in Chrome/Edge. Per user direction, this is left as-is
(a browser limitation, not a code defect).

## Post-ship dev fix 2 — VDS prefill on permalink load (commit a8261dc)

User follow-up: "Can I also prefill Diff two backup versions with the
folder name?" The wiring for the VDS panel was already in place inside
`initSuggestionsPanel` in `public/suggestions.js` (the `lastJobDir` read
at line 594, the `loadVersionDropdowns` call at line 642, the existing
smart-default version selection at lines 614-624). The defect was a
**race condition**: `runPrefill` and `initSuggestionsPanel` boot in
parallel on page load, and `initSuggestionsPanel`'s synchronous read of
`lastJobDir` almost always fired BEFORE `runPrefill`'s
`await fetch('/generate/prefill')` resolved. So on a permalink load the
VDS folder input stayed empty even though the code "looked" right.

Fix (Option A — CustomEvent pub/sub):

- `public/index.html` `runPrefill` now dispatches
  `window.dispatchEvent(new CustomEvent('prefill-complete', { detail: { slug: data.slug, folderPath: data.folderPath, source } }))`
  right after `lastJobDir` is set (now at line 843). The `source`
  parameter distinguishes `'hash'` (permalink), `'blur'` (folder-path
  typing), and any future caller.
- `public/suggestions.js` `initSuggestionsPanel` replaces the sync
  one-shot read with a `prefillVdsPanel(slug)` helper invoked from:
  1. A one-shot sync read — covers the case where
     `initSuggestionsPanel` boots AFTER `runPrefill` finishes (rare
     but possible if `/generate/prefill` is fast and the suggestions
     template fetch is slow).
  2. A `'prefill-complete'` window listener — covers permalink hash,
     folder-path blur, and any future caller of `runPrefill`.
- The smart-default version selection in `loadVersionDropdowns` is
  unchanged (user confirmed "keep the existing smart-default logic"):
  source = second-latest backup, target = latest backup (or `current`
  if only one backup exists).
- `docs/FEATURES.md` gets a new "Version diff selector" bullet
  documenting the panel and its prefill behavior. (No "Version diff
  selector" section existed previously; the bullet is placed after
  "Result block" where "Compare with latest backup" already lives.)

Subagent-executed; orchestrator spot-checked the diff before commit
and ran the full verification (248/248 tests, build clean).

## Self-Check

- [x] All sub-steps executed.
- [x] Source + docs committed in a single atomic commit
  (`fix(03): close G-03-1/2/3 — openDiffModal ref, copyToClipboard helper, permalink restyle`).
- [x] Pre-existing plan-amendment diffs (03-01, 03-02 clarifications +
  STATE.md phase-3 plan count) committed separately as a
  `docs(03)` commit so this plan's commit is scoped to the gap fix.
- [x] `npm test` is clean (248 tests, 0 failures).
- [x] `npm run build` is clean.
- [x] Code Health safeguard: not available in this runtime (CLI
  chokes on the worktree's `node_modules` symlink). Manual diff
  review confirms no regression — see "Code Health" above.
- [x] No modifications to shared orchestrator artifacts (STATE.md
  pre-existing changes committed in the prior `docs(03)` commit,
  not in this plan's commit).
