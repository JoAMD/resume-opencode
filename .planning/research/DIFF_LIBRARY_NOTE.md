# Targeted Research — Diff Library for Resume JSON Diff Viewer

**Scope:** Per milestone decision, this is the only research dimension the milestone requires. Stack/Features/Architecture/Pitfalls are intentionally skipped — the codebase map already covers them, and the milestone's surface area is small.

**Date:** 2026-07-18

---

## Question

For `RESUME_DIFF_VIEWER_PLAN.md` Step 1 (`unifiedDiffText` in `services/diffUtil.ts`):
- Is `node:diff` a real, available built-in on the project's target Node?
- If not, what's the best fallback?

---

## Findings

### `node:diff` is NOT a Node.js built-in

- The plan's assumption (`require('node:diff')` returns truthy on Node 22+) is **incorrect**. `node:diff` was proposed (see `nodejs/node` discussion) but has **not** landed in any released Node major as of Node 26.5.0 (latest LTS line as of analysis) or Node 23.7.0 (the developer's local runtime).
- Verified locally:
  ```
  $ node -v
  v23.7.0
  $ node -e "require('node:diff')"
  Error: No such built-in module: node:diff
  ```
- The official Node API documentation index (`https://nodejs.org/api/`) does not list a `diff.html` page. Confirmed by HTTP 404 on `https://nodejs.org/api/diff.html`.
- **Conclusion:** The plan's opportunistic guard is effectively always-false. The "fallback" path is the **only** viable path on every currently-supported Node version.

### Implementation path for `unifiedDiffText`

The plan's stated fallback is a ~30-line "common prefix + change block" implementation — explicitly **not** LCS. This is appropriate for the input size:

- A `structured-output.json` for this project is ~10–30 KB pretty-printed (per the plan's own analysis).
- An LCS (Myers) implementation is ~80–120 lines, requires careful unit-test coverage, and is overkill for text where the user is scanning for what changed, not for the mathematically minimal diff.
- A "common prefix + change block" approach:
  1. Pretty-print both sides with `JSON.stringify(parsed, null, 2)`.
  2. Split each into lines.
  3. Find the longest common prefix and longest common suffix.
  4. Emit a unified-diff-style output:
     ```
     --- backup (v1)
     +++ current
     @@ -<startA>,<lenA> +<startB>,<lenB> @@
      unchanged line
     -removed line
     +added line
     ```
  5. If both files are identical after canonicalization, return `''`.

  This produces output that **looks like** `diff -u` output and is fully readable in the modal. It will not be byte-identical to GNU diff for deeply interleaved changes, but for resume JSONs (which differ by whole-key insertions/removals and a handful of bullet swaps) it is indistinguishable from a full LCS result.

### `summariseJsonDiff` — the path list

The plan calls for a recursive walk over the parsed values, collecting dot/bracket paths. This is independent of any diff library:

```ts
function summariseJsonDiff(a: unknown, b: unknown, prefix = ''): Summary {
  // returns { changedPaths, addedKeys, removedKeys }
  // - both objects: recurse into shared keys, recurse-on-collect for each
  //   present-in-one-only key
  // - both arrays: treat as scalars for v1 (or recurse with index paths)
  // - leaf mismatch: prefix is a "changed" path
  // - one side missing: prefix is "added" or "removed"
}
```

Path format: `experience.0.bullets.1` (dot for object keys, dot-digit for array indices). The plan's example response uses exactly this format. ~25 lines of code, no external library.

### `canonicalize` and `resumesAreEqual`

These already exist at `services/fixSuggestionsService.ts:63-76`. The plan's Step 1.1 is a pure relocation into `services/diffUtil.ts` with no behaviour change. No library research needed.

---

## Implications for Roadmap

1. **The plan's Step 1.1 implementation guidance must be updated** to drop the `node:diff` probe and start with the local fallback. Without this change, `unifiedDiffText` will be a no-op on every currently-supported Node.
2. **No new dependencies are required** (per the original project constraint). The diff library choice is being revisited; `diff` npm is the preferred option if a library is used.
3. **Code Health considerations:** the local `unifiedDiffText` implementation should be paired with tests that cover:
   - Identical inputs → `''`
   - Single-key added → output contains the new key
   - Single-key removed → output marks it removed
   - Nested change → path is preserved in the `summary.changedPaths`
   - Large files (~30 KB) → completes in <50 ms (no surprises; pure string ops)
4. **JSPath / `jsonpath` libraries** were considered for `summariseJsonDiff` and rejected. Hand-rolled path strings (dot + index) are sufficient — no library gives more value than ~25 lines of recursion.

---

## Recommendation

Proceed with the plan as scoped, with this single change: **always** use the local fallback for `unifiedDiffText`. Do not bother probing for `node:diff`. Capture this as a note in the plan's "Refactor notes" section during plan-phase refinement.

---

*Targeted research complete: 2026-07-18. Consumed by: Phase 1 (Resume JSON diff viewer) plan-phase.*
