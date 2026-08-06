# Structured Output Failure: Schema-Prompt Mismatch

## Failure Observed

Model generated JSON that didn't match expected output. Root cause: prompt and
schema disagree on what fields exist, what's required, and what format to use.

## Issues

### Issue 1: Schema-prompt field mismatch

**Problem:** Prompt asks model to return `githubUrl`/`githubDisplay` in resume.
Schema marks them optional (not in `required`). Model omits them. Prompt also
has `bodyParagraph` as `oneOf[string, array]` — model picks one, no enforcement.

**Files involved:**
- `services/ai.ts:346-405` (RESUME_JSON_SCHEMA)
- `services/ai.ts:433-521` (COMBINED_JSON_SCHEMA)
- `prompts/combined-system-prompt.txt` (prompt content, gitignored)

**Current state:**
- Schema `required`: `["name", "phone", "email", "summary", "skills", "experience", "education", "projects"]`
- Prompt says: include `githubUrl`, `githubDisplay`
- Schema: `githubUrl`/`githubDisplay` exist in `properties` but not in `required`
- `bodyParagraph` uses `oneOf[array, string]` — model can pick either

**Fix:**
1. Remove `name`, `phone`, `email`, `linkedinUrl`, `linkedinDisplay`, `githubUrl`,
   `githubDisplay` from schema properties entirely. These are static — fill them
   in programmatically after model returns. Model should only return content fields.
2. Remove `fullName`, `email`, `phone`, `linkedinUrl`, `linkedinDisplay` from
   cover letter schema. Same reason.
3. Remove `oneOf` from `bodyParagraph`. Force array only. Prompt says "array
   preferred" but schema allows string — pick one.

**After fix, schema `required` for resume:**
```
["summary", "skills", "experience", "education", "projects"]
```

**After fix, schema `required` for cover letter:**
```
["openingParagraph", "bodyParagraph", "closingParagraph"]
```

**After fix, `bodyParagraph`:**
```
{ type: "array", items: { type: "string" } }
```

### Issue 2: Name/email/LinkedIn/GitHub don't need model output

**Problem:** Model returns `name`, `phone`, `email`, `linkedinUrl`, `linkedinDisplay`,
`githubUrl`, `githubDisplay` — all static fields the app already knows. Wastes
tokens, introduces drift risk (model might alter formatting).

**Fix:** Remove these from schema. No new injection function needed —
`applyProfileOverrides()` (line 1121) and `applyCoverLetterOverrides()` (line 1156)
already overwrite these fields from `ENV_PROFILE` after model returns. Just remove
the fields from schema; existing overrides handle the rest.

### Issue 3: ATS keyword hallucination

**Problem:** Model adds keywords not in JD (e.g., "opengl", "graphics programming",
"machine learning") even though prompt says "extract from JD."

**Fix:** Two-pronged:
1. **Prompt hardening:** Add explicit instruction: "Only include keywords
   verbatim present in the job description text. Do not infer or add related terms."
2. **Post-processing validation:** After model returns `atsKeywords`, filter
   against JD text. Keep only keywords that appear (case-insensitive) in the
   original JD. This catches drift even if prompt instruction is ignored.

```typescript
function filterATSKeywords(keywords: string[], jdText: string): string[] {
  const jdLower = jdText.toLowerCase();
  return keywords.filter(kw => jdLower.includes(kw.toLowerCase()));
}
```

## Scope

### In scope (this fix)
- Issue 2: Remove static fields from schema (existing `applyProfileOverrides()` handles injection)
- Issue 3: Prompt hardening + post-processing filter for ATS keywords
- Issue 1 (partial): Remove `oneOf` from `bodyParagraph`, force array

### Out of scope
- Issue 1 (full): Instruction overload from multiple skill prompts (ponytail,
  caveman, GSD, AGENTS.md). This is a prompt infrastructure problem — the
  system prompt is polluted with personality instructions that compete with
  the resume generation task. Separate fix needed for prompt isolation.
- Schema validation at runtime (add JSON schema validation on the returned
  structured output to catch type mismatches before processing)

## Implementation Plan

1. **Schema cleanup** (`services/ai.ts`)
   - Remove static fields from RESUME_JSON_SCHEMA and COMBINED_JSON_SCHEMA
   - Remove static fields from COVER_LETTER_JSON_SCHEMA
   - Force `bodyParagraph` to array-only
   - Update `required` arrays
   - Fix validation: changed from checking `resume.name` to `resume.summary`

2. **ATS keyword filtering** (`services/ai.ts`)
   - Add `filterATSKeywords()` function (exported for testing)
   - Apply at atsKeywords extraction point in `generateCombinedJSON()`
   - Updated prompt to say "verbatim from JD only"

3. **Tests**
   - `ai.coverLetter.test.ts` and `ai.parseJson.test.ts` needed no changes
     (tests don't reference removed schema fields)
   - Created `ai.filterATS.test.ts` with 5 test cases

## Files modified

- `services/ai.ts` — schema definitions, validation fix, keyword filter
- `prompts/combined-system-prompt.txt` — ATS keyword instruction (gitignored,
  dual-commit to parent repo, required `git add -f` in parent)
- `docs/plans/STRUCTURED_OUTPUT_FAILURE_PLAN.md` — this file
- `services/ai.filterATS.test.ts` — new test file for filterATSKeywords

## Execution notes

- Prompt commit in parent monorepo (`$HOME/src/copilot/`) required `git add -f`
  because `resume-opencode/` is gitignored there. The `.gitignore` rule is
  intentional (see `docs/IGNORED_FILES.md`) — force-add is correct for
  tracked content within gitignored directories.
- `filterATSKeywords` uses substring matching (not word-boundary). Edge case:
  "react" matches "reaction". Accepted as rare enough — upgrade to regex
  `\b${kw}\b` if false positives surface in production.
