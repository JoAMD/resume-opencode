# Phase 3: Form prefill, permalink URLs, and enhanced job folder links - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers four capabilities:

1. **Permalink URL sharing** — Browser URL hash (`#job=<slug>`) identifies the current job folder. Loading a permalink restores the form state and shows existing artifacts. The URL updates on generation completion and on manual folder-path input.

2. **Form prefill from job folder** — When a folder path is entered (blur or permalink), parse `job-description.txt`, `other-input.txt`, and `full-jd.txt` to prefill form fields. If fields are already filled, confirm with the user before overwriting.

3. **Enhanced result block** — After generation (or when loading a permalink to an existing folder), show all artifact links (resume.pdf, cover-letter.pdf, cover-letter.txt, ats-analysis.md), a "compare with latest backup" diff, and a quick-open all PDFs button.

4. **Generation status on permalink load** — When loading a permalink to a folder where generation is still in-progress, poll via taskId and show a step indicator + artifact availability list until complete.
</domain>

<decisions>
## Implementation Decisions

### Permalink URL Format

- **D-01:** URL hash format: `#job=<slug>` — e.g. `http://host/#job=shopify-senior-se-2026-07-21`
- **D-02:** URL base: Use current browser URL — handles reverse proxy, custom ports, localhost vs LAN IP
- **D-03:** On bad permalink (folder not found): Show error toast "Job folder not found" and keep the hash in URL — user can correct or clear manually
- **D-04:** URL updates on generation: Hash updates when user clicks any generate button (resume+cover, resume only, cover only)
- **D-05:** URL updates on manual folder path input: When user types a folder path (not system-triggered), update the hash to reflect the loaded folder

### Form Prefill

