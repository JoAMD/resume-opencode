# Add Structured JSON Logging

## Problem

All logs go to plain-text `.log` files. No way to query failure patterns, frequencies, or trends. Need structured output for `jq`, Datadog, Grafana.

## Approach

Keep existing plain-text logs for humans. Add JSONL append to `log()` and `logError()`. Every event becomes queryable. Zero new call sites.

## Fix

### Step 1: Add `appendJsonl` helper

**File:** `services/logger.ts`

```ts
import fs from 'fs';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');

function appendJsonl(entry: Record<string, unknown>): void {
  try {
    const line = JSON.stringify(entry) + '\n';
    const today = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(path.join(LOG_DIR, `server-${today}.jsonl`), line);
  } catch { /* swallow — logging must not crash */ }
}
```

One function. Appends to `logs/server-YYYY-MM-DD.jsonl`. Same daily rotation as existing `.log` files. Errors swallowed — logging must never crash the app.

### Step 2: Modify `log()` and `logError()`

**File:** `services/logger.ts`

```ts
export function log(...args: unknown[]): void {
  const line = formatLogLine(args);
  console.log(line);
  appendJsonl({ ts: new Date().toISOString(), level: 'info', msg: line });
}

export function logError(...args: unknown[]): void {
  const line = formatLogLine(args);
  console.error(line);
  appendJsonl({ ts: new Date().toISOString(), level: 'error', msg: line });
}
```

Same structure as existing. No call-site changes. Every log event auto-captured.

### Step 3: Add `.jsonl` to `.gitignore`

**File:** `.gitignore`

Add `logs/*.jsonl` — same treatment as `.log` files.

## Files Changed

- `services/logger.ts` — 1 new function + 2 one-line edits
- `.gitignore` — 1 line

## Queries

```sh
# Top error patterns
jq -r 'select(.level=="error") | .msg' logs/server-2026-08-06.jsonl | cut -d: -f1 | sort | uniq -c | sort -rn

# ATS failures
jq 'select(.msg | test("ATS"))' logs/server-*.jsonl

# Daily error count
for f in logs/server-*.jsonl; do echo "$(jq -r '.ts[:10]' "$f" | head -1) $(wc -l < "$f")"; done

# All failures with context
jq -c 'select(.level=="error")' logs/server-*.jsonl
```

## Out of Scope

- Winston / Datadog / Grafana — swap transport later, format stays same
- Pre-tagged failure types — discover from structured data instead
- Metrics / counters — `jq` gives counts, no runtime overhead
