# Debug: Diff Modal Too Narrow for Path Summary

**UAT gap:** G-01-3
**Phase:** 01-resume-json-diff-viewer
**Investigated:** 2026-07-18

## Symptom

The modal shows a human-readable summary list of changed paths, but the modal isn't wide enough — entries like `experience.0.bullets.0` are cramped/too narrow.

## Root Cause

**File:** `public/style.css` line 319

```css
.popover-body {
  /* ... */
  width: 90%;
  max-width: 420px;  /* ← shared by ALL popovers including diff modal */
}
```

The `.popover-body` CSS class is shared between the file info popover and the diff modal. The file popover works fine because it shows short filenames in a vertical list. But the diff modal uses a `2fr:1fr` grid for the diff+summary columns, so the summary column gets at most ~1/3 of 420px:

- 420px − 2×1rem padding = ~404px
- − 0.5rem grid gap = ~400px
- Summary column (1/3) ≈ 126px after padding

Path strings like `experience.0.bullets.0` need more horizontal room than 126px provides.

## Files to Modify

| File | Change |
|------|--------|
| `public/style.css` | Add wider `max-width` override for `#suggestions-diff-modal .popover-body` (e.g. 600-640px) |

## Suggested Fix

Add to the diff modal CSS section (after line 470):

```css
#suggestions-diff-modal .popover-body {
  max-width: 640px;
}
```

Or a more targeted 3:2 column split:

```css
#suggestions-diff-modal .popover-body {
  max-width: 640px;
}
#suggestions-diff-modal .popover-body .diff-body {
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
}
```
