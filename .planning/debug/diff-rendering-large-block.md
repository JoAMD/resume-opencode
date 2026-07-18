# Debug: Diff Renders as One Big Block, No Colors

**UAT gap:** G-01-2
**Phase:** 01-resume-json-diff-viewer
**Investigated:** 2026-07-18

## Symptom

Modal opens and shows a unified diff, but it dumps the whole resume as a single big changed block instead of 3 small focused hunks. In vscode the same change is 3 small focused blocks with exact changed words highlighted. No red or green colour on added/removed lines.

## Root Causes

### RC-1: Naive single-hunk algorithm in `unifiedDiffText`

**File:** `services/diffUtil.ts` lines 39–53

```typescript
function unifiedDiffText(a: string, b: string, labelA: string, labelB: string): string {
  if (a === b) return '';
  const pair: LinePair = { before: a.split('\n'), after: b.split('\n') };
  const prefix = countCommonPrefix(pair);   // longest common prefix
  const suffix = countCommonSuffix(pair, prefix);  // longest common suffix
  const beforeMiddle = pair.before.slice(prefix, pair.before.length - suffix);
  const afterMiddle = pair.after.slice(prefix, pair.after.length - suffix);
  // emits ONE hunk covering everything between prefix and suffix
}
```

The algorithm finds only the common prefix and suffix, then emits everything in between as ONE changed block. When a resume has changes in `summary`, `skills.tools`, `experience[0].bullets[0]`, and `projects[2].bullets[4]`, they all appear in one massive middle block.

vscode/git diff uses the Myers LCS algorithm which identifies all disjoint changed regions independently and emits separate `@@` hunks for each, with ~3 lines of context around each hunk.

**Fix:** Replace the naive single-hunk approach with an LCS-based multi-hunk algorithm that:
1. Computes line-by-line LCS to find all changed line ranges
2. Emits separate hunks for each maximal contiguous changed region
3. Includes ~3 context lines around each hunk

### RC-2: `.textContent` in `renderDiffResponse` prevents color rendering

**File:** `public/suggestions.js`

```javascript
function renderDiffResponse(data) {
  diffPre.textContent = data.unifiedDiff || '(no diff)';  // ← plain text
  // ...
}
```

`.textContent` renders everything as literal text — HTML like `<span class="diff-removed">` would appear as `&lt;span&gt;` on screen. So even if we added color markup to the diff string, it couldn't render as colored HTML.

### RC-3: No CSS rules for diff colors

**File:** `public/style.css`

The `.diff-pre` class has no rules for added/removed lines. Even if `.innerHTML` were used, there are no CSS classes to color the spans.

## Files to Modify

| File | Change |
|------|--------|
| `services/diffUtil.ts` | Rewrite `unifiedDiffText` as multi-hunk LCS algorithm |
| `public/suggestions.js` | Switch `renderDiffResponse` from `.textContent` to `.innerHTML` with color-span wrapping |
| `public/style.css` | Add `.diff-removed`, `.diff-added`, `.diff-context` CSS rules |

## Deferred Note

The naive algorithm was a deliberate "good enough" choice per `DIFF_LIBRARY_NOTE.md` (node:diff is not a real Node built-in). The LCS algorithm was deferred and now needs to be implemented.
