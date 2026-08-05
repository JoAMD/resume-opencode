# Plan: Merge autoChain into single generate call

## Problem

When `autoApplySuggestions` is checked, the client makes two API calls:
1. POST `/generate/` → creates folder A, runs step 1 (generate resume)
2. POST `/generate/autoChain` → creates folder B, runs steps 1-4

Result: two identical folders ~2 min apart for the same job.

When `autoApplySuggestions` is unchecked, client calls POST `/generate/` only — different code path, different endpoint. Two code paths for same core operation.

## Root Cause

`runAutoChainBackground` (generate.ts:1281) calls `createJobDir()` which always creates a new timestamped folder. It never receives the folder from step 1.

## Solution

Use `autoChain` as the single server-side endpoint for all cases. Client sends one call, server runs all steps in one folder. `autoApplySuggestions` flag controls whether steps 2-4 run.

## Changes

### 1. Server: `routes/generate.ts`

**a. Update `autoChain` response to include `jobDir`**

Line 1469: change `res.json({ taskId })` to `res.json({ taskId, jobDir: jobDir.slug })` — but `jobDir` is created inside `runAutoChainBackground`, not before the response. Move `createJobDir` before `res.json`:

```ts
// Before (line 1467-1469):
const taskId = createTaskId();
taskMap.set(taskId, { status: 'pending', startedAt: Date.now(), step: 1, stepLabel: STEP_LABELS[1] });
res.json({ taskId });

// After:
const jobDirCtx = createJobDir(companyName!, roleName!, modelSelect);
const taskId = createTaskId();
taskMap.set(taskId, { status: 'pending', startedAt: Date.now(), step: 1, stepLabel: STEP_LABELS[1] });
res.json({ taskId, jobDir: jobDirCtx.slug });
```

Then pass `jobDirCtx` into `runAutoChainBackground` instead of having it call `createJobDir` internally.

**b. Add `permalinkBaseUrl` support to `runAutoChainBackground`**

Line 1281: add `permalinkBaseUrl` to the input type. At line 1308, add `buildPermalinkFromBase` fallback — same pattern as `/generate/` handler (line 350-354):

```ts
// Line 1308 — before:
const validatedPermalink = validatePermalinkUrl(input.permalinkUrl, jobDir.slug);

// After:
const validatedPermalink = validatePermalinkUrl(input.permalinkUrl, jobDir.slug)
  ?? buildPermalinkFromBase(input.permalinkBaseUrl, jobDir.slug);
```

**c. Support `autoApplySuggestions: false` mode**

Add field to `GenerateRequestBody` type (line 35). When `false`, `autoChain` runs only step 1 (skip steps 2-4). This lets the endpoint replace POST `/` for all cases:

```ts
// In runAutoChainBackground, after step 1 completes:
if (input.autoApplySuggestions === false) {
  taskMap.set(taskId, {
    status: 'complete',
    result: genResult.result,
    startedAt: Date.now(),
    sessionId: genResult.sessionId,
    coverLetterSessionId: genResult.coverLetterSessionId,
    step: 1,
    stepLabel: STEP_LABELS[1],
  });
  return;
}
```

**d. Handle no-op from step 3 (apply suggestions)**

When `applySuggestions` throws `NoOpResultError` (line 1379), the task is set to `status: 'error'` with `error: 'no-op'`. The unified client polling must handle this:

```ts
// In unified poll function:
if (data.status === 'error') {
  if (data.error === 'no-op') {
    // Apply was no-op — resume is fine, just show result without ATS updates
    return data.result;
  }
  throw new Error(data.error);
}
```

**e. Ensure result fields are consistent across completion states**

For `autoApplySuggestions: false` (step 1 only), `genResult.result` contains:
- `pdfUrl`, `jobDir`, `sessionId`, `trimBackupPath`, `trimBackupVersion`

