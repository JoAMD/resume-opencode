# Fix: Post-Apply ATS Analysis Fails With Empty Inputs

## Problem

Post-apply ATS re-runs (after fix-suggestions, background, AutoChain) always fail with:

```
ERROR: Post-apply ATS AI error, falling back to regex:
  Error: No job description provided and no keywords supplied
```

Saved file: `ats-analysis.json` with `source: "regex"`, 0 keywords, 100% coverage (useless).

## Root Cause

Two bugs compound:

### Bug 1: JD never read from disk

Callers pass `jobDescription: ''` to `runAtsAiAnalysis`. The JD exists at `job-description.txt` in every job dir. Nobody reads it.

### Bug 2: Field name mismatch

`ats-analysis.json` stores extracted keywords as `extractedFromJD`. Callers read `.keywords` (doesn't exist) → always `[]`.

Combined: AI call gets empty JD + empty keywords → `extractKeywordsFromJD` throws → regex fallback.

## Fix

### Step 1: Add `readJobDescription(jobDir)` helper

**File:** `routes/generate.ts`

```ts
function readJobDescription(jobDir: string): string {
  const jdPath = path.join(jobDir, 'job-description.txt');
  if (!fs.existsSync(jdPath)) return '';
  return fs.readFileSync(jdPath, 'utf8').trim();
}
```

One function, reads `job-description.txt`. Returns empty string if missing. No abstraction, no config.

### Step 2: Fix three call sites to pass JD

All in `routes/generate.ts`:

| Line | Caller | Change |
|------|--------|--------|
| 1150 | `runPostApplyAtsCall` | Add `jobDescription: readJobDescription(input.jobDir)` |
| 1232 | `runAtsBackground` | Add `jobDescription: readJobDescription(input.jobDir)` |
| 1418 | AutoChain step 4 | Add `jobDescription: readJobDescription(jobDir.jobDir)` |

Each: replace `jobDescription: ''` with `jobDescription: readJobDescription(...)`.

### Step 3: Fix field name mismatch at three read sites

All in `routes/generate.ts`:

| Line | Read site | Current | Fix to |
|------|-----------|---------|--------|
| 1114 | `runPostApplyAtsAnalysis` | `priorAts?.keywords \|\| []` | `priorAts?.extractedFromJD \|\| []` |
| 1225 | `runAtsBackground` | `atsData.keywords \|\| []` | `atsData.extractedFromJD \|\| []` |
| 1414 | AutoChain step 4 | `d.keywords \|\| []` | `d.extractedFromJD \|\| []` |

No new fields. Data already exists; callers use wrong key.

## Files Changed

- `routes/generate.ts` — 1 new function + 6 one-line edits

## Verification

1. Run `npm test` — existing ATS tests should pass
2. Manual: apply suggestions on any job with JD present → `ats-analysis.json` should have `source: "ai"` (or meaningful regex fallback), non-zero `extractedFromJD`
3. Check server log: no more `No job description provided and no keywords supplied`

### Step 4: Fix `COMBINED_JSON_SCHEMA` missing `atsKeywords` in `required`

**File:** `services/ai.ts:520`

```ts
// Before:
required: ["resume", "coverLetter"]
// After:
required: ["resume", "coverLetter", "atsKeywords"]
```

**Why:** `atsKeywords` is declared in schema properties (`:436`) but not required. Model omits it. Prompt asks for it (`prompts/combined-system-prompt.txt:21`) but schema doesn't enforce. Model returns structured output without `atsKeywords` → `undefined` → fallback chain dead → `[]` → ATS guard blocks.

**One-line change.** Prompt already requests it; schema just needs to enforce it.

## Files Changed

- `routes/generate.ts` — 1 new function + 6 one-line edits
- `services/ai.ts` — 1 one-line edit (add `"atsKeywords"` to `required`)

## Verification

1. Run `npm test` — existing ATS tests should pass
2. Manual: apply suggestions on any job with JD present → `ats-analysis.json` should have `source: "ai"` (or meaningful regex fallback), non-zero `extractedFromJD`
3. Check server log: no more `No job description provided and no keywords supplied`

## Out of Scope

- Saving `atsKeywords` as `keywords` field (unnecessary — `extractedFromJD` already exists)