- **D-06:** Prefill files: `job-description.txt` → job description field, `other-input.txt` → extra notes and other fields, `full-jd.txt` → SEEK auto-fill textarea
- **D-07:** Company/role NOT parsed from folder slug — only from files
- **D-08:** Prefill trigger: Auto-prefill on blur (when folderPath input loses focus), AND on permalink load
- **D-09:** Prefill confirm dialog: If any form field is already filled, ask "Keep existing or use loaded?" — applies to both blur-triggered and permalink-triggered prefill
- **D-10:** Prefill is non-blocking: Errors (folder not found, can't read files) show a toast but do not block dependent actions (mark as applied, compile, etc.)
- **D-11:** File path input: If user pastes a path to a file (not a folder), use the parent folder — handle paths like `.../structured-output.json`
- **D-12:** Show "Loading job..." indicator while folder files are being read for prefill

### Result Block (Post-Generation + Permalink Load)

- **D-13:** Result block shows when: (a) generation completes, AND (b) loading a permalink to an existing folder (even without regeneration)
- **D-14:** Artifact links in result block: resume.pdf, cover-letter.pdf, cover-letter.txt, ats-analysis.md — all as clickable links
- **D-15:** "Compare with latest backup" block: Same as Phase 1/2 "apply suggestions once" diff — shows unified diff against latest backup version
- **D-16:** Quick-open all PDFs button: Opens resume.pdf + cover-letter.pdf in separate tabs simultaneously
- **D-17:** Copy buttons next to artifact links for easy sharing

### Permalink.txt

- **D-18:** Written after every successful generation (resume+cover, resume only, cover only)
- **D-19:** Overwrite if exists — always write fresh
- **D-20:** Contains exactly one line: the permalink URL (e.g. `http://host/#job=shopify-senior-se-2026-07-21`)
- **D-21:** Stored in the job folder as `permalink.txt`

### Generation Status (In-Progress Handling)

- **D-22:** When loading a permalink to a folder where generation is in-progress, show status + poll via taskId
- **D-23:** taskId storage: sessionStorage keyed by jobDir — survives refresh, scoped to tab
- **D-24:** UI shows both: (a) step indicator with descriptive label ("Step 2/4: Running ATS analysis"), AND (b) artifact availability list showing what exists now vs. pending
- **D-25:** Four generation steps with descriptive labels:
  - Step 1/4: "Generating resume + cover letter"
  - Step 2/4: "Running ATS analysis"
  - Step 3/4: "Applying ATS suggestions"
  - Step 4/4: "Final ATS analysis"
- **D-26:** If taskId not in sessionStorage but generation appears complete: Show result block (artifacts that exist in folder)
- **D-27:** Reuse existing taskId polling mechanism (GET /generate/task/:id) — do not create new polling endpoint

### Deferred from Phase 1/2

- **D-28:** Main model fills most of screen — styling tweak (carried from Phase 1, implemented in Phase 2 scope but deferred)
- **D-29:** Word diff shows line numbers for orientation when text overflows (carried from Phase 1, implemented in Phase 2 scope but deferred)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core Implementation References
- `public/index.html` — Main form HTML; where prefill targets and result block live
- `public/suggestions.js` — Diff modal implementation (`openDiffModal`, `closeDiffModal`); existing compare-with-backup block
- `public/style.css` — Existing styling for panels, result block, and form elements
- `routes/generate.ts` — POST /generate routes, taskId mechanism, background task handling
- `services/backupService.ts` — `latestBackupVersion`, backup listing
- `services/jobDir.ts` — `resolveJobDir`, folder validation, job folder detection
- `services/jobDescriptionSearch.ts` — How job-description.txt and full-jd.txt are read

### Related Phase Context
- `.planning/phases/02-version-diff-selector-fire-and-forget-ats-analysis/02-CONTEXT.md` — Phase 2 decisions on diff modal and auto-chain

### UI Patterns
- `public/index.html` §"Search past JDs" — Autocomplete folder input pattern (for folder path prefill UX)
- `public/index.html` §"Diff two backup versions" — Version diff selector panel pattern

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `#job-folder` result block in `index.html` — Already shows PDF link and folder path after generation; extend to show all artifact links
- `suggestions-diff-modal` — Existing modal for diff display; reuse for compare-with-latest-backup block
- `GET /generate/task/:id` polling — Existing mechanism for checking background task status
- `sessionStorage` — Already used for resumeType and autoApplySuggestions preferences; extend for taskId per jobDir

### Established Patterns
- Fire-and-forget IIFE for background tasks (Phase 2)
- Autocomplete folder input with datalist (version diff selector in Phase 2)
- Toast notifications for non-blocking errors
- Confirm dialog before overwriting form data

### Integration Points
- `public/index.html` — Add result block artifact links, permalink hash handling, prefill logic, generation status UI
- `public/suggestions.js` — Extend openDiffModal for compare-with-latest-backup
- `routes/generate.ts` — Write permalink.txt after generation completes
- `public/utils.ts` — Any shared utility functions for URL parsing, file reading

</code_context>

<specifics>
## Specific Ideas

- Result block should include a small "open all PDFs" button next to artifact links
- Error toasts for prefill failures should be non-blocking — dependent actions (mark as applied, compile) still work
- Artifact availability list during in-progress generation should show each artifact with a pending indicator (spinner or grayed out)
- Permalink hash should be clearly readable — the `#job=<slug>` format is the canonical permalink format
- Session storage key for taskId: `taskId_${jobDir}` to avoid collisions across job folders

</specifics>

<deferred>
## Deferred Ideas

### Generation Status Dashboard (Future Phase)
- **What:** A UI dashboard showing all in-progress generations across all open tabs
- **Why deferred:** Not needed for single-tab workflow; requires shared state infrastructure
- **Filed:** CONCERNS.md F-UT-02

### Real-Time Push via WebSocket/SSE (Future Phase)
- **What:** Replace polling with push updates from server for generation status
- **Why deferred:** Polling is sufficient for current use case; significant infrastructure change
- **Filed:** CONCERNS.md F-UT-03

### Detect Mid-Generation vs. Fresh Load from Folder State (Future Enhancement)
- **What:** Check session-info.txt or artifact timestamps to distinguish "generation never started" from "generation completed" when no taskId in sessionStorage
- **Why deferred:** Non-blocking; users can refresh manually; needs further UX design
- **Filed:** CONCERNS.md F-UT-01

### UI Surfacing of characterCountTrimmed (Future Phase)
- **What:** Surface the `characterCountTrimmed: "true"` flag in the UI when resume was trimmed
- **Why deferred:** Separate feature per RESUME_PAGE_LIMIT_UI_PLAN.md
- **Filed:** CONCERNS.md (existing deferred plan)

</deferred>

---

*Phase: 03-Form prefill, permalink URLs, and enhanced job folder links*
*Context gathered: 2026-07-21*