For `autoApplySuggestions: true` (all 4 steps), the final task result at line 1425-1431 merges step 1 + step 4 results via spread. These fields survive:
- `pdfUrl` — from step 1, preserved in spread at line 1372
- `jobDir` — from step 1, preserved
- `trimBackupVersion` — from step 1, preserved (no collision with `backupVersion` from `applyBuilt`)
- `coveragePercent` — from step 4, added at line 1428

**f. Keep POST `/generate/` for backward compat**

Don't remove it — just stop calling it from the client. It still works for any external consumers.

### 2. Client: `public/index.html`

**a. Replace `generateResume` body (lines 531-635)**

Instead of:
```
POST /generate/ → waitForTask → show resume → fire POST /autoChain → pollAutoChain
```

Do:
```
POST /generate/autoChain → pollSingleTask → show resume + ATS when complete
```

**b. Unify polling into single function with step progress**

Replace both `waitForTask` (line 427) and `pollAutoChain` (line 438) with one function. The server already returns `step` and `stepLabel` on every poll (`GET /task/:taskId` at line 282-293) — the client just needs to read them:

```ts
async function pollGenerationTask(taskId) {
  while (true) {
    const res = await fetch(`/generate/task/${taskId}`);
    const data = await res.json();

    // Update step label in status area (data already provided by server)
    if (data.stepLabel) {
      status.textContent = data.stepLabel + '…';
    }

    if (data.status === 'complete') return data.result;
    if (data.status === 'error') {
      if (data.error === 'no-op') return data.result; // no-op is not fatal
      throw new Error(data.error);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
}
```

No server changes needed — `step`/`stepLabel` are already exposed at lines 289-290.

**c. After task completes, handle both completion states**

```ts
const result = await pollGenerationTask(data.taskId);

// Always show resume (present in both step-1-only and step-4 results)
document.getElementById('pdf-link').href = result.pdfUrl;
// ... show folder, session ID, etc. (same as current lines 575-598)

configureTrimBackupButton(result.jobDir, result.trimBackupVersion);
renderResultBlock(result.jobDir, 'generate');

// Remove loading spinners from artifact links (files are now on disk)
document.querySelectorAll('.artifact-spinner').forEach(el => el.remove());

// Show ATS toast if coverage available (only in step-4 completion)
const coverage = result.coveragePercent;
if (coverage !== undefined) {
  const toast = document.getElementById('ats-toast');
  if (toast) {
    toast.textContent = `ATS analysis ready: ${coverage}% coverage`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 15000);
  }
}

// Dispatch auto-apply-complete for suggestions.js listener
// Pass atsStatus/atsAnalysis from task object (they live on the task, not in result)
window.dispatchEvent(new CustomEvent('auto-apply-complete', {
  detail: {
    taskResult: {
      ...result,
      atsStatus: data.atsStatus,
      atsAnalysis: data.atsAnalysis,
    },
  },
}));
```

**d. Remove autoChain fire-and-forget block (lines 607-635)**

Delete the `fetch('/generate/autoChain', ...)` block entirely.

**e. Pass `autoApplySuggestions` in the request body**

Add to `buildPayload`:
```ts
autoApplySuggestions: document.getElementById('autoApplySuggestions')?.checked ?? true,
```

Also add `permalinkBaseUrl` (currently missing from autoChain call):
```ts
permalinkBaseUrl: window.location.origin + window.location.pathname,
```

**f. Handle duplicate conflict for autoChain**

The `autoChain` handler already has `duplicateConflictResponse` at line 1456. Client needs to handle 409 response same as it does for POST `/` (lines 539-556). The existing duplicate handling code can be reused since both endpoints return the same 409 shape.

**g. Loading spinners on artifact links**

Show a spinner next to each artifact link while files are being generated. The link stays clickable (early file may already exist on disk).

Infrastructure:
- Spinner CSS already exists: `.inline-spinner` + `@keyframes spin` (style.css:581-591)
- Currently only used in status steps, not artifacts

In `renderResultBlock` (line 866-896), after creating each artifact row, append a spinner:

```ts
items.forEach((item) => {
  const row = document.createElement('div');
  row.className = 'artifact-row';
  row.setAttribute('data-artifact', item.name);
  const a = document.createElement('a');
  a.className = 'artifact-link';
  a.href = `/jobs/${slug}/${item.name}`;
  a.target = '_blank';
  a.textContent = item.label;
  const spinner = document.createElement('span');
  spinner.className = 'inline-spinner artifact-spinner';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'artifact-copy button-tiny';
  btn.textContent = 'Copy';
  row.appendChild(a);
  row.appendChild(spinner);
  row.appendChild(btn);
  artifactsEl.appendChild(row);
});
```

**Per-step spinner removal** — spinners disappear as each step completes, not all at once. The mapping of step → artifacts produced:

| Step | Artifacts on disk after step | Spinners to remove |
|------|------------------------------|-------------------|
| 1 (generate) | resume.pdf, cover-letter.pdf, cover-letter.txt | Resume PDF, Cover Letter PDF, Cover Letter TXT |
| 2 (ATS analysis) | ats-analysis.json (not an artifact link) | none |
| 3 (apply suggestions) | structured-output.json updated, no new artifacts | none |
| 4 (final ATS) | ats-analysis.md | ATS Analysis |

In the unified polling function, after updating the step label:

```ts
// Per-step spinner removal
const STEP_ARTIFACTS: Record<number, string[]> = {
  1: ['resume.pdf', 'cover-letter.pdf', 'cover-letter.txt'],
  4: ['ats-analysis.md'],
};
const artifactsToRemove = STEP_ARTIFACTS[data.step];
if (artifactsToRemove) {
  for (const name of artifactsToRemove) {
    const row = document.querySelector(`.artifact-row[data-artifact="${name}"]`);
    const spinner = row?.querySelector('.artifact-spinner');
    spinner?.remove();
  }
}
```

Also remove any remaining spinners on task completion (safety net for edge cases):
```ts
if (data.status === 'complete') {
  document.querySelectorAll('.artifact-spinner').forEach(el => el.remove());
  return data.result;
}
```

The link stays clickable the whole time — if the file exists on disk (e.g. resume.pdf from step 1), clicking works immediately. If it doesn't exist yet (e.g. ats-analysis.md before step 4), the user gets a 404 but the spinner signals it's still generating.

### 3. Tests: `routes/generate.test.ts`

- Update the 2 existing step-tracking tests (lines 925, 955) to use `/autoChain` instead of `/`
- Add test: autoChain returns `jobDir` in response
- Add test: `autoApplySuggestions: false` skips steps 2-4

## Files Changed

| File | Change |
|------|--------|
| `routes/generate.ts` | Move createJobDir before response, add permalinkBaseUrl with buildPermalinkFromBase fallback, add autoApplySuggestions flag, ensure result fields consistent |
| `public/index.html` | Single autoChain call, unified polling with step labels, remove fire-and-forget block, dispatch auto-apply-complete with atsStatus/atsAnalysis from task object, add artifact spinners |
| `public/style.css` | No changes needed — `.inline-spinner` already exists |

## What Stayed the Same

- POST `/generate/` route still exists (backward compat)
- `runAutoChainBackground` logic unchanged (just receives jobDir instead of creating it)
- All step labels and task tracking unchanged
- `applySuggestions`, `runATSAnalysis`, `runAtsAiService` unchanged
- `suggestions.js` listener for `auto-apply-complete` still fires (from unified polling)
- `showResult` in suggestions.js targets different DOM elements than `renderResultBlock` — no overlap

## Verification

1. Generate with autoApply checked → one folder, 4 steps, resume + ATS in result
2. Generate with autoApply unchecked → one folder, step 1 only, resume in result
3. Duplicate detection → 409 with confirm dialog, retry with `force: true`
4. Step 3 no-op → result shown without ATS toast, no error shown
5. Step progress → status text updates per step during generation ("Generating resume + cover letter…", "Running ATS analysis…", etc.)
6. Artifact spinners → spinners next to each file link, removed per-step (Resume/Cover spinners after step 1, ATS Analysis spinner after step 4)
7. Run existing tests: `npx vitest run routes/generate.test.ts`
