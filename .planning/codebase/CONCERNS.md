# Codebase Concerns

**Analysis Date:** 2026-07-18

## Tech Debt

### Duplicate `/api/read` Route Handlers in `server.ts`

**Issue:** Two separate `app.get('/api/read', ...)` handlers are registered in `server.ts`. The first (lines 115-137) includes the `isPathAllowed` allow-list check; the second (lines 251-266) has **no** path allow-list check and **no** auth middleware. Express uses the first registered handler, so the unsafe handler is currently dead — but it is dead-by-accident, not dead-by-design.
- Files: `server.ts:115-137` and `server.ts:251-266`
- Impact: Any future refactor that reorders, splits, or extracts the first handler into a sub-router would silently enable unauthenticated arbitrary file read of any path the server process can see. Also confusing during code review.
- Fix approach: Delete the second handler outright. There is no second client of `/api/read` that depends on the unauthenticated behavior (the public/UI surface calls the first one).

### `UI_DIST = ''` Stubbed Out

**Issue:** `const UI_DIST = '';` (line 21) is a placeholder that disables `app.use('/...', express.static(UI_DIST))` (line 58-60). The block under it is never registered but the empty-string value is never removed.
- Files: `server.ts:21`, `server.ts:57-60`
- Impact: Confusing dead branch; readers must mentally skip it. If `UI_DIST` were ever set to a string, the static serving would silently activate without further wiring.
- Fix approach: Remove the `UI_DIST` variable and the conditional `if (UI_DIST)` block; keep the `app.use(express.static(... dist))` line if intentional, or remove it if not.

### Middleware No-Op in `server.ts`

**Issue:** Lines 26-31 contain:
```ts
app.use((req, _res, next) => {
  if (req.body) {
    req.body = req.body;
  }
  next();
});
```
The conditional is a tautology that does nothing.
- Files: `server.ts:26-31`
- Impact: Dead code, adds noise; misleads readers into thinking there is a body-normalisation step.
- Fix approach: Delete the middleware entirely.

### `ADMIN_PASSWORD` Defaults to Empty String

**Issue:** `const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';` (line 19). If the env var is unset, the basic-auth check `password !== ADMIN_PASSWORD` reduces to `password !== ''`, i.e. any password (including empty) that **does not** match the empty string is rejected — but a request with the username `admin` and any password starting with a literal colon will evaluate as `password === ''` (since `credentials.split(':')[1]` is `''` when there is no colon) and bypass the check.
- Files: `server.ts:19`, `server.ts:40-52`
- Impact: Silent auth-bypass when the env var is missing. There is no fail-closed check (`if (!ADMIN_PASSWORD) return res.status(500)...`).
- Fix approach: Fail closed on startup when `ADMIN_PASSWORD` is unset, and validate the parsed `username`/`password` are non-empty before the comparison.

### `requireAdminAuth` Username Hardcoded to `admin`

**Issue:** The basic-auth middleware (`server.ts:40-52`) only accepts the username `admin`. Any other username (including blank) is rejected. There is no support for multiple users, and no rate-limiting on the admin endpoints, so a brute-force of the password is unthrottled.
- Files: `server.ts:40-52`, `server.ts:65` (`/api/config`), `server.ts:139` (`/api/edit`)
- Impact: Single-credential admin surface; brute-force-friendly. Acceptable for a local single-user tool, but a security regression if this is ever exposed to a network.
- Fix approach: Add a fail-closed check on `ADMIN_PASSWORD` length at startup; consider per-IP rate limiting if exposed beyond localhost.

### `RESUME_CHAR_LIMIT = 7784` Is a Hardcoded Magic Number

**Issue:** `export const RESUME_CHAR_LIMIT = 7784; // todo: hard-coded resume character limit for now` (line 81). The `// todo` is a known debt marker. The constant drives the trim-reprompt loop in `enforceResumeCharLimit`.
- Files: `services/ai.ts:81`
- Impact: Magic number with no documentation of how 7784 was derived (presumably one LaTeX page of body content), no env override, and no path to calibrate per-resume-type (the `qa` type ships a different template but uses the same limit).
- Fix approach: Promote to an env var (`OPENCODE_RESUME_CHAR_LIMIT`) with the current value as default; add a short comment naming the source/derivation.

### `MODELS_WITHOUT_STRUCTURED_OUTPUT` List Maintained by Hand

**Issue:** The list of models that don't support structured output is hardcoded:
```ts
const MODELS_WITHOUT_STRUCTURED_OUTPUT = [
  'qwen3.6-plus', 'qwen3.6', 'qwen3', 'qwen2.5', 'kimi-k2.6',
];
```
- Files: `services/ai.ts:268-274`
- Impact: Stale-by-construction. New model versions (e.g. a future `qwen3.7`) will silently break because `modelSupportsStructuredOutput` returns `true` (no substring match), then the SDK call falls through to the tool-call / file-poll path that was designed for these models. Tested nowhere.
- Fix approach: Drive from a single source of truth (env var, config file, or a runtime probe) and add a unit test that asserts both directions for each entry.

### Logging Uses `console.log` / `console.error` Heavily

**Issue:** Despite a `services/logger.ts` module that writes to `logs/server-*.log`, `services/ai.ts` uses raw `console.log`/`console.error` in 30+ places (lines 601, 649, 661, 677, 680, 697, 711, 712, 726, 738, 746, 759, 767, 815-821, 831, 840, 844, 850, 876, 881-886, 899, 900). Several of these carry session ids and prompt timing that are critical for diagnosing the known `HeadersTimeoutError` (see AI Prompt Timeouts section below).
- Files: `services/ai.ts:601-900` (many)
- Impact: `OPENCODE_SESSION_KEEP_PLAN.md` Step 1.2 already flags that `console.log('Session created:', ...)` and the timing lines are going to the tmux stdout and not the file logger. The same problem applies to most other `console.*` calls in `ai.ts` — they are invisible to anyone tailing `logs/server-*.log` after the tmux session scrolls.
- Fix approach: Route all structured log lines through `log()`/`logError()`. At minimum, the timing and session-id lines should land in the file logger.

### `UI_DIST` Empty String + Stale Dead Code Branches

**Issue:** Aside from `UI_DIST = ''`, several other features are scaffolded but disabled:
- `app.use(express.static(path.join(projectRoot, 'dist')));` (line 57) — the dist folder is served, but `dist/` is gitignored, so in dev the directory does not exist (Express silently serves a 404).
- The `(applied)` prefix rename logic in `routes/generate.ts:534-568` is duplicated by `services/jobDir.ts:46-54` (`renameJobDir`).
- The `loadEnv()` call pattern is duplicated (top-level `loadEnv()` in `services/ai.ts:9` and `services/atsAiService.ts:22`).
- Files: `server.ts:57`, `routes/generate.ts:539`, `services/jobDir.ts:46-54`, `services/ai.ts:9`, `services/atsAiService.ts:22`
- Impact: Mild maintenance burden; risk of the two `renameJobDir` implementations drifting.
- Fix approach: Pick one implementation, delete the duplicate, and remove the dist static line if no UI is actually built there.

### TypeScript `strict: false`

**Issue:** `tsconfig.json` has `"strict": false`. Many `any` types are scattered through the codebase (230+ matches across services/routes).
- Files: `tsconfig.json:8`, every `services/*.ts` file
- Impact: Silent null/undefined propagation, no implicit-any check, no strict null checks. The `Route` body parses and the `app.locals` and `req.body` casts are unchecked.
- Fix approach: Turn on `"strict": true` in `tsconfig.json` and incrementally tighten the worst offenders (the `any` parameters in `ai.ts:604, 621, 824, 838, 952, 992` for `client: any` are the most painful — typing `client` against the SDK's `OpencodeClient` would catch a lot of bugs).

### Synchronous `fs` and `child_process` Calls on Request Hot Path

**Issue:** Many handlers use `fs.readFileSync`, `fs.writeFileSync`, `fs.statSync`, `fs.readdirSync`, `execSync`, and `fs.copyFileSync` in Express request handlers. Example: `server.ts:88-92` (`/api/browse`) is a fully synchronous walk of the entire `JOBS_PATH` per request, including stat'ing every child.
- Files: `server.ts:80-92`, `server.ts:127-132`, `server.ts:236-244`, `routes/generate.ts:74-76`, `routes/generate.ts:725-732`, `routes/generate.ts:1067-1070` (sync `execSync` for `pdflatex` in `compileAllTexInDir`)
- Impact: Blocks the event loop. A large `jobs/` directory (the repo has ~100+ entries) makes `/api/browse` and `/api/files` slow under concurrent load. The `execSync` in `compileAllTexInDir` runs LaTeX with a 50 MB buffer, so one stuck compile can pin the server.
- Fix approach: Convert to `fs.promises.*`, and the LaTeX path to a queue with a per-job timeout and a hard cap on concurrent compiles.

### `pdflatex` Shelled Out via `execSync` with String Interpolation

**Issue:** `routes/generate.ts:1067-1070`:
```ts
execSync(
  `cd "${path.dirname(texPath)}" && pdflatex -interaction=nonstopmode "${texPath}"`,
  { maxBuffer: 50 * 1024 * 1024 }
);
```
The `texPath` is derived from `folderPath` input. `path.dirname` and `texPath` are not validated, only resolved to a path.
- Files: `routes/generate.ts:1067-1070`
- Impact: Classic shell-injection risk if a `texPath` ever contains a `"` or back-tick. The `compilePDFViaTectonic` and `compilePDFViaPdflatex` paths in `services/texCompiler.ts:24-65` already use `execFileSync` and `spawnSync` with arg arrays — this is the lone exception.
- Fix approach: Use `execFileSync('pdflatex', ['-interaction=nonstopmode', texPath], { cwd: path.dirname(texPath), ... })` matching the `texCompiler.ts` pattern.

### Stale Diagnostic Files at Repo Root

**Issue:** Three untracked files in the repo root carry sensitive debugging information:
- `resume-opencode-headers-timeout-again.txt` (3.3 KB) — full stack trace and session id leak
- `opencode-continue.txt` (519 B) — tmux session id (`ses_12147a368ffeJ1Gval5LqC7Zyp`)
- `interview-star-stories.md` (18.1 KB) — personally-identifiable interview content
- Files: repo root
- Impact: Repo clutter; the timeout log and tmux session id are operational artifacts. The interview content appears to be a personal/HR document that has no business being untracked at the repo root.
- Fix approach: Move all three to `docs/diagnostics/` (or delete) and add to `.gitignore` for any future re-creations.

### `scripts/copy-of-opencode-resume-tmux-startup.sh`

**Issue:** A literal "copy-of" file sits in `scripts/`. Both startup scripts have `<tailscale-ip>` / hard-coded IP `100.68.164.48` literals.
- Files: `scripts/copy-of-opencode-resume-tmux-startup.sh`, `scripts/opencode-resume-tmux-startup.sh`
- Impact: Stale, duplicated, and embeds a personal Tailscale IP. Not committed? Actually `ls` shows it as tracked; needs removal or templating.
- Fix approach: Delete the "copy-of" file, parameterize the IP via env.

### `templates` Is a Symlink to a Sibling Repo

**Issue:** `templates -> ../resume-tool/templates` (and `_parent_jobs`, `_prev_jobs` are symlinks visible in `ls`). A symlinked templates directory means the runtime is reading files from outside the repo's tracked tree.
- Files: repo-root `templates/`
- Impact: Changes to the sibling repo silently change the rendered output. The `docs/IGNORED_FILES.md` says prompts and templates are gitignored on purpose and synced via symlink — so the symlink is intentional, but the *runtime* failure mode (broken symlink at startup, the user moved their checkout) is unhandled.
- Fix approach: Add a startup check that `templates/` and `prompts/` are readable; if `fs.existsSync(path.join(PROMPTS_DIR, 'resume-system-prompt.txt'))` is false at boot, log a clear error and refuse to start.

### Unhandled `links.txt` Inconsistency in `applications.csv`

**Issue:** `services/applications.ts:225-227` writes the link to `link.txt` in the job folder, but `applications.csv` stores the link in a column too. The two can drift if the CSV is hand-edited. There is no consistency check.
- Files: `services/applications.ts:225-227`, `routes/generate.ts:292-294`
- Impact: Low (the CSV is the source of truth for the duplicate guard; `link.txt` is the artifact for the job folder). The drift is a documentation hazard, not a bug.
- Fix approach: Document explicitly which is canonical (CSV); add a one-line check that warns when the two disagree.

---

## Known Bugs

### 5-minute `HeadersTimeoutError` on `client.session.prompt` (Intermittent)

**Symptom:** A `client.session.prompt` call has no upper bound in some code paths; when the upstream OpenCode server stalls before sending headers, undici trips its `headersTimeout` and the error bubbles up opaque and unactionable. Reproduced in production on 2026-06-23 with the trace captured in `resume-opencode-headers-timeout-again.txt`.
- Files: `services/ai.ts:824-855` (now wrapped in an `AbortController`, but the 5-min `UND_ERR_HEADERS_TIMEOUT` from undici's own default is still the primary failure shape when our timeout is set high), `services/ai.ts:78` (`AI_PROMPT_TIMEOUT_MS` default 600000 ms = 10 min)
- Trigger: Slow or stalled OpenCode server, often correlated with many concurrent or recent prompt completions (Option B in `AI_PROMPT_TIMEOUT_PLAN.md` documented this as a leak hypothesis that the v2 plan reversal later weakened).
- Workaround: A new debug endpoint `POST /generate/debug/slow-prompt` (gated by `ENABLE_DEBUG_ROUTES=true`) was added to reproduce. The new timing logs tell you which timer fired. Option C (SSE stream) is deferred.
- Open work: Per `AI_PROMPT_TIMEOUT_PLAN.md` Option C: switch from blocking `session.prompt` to `session.prompt.sse(...)` to eliminate `headersTimeout` entirely. Significant refactor; not done.

### Stale `opencodeClient` Reference in Background Tasks

**Symptom:** `getOpencodeClient()` rotates the client when `opencodeClientRequestCount >= OPENCODE_CLIENT_ROTATE_AFTER` (default 50). Between rotation and the in-flight task completing, the `client` variable captured in the outer scope (`runOpenCodePipeline`) becomes stale. A background task started with client N might have its `finally` block attempt `client.session.delete` against client N+1, which has no knowledge of session N's sessions.
- Files: `services/ai.ts:52-73` (rotation), `services/ai.ts:964-989` (`runOpenCodePipeline` finally)
- Trigger: Any prompt that takes longer than 50 other prompts' worth of time to complete (rotation happens between request 1 and request 50; a stuck prompt from request 1 may finally-block against a client that has been nulled).
- Workaround: The `client` reference is captured in `runOpenCodePipeline`'s closure (`let client: any = null;` then `client = await getOpencodeClient();`), so the captured reference is to the rotated client. The finally block uses the captured `client`, not the next call's. Re-read: this is actually safe. **Re-checking — the closure captures `client` from `await getOpencodeClient()`, so the `finally` block uses the same reference. Likely a false alarm; the rotation in `getOpencodeClient` does not null captured references.** No bug.
- Status: Investigated, not a bug.

### `extractResumeSearchText` Drops `githubUrl` / `githubDisplay`

**Symptom:** `services/ai.ts:1333-1355` builds the resume search text but does not include `githubUrl` or `githubDisplay`. The regex ATS analyser therefore can't match a JD keyword against a GitHub URL in the resume.
- Files: `services/ai.ts:1333-1355`
- Trigger: When the resume has GitHub URLs and the JD mentions them as keywords.
- Workaround: None.
- Status: Not a hot bug because `githubUrl`/`githubDisplay` are not in the JSON schema's required fields and most resumes don't carry them, but it's a quiet coverage gap.

### `getJobsDir` Caches at Module Load

**Symptom:** `services/jobDir.ts:13-16` calls `findProjectRoot(__dirname)` and computes `jobsDir` once at module load. If `process.env.JOBS_PATH` is changed at runtime (the server has a `POST /api/config` route that mutates the global `JOBS_PATH`), the cached value is stale.
- Files: `services/jobDir.ts:13-16`, `server.ts:22` and `server.ts:65-75`
- Trigger: User POSTs to `/api/config` to change `JOBS_PATH` mid-session. The server-side `server.ts` global updates, but `services/jobDir.ts`'s cached value does not.
- Workaround: `routes/generate.ts:25-26` independently computes `path.join(projectRoot, 'jobs')` from `findProjectRoot(__dirname)`, so the generate router is unaffected. The bug bites only ATS analysis and other consumers of `jobDir.ts`'s `getJobsDir`.
- Status: Latent bug; the admin can change `JOBS_PATH` and several endpoints will silently keep using the original.

### `services/ai.ts:1422` Doubles `replace('{{EDUCATION_1}}', ...)` 

**Symptom:** `services/ai.ts:1421-1431` (in `buildPrivacySafeBaseResumeForExternalModel`) replaces `{{EDUCATION_1}}` and `{{EDUCATION_2}}` — but the AI templates use `{{EDUCATION_ENTRIES}}` (see `services/latex.ts:156`). The `EDUCATION_1` / `EDUCATION_2` placeholders are not in the active LaTeX template.
- Files: `services/ai.ts:1419-1432`
- Trigger: `buildPrivacySafeBaseResumeForExternalModel` is the function that produces the userContent for the cover-letter call. The misnamed placeholders are silently left in the rendered resume text that goes to the model, but `buildBaseResume` (`services/ai.ts:504-517`) — used by the resume and combined prompts — has all its `replace(...)` calls commented out and returns the unprocessed template.
- Workaround: None.
- Status: Latent bug. The function `buildBaseResume` returns a template with `{{FULL_NAME}}`, `{{PHONE}}`, `{{EMAIL}}`, etc. unsubstituted (the `.replace` chain is fully commented out, lines 510-516). The model receives a resume with literal `{{PHONE}}` placeholders. This is the "your phone number is literally `{{PHONE}}`" bug — model typically guesses but it's a content-leak risk (the model's guess at what `{{PHONE}}` means is the actual phone number sent in the next turn).

### `applyProfileOverrides` Always Overwrites with Env Profile

**Symptom:** `services/ai.ts:1027-1041`:
```ts
function applyProfileOverrides(json: any): ResumeData {
  const updated = { ...json };
  updated.name = ENV_PROFILE.fullName;
  updated.email = ENV_PROFILE.email;
  updated.phone = ENV_PROFILE.phone;
  updated.linkedinUrl = ENV_PROFILE.linkedinUrl;
  updated.linkedinDisplay = ENV_PROFILE.linkedinDisplay;
  ...
}
```
Whatever the model returned for those fields is overwritten. The model is being told to "tailor" the resume but cannot actually change the candidate's name/email/phone/LinkedIn. This is intentional (a privacy/control feature) but conflicts with the prompt's instruction to "include tailored contact info."
- Files: `services/ai.ts:1027-1041`, `services/ai.ts:1060-1091` (same pattern for cover letter)
- Impact: Misleading prompt vs. code; user sees the model appear to "decide" a phone number that's actually a hardcoded constant.
- Workaround: None.
- Status: Documented-as-intentional but a real semantic gap.

### `findProjectRoot` Walks Indefinitely

**Symptom:** `services/paths.ts:1-18`:
```ts
while (true) {
  if (fs.existsSync(path.join(current, 'package.json'))) return current;
  const parent = path.dirname(current);
  if (parent === current) return path.resolve(startDir);
  current = parent;
}
```
If the user accidentally runs the server from `/` (or any directory where no ancestor has a `package.json`), it walks all the way to `/`, hits the `parent === current` guard, and returns `startDir` — which is the same path the server was started from, so every `findProjectRoot(__dirname)` in services computes a different result.
- Files: `services/paths.ts:1-18`
- Trigger: Unusual setups; the symlinked `templates` directory could mask the `package.json` walking.
- Status: Edge case; low risk in practice.

### `services/ai.ts:1067-1070` `execSync` String-Interpolated Shell Command

**Symptom:** (See also Tech Debt.) If a malicious or hand-crafted `texPath` reaches `compileAllTexInDir`, the `cd "${path.dirname(texPath)}" && pdflatex -interaction=nonstopmode "${texPath}"` line is a classic shell injection.
- Files: `routes/generate.ts:1067-1070`
- Trigger: An attacker with write access to `jobs/` plants a `*.tex` file with a back-tick or `"; rm -rf ~ #`-style path.
- Workaround: None.
- Status: Reachable only by local authenticated admin (`requireAdminAuth` on `/api/edit` lets an admin plant a `.tex` of their own, but the only caller is the local single user). Severity: low for the current trust model, high if this ever faces the network.

---

## Security Considerations

### Admin Auth is Optional in Practice

**Risk:** `ADMIN_PASSWORD` defaults to `''` (see Tech Debt). A user running `npm start` without setting `ADMIN_PASSWORD` gets:
- `requireAdminAuth` on `/api/config` and `/api/edit` rejecting every non-`admin:""` request — but accepting `admin:` (no password). Wait, `credentials.split(':')` on `"admin:"` returns `["admin", ""]`, which then matches `password !== ''` is false, so it passes. The bypass is real.
- Files: `server.ts:19`, `server.ts:40-52`
- Current mitigation: README explicitly says the tool is for a local single user; no production deployment guidance.
- Recommendations: Fail closed at startup. Add a one-line check: `if (!process.env.ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD is required')` before `app.listen`.

### `/api/browse`, `/api/read`, `/api/files`, `/api/download`, `/api/stream` Are Unauthenticated

**Risk:** Only `/api/config` and `/api/edit` go through `requireAdminAuth`. The file-reading endpoints are wide open. An attacker on the same network can:
- `GET /api/browse?path=/etc` → enumerate the server's filesystem (within the realpath check that uses `realpathSync(path.dirname(JOBS_PATH))` — which only allows `JOBS_PATH` and its descendants, but `path.dirname` of `/some/leaf/jobs` is `/some/leaf`, so the check is `realpath.startsWith('/some/leaf')`, allowing `/some/leaf/jobs`, `/some/leaf/jobs/..`, etc.). Hm — `path.dirname('/some/leaf/jobs')` is `/some/leaf`, so `realRoot = '/some/leaf'` and a request to `/some/leaf/private.txt` would pass.
- `GET /api/read?path=/home/<user>/.ssh/id_rsa` (if realRoot is permissive enough) → exfiltrate the key.
- Files: `server.ts:105-113` (`isPathAllowed` — `realRoot = fs.realpathSync(path.dirname(JOBS_PATH))`; if `JOBS_PATH = /home/joel/jobs`, `realRoot = /home/joel`, allowing reads anywhere under `/home/joel/`).
- Current mitigation: Local-only deployment.
- Recommendations: Tighten `isPathAllowed` to compare against `realpathSync(JOBS_PATH)`, not `realpathSync(path.dirname(JOBS_PATH))`. Or add auth to all file endpoints.

### No HTTPS, No CORS, No Rate Limiting

**Risk:** Server runs plain HTTP. No CORS configuration means browser clients from any origin can hit it (CSRF-style: a malicious page could trigger a generation in the user's session). No rate limiting on any endpoint — a `POST /generate` is a 60-600 s AI call that a hostile client can stack.
- Files: `server.ts` (no `cors`, no `helmet`, no `express-rate-limit`)
- Current mitigation: Local-only.
- Recommendations: Add `helmet`, an explicit CORS allow-list, and at least a per-IP rate limiter on `POST /generate` if this is ever exposed beyond localhost.

### Resume PII Sent to AI Models Without Re-Encryption Boundary

**Risk:** The redacted-resume path (`services/redactResume.ts`, `services/atsAiService.ts:209-218`) is solid for the **ATS analysis** call. But:
- `generateResumeJSON` and `generateCoverLetterJSON` both include the **full** resume (including PII) in the userContent for the model. `sanitizeResumeForExternalCoverLetterModel` (`services/ai.ts:1444-1453`) exists but is only used for the cover-letter call, not the resume.
- The redaction guard is only invoked in `atsAiService.ts`; if any future code path reuses the structured resume with an AI call, PII can leak by accident.
- Files: `services/ai.ts:1189` (cover-letter call includes the redacted resume), `services/ai.ts:1139-1143` (resume generation includes the full unredacted base resume)
- Current mitigation: The base resume is loaded from the local `templates/base-resume.txt.template`; PII there is the user's own data going to the same model. The risk is "third-party model provider" not "self-hosted OpenCode."
- Recommendations: Centralize the "redact before model call" path through a single helper; have any new AI call go through it. The README and FEATURES.md claim "PII redaction before any resume is sent to an AI call that judges the resume" — that wording is narrower than the implementation, but a reader could mistake it for "any AI call."

### PII Fields Not in Schema Are Not Redacted

**Risk:** `redactResume.ts:5-13` enumerates seven PII fields (`name`, `phone`, `email`, `linkedinUrl`, `linkedinDisplay`, `githubUrl`, `githubDisplay`). The schema `services/types.ts:29-44` lists `githubUrl?` and `githubDisplay?` as optional. But the template also has `{{GITHUB_URL}}` and `{{GITHUB_DISPLAY}}` placeholders that the LaTeX builder substitutes (`services/latex.ts:149-150`).
- Files: `services/redactResume.ts:5-13`, `services/types.ts:35-36`
- Impact: If a future PII field (e.g. `address`) is added to the schema and the template, the redaction list will silently miss it.
- Recommendations: Drive the PII list from the schema or a single source of truth; add a CI check that asserts every schema string field with a PII-ish name is in `PII_FIELDS`.

### Path Allowlist Uses `path.dirname(JOBS_PATH)`

**Risk:** (See `/api/browse` above.) `isPathAllowed` allows anything under `path.dirname(JOBS_PATH)`, which is the parent of the jobs folder. Any other file in that parent is readable.
- Files: `server.ts:105-113`
- Current mitigation: Local-only.
- Recommendations: Allow only `JOBS_PATH` itself, not its parent. E.g. `realRequested.startsWith(realRoot + path.sep)`.

### Per-Endpoint `multer` File Upload Without Size Limit

**Risk:** `server.ts:33`: `const upload = multer({ dest: '/tmp/' });` — no `limits` option. An attacker POSTing to `/api/upload` can fill `/tmp` with files; each is then `fs.copyFileSync`'d to `JOBS_PATH/<originalname>` (line 196) and unlinked from `/tmp`. A 10 GB file consumes 10 GB in `JOBS_PATH`.
- Files: `server.ts:33`, `server.ts:185-203`
- Current mitigation: `isPathAllowed(targetDir)` check on `targetDir`; no `fileSize` limit.
- Recommendations: Set `multer({ dest: '/tmp/', limits: { fileSize: 10 * 1024 * 1024 } })`.

### OpenCode Server Password Stored in `scripts/.env` (Plaintext on Disk)

**Risk:** The repo-root `scripts/.env` (and any `tectonic-svc/.env` or local `server-*.log` files) carry the `OPENCODE_SERVER_PASSWORD` plus a SonarQube token (`SONARQUBE_TOKEN`) and a CodeScene access token (`CS_ACCESS_TOKEN`).
- Files: `scripts/.env:1-9`
- Current mitigation: The file is gitignored (`.gitignore:1`); the example file is checked in.
- Recommendations: This is acceptable for a local dev environment, but anyone who copies `scripts/.env` to a new machine inherits all the tokens. Consider replacing with 1Password/`direnv`-style injection.

### The OpenCode Server Has No Auth (When `OPENCODE_SERVER_PASSWORD` Is Unset)

**Risk:** `OPENCODE_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD || process.env.OPENCODE_PASSWORD || '';` (`services/ai.ts:42`). If the env var is unset, the request goes out with an `Authorization: Basic <opencode:>` header — which the server may accept as a valid empty-password client.
- Files: `services/ai.ts:42-46`
- Current mitigation: The OpenCode server is expected to be on localhost.
- Recommendations: At startup, log a warning when `OPENCODE_PASSWORD` is empty; ideally require it.

---

## Performance Bottlenecks

### `client.session.prompt` Latency Is the Dominant Cost

**Problem:** Every generation is a single 30 s – 10 min synchronous HTTP call. With `OPENCODE_AI_CONCURRENCY=1` (the default), generations are strictly serial; with `=3` (per `.env.example:41`), three can run in parallel but each one still costs the same. The `OPENCODE_AI_PROMPT_TIMEOUT_MS` is 10 min — a 10-min wall-clock wait is the worst-case UX.
- Files: `services/ai.ts:75` (`AI_CONCURRENCY`), `services/ai.ts:78` (`AI_PROMPT_TIMEOUT_MS`)
- Cause: Blocking `client.session.prompt`; no streaming (Option C in `AI_PROMPT_TIMEOUT_PLAN.md` is the fix).
- Improvement path: Switch to `session.prompt.sse(...)` so the user sees progress; refactor the trim loop to stream the candidate and bail early when the model says "short enough."

### `routes/generate.ts:1067-1070` `execSync` for `pdflatex` Blocks the Event Loop

**Problem:** `compileAllTexInDir` synchronously runs `pdflatex` per `.tex` file. With N files, the request is held for N × ~5 s on the event loop. No concurrent compile cap, no per-job timeout (the `maxBuffer: 50 MB` only protects memory).
- Files: `routes/generate.ts:1048-1070`
- Cause: Misuse of `execSync` for an inherently slow operation.
- Improvement path: Replace with a per-file `await compileTexFileAsync(...)` (or use the existing `services/texCompiler.ts:24-65` async-friendly `compilePDFViaTectonic`).

### `searchJobDescriptions` Reads Every JD File Synchronously Per Request

**Problem:** `services/jobDescriptionSearch.ts:113` does `fs.readFileSync` for every `job-description.txt` and `full-jd.txt` under `jobs/`. With ~100+ job folders (visible in `ls jobs/`), every search is a full synchronous walk of the directory tree. Search runs on the request thread.
- Files: `services/jobDescriptionSearch.ts:113`
- Cause: No caching; every request rescans.
- Improvement path: Cache the per-folder mtime + size; only re-read if changed. Move to async.

### `applications.csv` Is Read Fully Per Duplicate Check

**Problem:** `services/applications.ts:81-105` `readApplications` reads and parses the entire `applications.csv` for every duplicate check. The file is now ~8.4 KB (~100+ rows). For a single duplicate check this is fine; the issue is `appendApplication` does the same read for the dedup check before appending (line 137-140).
- Files: `services/applications.ts:81-105`, `services/applications.ts:137-140`
- Cause: No append-only index.
- Improvement path: Index the CSV in memory at startup; append-only updates.

### `taskMap` Is an Unbounded In-Memory Map

**Problem:** `routes/generate.ts:64` `const taskMap = new Map<string, TaskResult & { startedAt: number }>();` — every `POST /generate` adds a task id. There is no eviction. A long-running server accumulates tens of thousands of entries over weeks.
- Files: `routes/generate.ts:64`
- Cause: No TTL or LRU.
- Improvement path: Add an LRU cap (e.g. 1000 entries) and evict by `startedAt`.

### `paths.ts:5-18` `findProjectRoot` Walks the FS Per Call

**Problem:** `findProjectRoot(__dirname)` is called on every service module load. Because `__dirname` is the same for the lifetime of a service module, the result is identical — but each call does a `fs.existsSync` walk.
- Files: `services/paths.ts:1-18` (called from `services/ai.ts:10`, `services/applications.ts:19`, `services/jobDir.ts:14`, `services/atsAiService.ts:23`, `services/latex.ts:7`, `services/logger.ts:5`, `server.ts:20`)
- Cause: No memoization.
- Improvement path: `const PROJECT_ROOT = (() => { ... })()` module-level memo, returning the resolved project root for the current process.

---

## Fragile Areas

### `services/ai.ts` (1454 lines) Is a Monolith

**Files:** `services/ai.ts` is the largest file in the repo and the load-bearing one. It contains: prompt template loading, JSON schema definitions, the runOpenCode pipeline, the trim-reprompt loop, the AI queue, the ATS keyword analyser, the regex fallback for ATS, the body-paragraph normaliser, the profile override functions, the privacy-safe resume builder, the JSON parsing helpers, and the timing-diagnosis logic.
- Why fragile: A single change to a JSON schema field can affect the trim loop, the AI prompt, the regex search, the privacy helper, and the cover-letter generator in ways that are hard to enumerate. There is no module boundary.
- Safe modification: Add tests for every behaviour you observe (the existing `services/ai.*.test.ts` files are well-targeted). Use `pre_commit_code_health_safeguard` to catch complexity regressions.
- Test coverage gaps:
  - `runOpenCode` error path for the structured-output models when the model returns a truncated JSON.
  - `enqueueAIRequest` behaviour when `OPENCODE_AI_QUEUE=false` and `OPENCODE_AI_CONCURRENCY=3` are both set.
  - `enforceResumeCharLimit` when all `RESUME_TRIM_MAX_ATTEMPTS` attempts produce identical-sized output.
  - The privacy-safe functions: there's an `ai.privacy.test.ts` but it doesn't cover `sanitizeResumeForExternalCoverLetterModel`'s `education` mapping (which uses `DEFAULT_PROFILE.education[Math.min(index, length - 1)]` — silent fallthrough).

### `server.ts` is Mixing Concerns

**Files:** `server.ts:317` — the entire Express app lives here alongside a job-static handler, a file browser, an admin auth middleware, a duplicate route registration, an upload handler, a job listings handler, a download/stream handler, a 404 handler, and a generic error handler. No router separation, no middleware composition.
- Why fragile: Adding a new endpoint typically appends to the bottom of the file, and the global middleware order (especially `app.use((req, _res, next) => log(req.method, req.originalUrl))` at line 35) is easy to break with a small reorder.
- Safe modification: Split into `routes/jobs.ts`, `routes/admin.ts`, `routes/files.ts`, `routes/static.ts`. Keep `server.ts` as composition only.
- Test coverage gaps: There is no `server.test.ts`. The two duplicate-route handlers are not unit-tested, and the admin auth is not tested.

### `routes/generate.ts` (1247 lines) Carries Both Routing and Orchestration

**Files:** `routes/generate.ts:1247`. Routes, the in-memory task map, the job-dir creation, the generation orchestrator, the cover-letter orchestrator, the LaTeX builder caller, the PDF compiler caller, the duplicate guard, the search endpoint, the mark-applied endpoint, the ATS endpoint, the apply-suggestions endpoint, the redacted-resume helpers, the debug endpoint, and a number of CSV/IO helpers all live in the same file.
- Why fragile: A change to one of the background tasks (`(async () => { try { ... } catch ... })()` pattern at lines 299-308 and 798-831) can leak promises. The `lastGeneratedResumeJSON` / `lastGeneratedTexPath` / `lastGeneratedCoverLetterJSON` module-level globals (lines 51-53) make the file inherently non-thread-safe and confusing — a `coverLetter` request from a different user picks up the most recent `POST /generate` result.
- Safe modification: Extract the orchestrators into `services/generationPipeline.ts` and `services/coverLetterPipeline.ts`. Replace the module-level globals with a per-request context (carried on `req.locals`).
- Test coverage gaps: The `routes/generate.test.ts:503` covers some endpoints but not the module-level state corruption (e.g. two concurrent `/coverLetter` requests interleaving their `lastGeneratedResumeJSON`).

### `tectonic-svc/tectonic-server.ts` Is a Toy HTTP Server

**Files:** `tectonic-svc/tectonic-server.ts:77`. The Tectonic wrapper is a one-file Node http server with no body-size limit, no timeout client, no TLS, no concurrency cap, and no error mapping beyond `500 + stderr string`. The Dockerfile (`tectonic-svc/Dockerfile.tectonic:23`) installs Tectonic 0.15.0 from a hard-coded GitHub release tarball.
- Why fragile: A LaTeX body of unbounded size is accepted (`req.on('data', ...)` accumulates without limit). A slow Tectonic compile blocks the only event-loop thread. If the Tectonic binary URL ever changes, the build silently breaks (no SHA verification).
- Safe modification: Add a body-size cap (e.g. 1 MB), request timeout, max-compile-concurrency queue, and a pinned SHA for the Tectonic release.

### The `app.get('/api/read', ...)` Duplication Is a Footgun (See Tech Debt)

**Files:** `server.ts:115-137` and `server.ts:251-266`. Already covered above; flagged here because the second handler — currently dead but untyped and unrestricted — is a high-blast-radius mistake waiting to happen during refactor.

### The "Magic Constant" `RESUME_CHAR_LIMIT = 7784` Is Cross-Module

**Files:** `services/ai.ts:81` exports the constant, which is used in `enforceResumeCharLimit` (same file) and asserted in the trim loop. If the constant is ever bumped to a value the model can't reach in `RESUME_TRIM_MAX_ATTEMPTS`, the resume silently ships as `characterCountTrimmed: "true"` and the UI never surfaces the warning (the `RESUME_PAGE_LIMIT_UI_PLAN.md` is still a "deferred" plan).
- Why fragile: The threshold is hardcoded, the trim attempts are hardcoded, and the user-facing signal is unwired. Three places to keep in sync.
- Safe modification: Wire the UI to surface `characterCountTrimmed: "true"` per the deferred plan. Promote the constant to an env var.

### The "JSON Schemas Are Source-of-Truth Twice" Pattern

**Files:** `services/ai.ts:107-164` (`RESUME_TRIM_JSON_SCHEMA`), `services/ai.ts:293-352` (`RESUME_JSON_SCHEMA`), `services/ai.ts:354-378` (`COVER_LETTER_JSON_SCHEMA`), `services/ai.ts:380-468` (`COMBINED_JSON_SCHEMA`), `services/types.ts:29-44` (`ResumeData`). The TypeScript type and the JSON schema are declared separately, with no tool enforcing consistency. The trim schema's `characterCountTrimmed` field is duplicated manually.
- Why fragile: Adding a field to `ResumeData` requires editing both the type and at least one JSON schema, and forgetting either silently produces a different prompt structure.
- Safe modification: Generate the JSON schema from the TypeScript type (`typescript-json-schema` or `zod-to-json-schema`); keep them in lockstep.

---

## Scaling Limits

### Per-Model Concurrency Cap Is Hard-Bounded

**Current capacity:** Default 1; cap is 3 per `.env.example:41`. The model determines wall-clock cost (gpt-5-nano is fast, kimi-k2.6 may be slow), so the throughput is "N generations × model latency / time unit."
- Limit: When you have 3 long-running prompts queued and the OpenCode server has a per-client rate limit (or per-process prompt concurrency), the third prompt blocks on the upstream, and the local queue starves the next model run.
- Scaling path: Make `OPENCODE_AI_CONCURRENCY` per-model-keyed via the model name; track in-flight per model and across the OpenCode server.

### `taskMap` Is Process-Local and Unbounded (See Performance Bottlenecks)

- Current capacity: 1 process, ~no upper bound on tasks.
- Limit: Multi-process deployments (e.g. `pm2 cluster` or behind a load balancer) cannot share the task map; an instance failure orphans every in-flight task. The `startedAt` timestamp is the only freshness signal.
- Scaling path: Replace with a shared store (Redis, SQLite) or a per-process TTL'd map with `Origin` header sticky-routing.

### File System Is the Job Store

**Current capacity:** All jobs under `jobs/<slug>/` on the local filesystem. Symlinks `_parent_jobs` and `_prev_jobs` hint at an attempt to span multiple roots.
- Limit: Single-machine, single-filesystem. Cannot run on multiple machines, cannot back up incrementally without external tools, cannot be mounted read-only safely (the server writes into it on every request).
- Scaling path: A database (SQLite for single-user, Postgres for multi-user) is the obvious target. Backup is then a DB-dump problem, not an FS-sync problem.

### `jobDir.ts` Cache Staleness (See Known Bugs)

- Current capacity: N/A — it's a local-single-machine deployment.
- Limit: As soon as the user has two `JOBS_PATH` configurations and tries to switch between them, several endpoints silently use the wrong root.
- Scaling path: Make `JOBS_PATH` a per-request value (header or env override), not a global.

---

## Dependencies at Risk

### `axios` Used for a Single Call

**Package:** `axios ^1.7.2` in `package.json:16`. Used only in `services/compiler.ts:1-17` for one POST to Tectonic. The rest of the codebase uses native `fetch` (Node 18+).
- Risk: Two HTTP client abstractions, two different ways to handle timeouts, two different ways to handle errors. The `axios` path also has `timeout: 60000` which is silently incompatible with the `spawnSync` approach in `services/texCompiler.ts` (also 60 s, also default).
- Migration plan: Replace with native `fetch`; matches the rest of the codebase.

### `multer` Is Unmaintained-ish

**Package:** `multer ^1.4.5-lts.1`. The `lts.1` suffix on a 1.x line is a sign of an "LTS-only" maintenance branch. The 2.x line is in development.
- Risk: 1.x will not get new features; security patches on the LTS branch are ad-hoc.
- Migration plan: A drop-in replacement like `busboy` or `formidable` is more commonly maintained.

### `@opencode-ai/sdk` Pinned to `^1.14.31` — Moving Target

**Package:** `@opencode-ai/sdk ^1.14.31` in `package.json:14`. The OpenCode SDK is itself moving quickly; the error shapes (`cause.code === 'UND_ERR_HEADERS_TIMEOUT'`) are stable, but the response shape (`result.data?.info?.structured`, `result.data?.info?.parts`) is inferred from the SDK and not from a published type.
- Risk: A future SDK release could change the response shape and `services/ai.ts:695-769` (the `parseStructuredResult` / `parseTextResult` pair) would silently misparse.
- Migration plan: Add a thin wrapper around the SDK that asserts the response shape, so the rest of the codebase sees a typed return.

### `tectonic-0.15.0` Pinned via Curl-Install (No SHA)

**Risk:** `tectonic-svc/Dockerfile.tectonic:13-14` installs Tectonic 0.15.0 from a GitHub release tarball with no SHA256 verification. If the release is ever replaced, the build is compromised.
- Migration plan: Pin a SHA256 and verify; or pull from the distro package manager where possible.

### Node 22.x Assumed; `process.versions.node` Not Asserted

**Files:** `.nvmrc` is not present; `package.json:24` lists `@types/node ^22.10.2`. The server uses `node:internal/deps/undici/undici` (per the stack trace in `resume-opencode-headers-timeout-again.txt:18`), so undici's behaviour (e.g. the default `headersTimeout`) is Node-version-dependent.
- Risk: A future Node upgrade could change the default timeout from 5 min to something else, and the AI_PROMPT_TIMEOUT_PLAN analysis (which currently uses 5 min as a hypothesis) becomes wrong.

---

## Missing Critical Features

### No CI / No Pre-Commit Hooks

**Problem:** No `.github/workflows/`, no `husky` install, no `lint-staged`, no `pre-commit`. The `pre_commit_code_health_safeguard` MCP tool is documented in `AGENTS.md` as "mandatory before commit" but is not wired into any git hook.
- Blocks: Regressions in `RESUME_CHAR_LIMIT`, env-var defaults, and security middleware can land without anyone noticing.
- Fix: Add a minimal `pre-commit` hook that runs `npx vitest run --changed` and the CodeScene safeguard.

### No `npm audit` Run / No Vulnerability Scan

**Problem:** No `package.json` script for security scanning, no `dependabot`, no scheduled `npm audit --omit=dev` in CI. The `axios` and `multer` packages are the obvious targets.
- Blocks: Known CVEs in transitive deps (`@types/node`, `tsx`, etc.) ship without notice.
- Fix: Add `npm run audit:ci` and a Dependabot config.

### No Logging in Production Beyond File Logger

**Problem:** `services/logger.ts:1-36` is a single-process file appender. No rotation (the file just grows daily), no aggregation, no alerting on `logError`. The 30+ `console.log` calls in `services/ai.ts` don't even hit this.
- Blocks: Diagnosing the recurring 5-min timeout requires ssh-ing to the box, tailing the tmux stdout, and hoping the buffer hasn't scrolled.
- Fix: At minimum, route all `console.*` in `ai.ts` through `logger.ts`. Add `pino` or `winston` with daily rotation and a `LOG_LEVEL` env.

### `tsconfig.json` Strictness Off (See Tech Debt)

- Blocks: Many classes of bug (null pointer, undefined access, type drift) are silent. The `any` proliferation is correlated with the file size of `services/ai.ts`.

### No `Dockerfile` for the Main Server (Only Tectonic Sub-Service)

**Problem:** `tectonic-svc/Dockerfile.tectonic` exists, but there is no Dockerfile for the main Node server. Deploying requires the user to run `npm start` inside a tmux session with a sourced `.env`.
- Blocks: Multi-environment parity, easy rollback, container-based sandboxing.
- Fix: Add a top-level `Dockerfile` that runs `npm ci && npm run build && npm start` with the `.env` mounted.

### No Multi-Tenancy / Multi-User Support (By Design)

**Problem:** The tool is single-user; `jobs/` is one folder, `applications.csv` is one file, `applications.ts:readApplications()` reads everything. If two users run the server on the same host, they share the same `jobs/`.
- Blocks: Multi-user deployment. Acceptable for the current local-only use case.
- Fix: Add a per-user `JOBS_PATH` derived from auth, if ever needed.

### No Backup Strategy for `jobs/`

**Problem:** `services/backupService.ts` only creates per-job `backups/v1/`, `v2/`, ... of a single job. There is no global backup, no offsite sync, no snapshot. A disk failure loses every job folder.
- Blocks: Disaster recovery. The `dist/` directory is gitignored (no source backups either).
- Fix: At minimum, add a cron / systemd timer that rsyncs `jobs/` to a backup location. Or: a "delete job" guard that warns before destructive operations.

### No `deleteJob` or `pruneOldJobs` Endpoint

**Problem:** `services/jobDir.ts` has no delete function. There is no way for a user to remove a failed generation (e.g. one stuck because the model timed out twice). The only way to remove a folder is `rm -rf` by hand.
- Blocks: Disclipline of the `jobs/` directory; the file count keeps growing (already ~100+ entries).
- Fix: Add `POST /generate/deleteJob?jobDir=…` with a confirm step.

### UI Does Not Surface `characterCountTrimmed` Warnings (Deferred Plan)

**Problem:** `docs/plans/RESUME_PAGE_LIMIT_UI_PLAN.md` is still a draft; the UI doesn't read the `characterCountTrimmed: "true"` flag the server sets. A user who triggers a resume that the model couldn't trim will silently get an over-limit PDF.
- Blocks: User confidence in the page-limit guarantee.
- Fix: Implement the deferred plan.

---

## Test Coverage Gaps

### `server.ts` Has No Tests

**What's not tested:** The whole Express app — auth middleware, the duplicate `/api/read` handlers, the `/api/browse` allow-list, the `multer` upload, the `/api/config` admin endpoint, the global 404 / 500 handlers, the uncaughtException / unhandledRejection hooks.
- Files: `server.ts:1-317`
- Risk: Every regression in the admin surface, the file surface, or the error envelope goes undetected.
- Priority: **High** — admin and file paths are the highest-blast-radius surface in the project.

### `routes/generate.ts` Is Only Partially Tested

**What's not tested:**
- The module-level globals `lastGeneratedResumeJSON` / `lastGeneratedTexPath` / `lastGeneratedCoverLetterJSON` (`routes/generate.ts:51-53`) under concurrent requests.
- The background task `taskMap` lifecycle: what happens when a client polls `/generate/task/:id` for a task that has been evicted (no eviction, but the question is unanswered).
- The debug endpoint `POST /generate/debug/slow-prompt` is mentioned in the test runbook but is not in any test file.
- The `compileAllTexInDir` shell-injection risk (the `execSync` line) has no negative test.
- Files: `routes/generate.ts:1-1247` (test file `routes/generate.test.ts:503` covers ~40% of routes)
- Risk: Concurrent `coverLetter` requests from different users picking up the wrong `lastGeneratedResumeJSON`.
- Priority: **High** for the concurrency / global-state bugs; **Medium** for the rest.

### `services/ai.ts` Trim Loop Edge Cases

**What's not tested:**
- `enforceResumeCharLimit` when the resume is exactly at the limit (boundary case `count === RESUME_CHAR_LIMIT`).
- `enforceResumeCharLimit` when the model returns the *same* over-limit resume every time (truly stuck).
- `extractJsonFromToolCalls` when the bash `command` contains multiple JSON objects (the regex `/\{[\s\S]*\}/` is greedy and could capture a closing `}` from a string literal).
- Files: `services/ai.ts:166-216`, `services/ai.ts:668-687`
- Risk: The trim loop could enter an infinite prompt-retry (worse than the 10-min timeout) if the model returns equivalent content.
- Priority: **High** — the trim loop is in the hot path of every generation.

### `services/redactResume.ts` Edge Cases

**What's not tested:**
- What happens if the resume has a PII field that is a non-string (e.g. a `phone: { countryCode, number }` object from a model that overcomplicates)? The current `redactResumeForExternalModel` writes `''` (string) into a field that the schema declares as `string`, so the redaction silently corrupts the data shape.
- What happens if `REDACTED_RESUME_FILENAME` is symlinked to a sensitive file? `ensureRedactedResumeFile` writes the redacted content there. There is no symlink check.
- Files: `services/redactResume.ts:19-71`
- Risk: Privacy leak via mis-typed field; symlink-based attack on the redaction output.
- Priority: **High** — the redaction layer is the explicit privacy guarantee of the project.

### `services/jobDescriptionSearch.ts` Performance

**What's not tested:**
- Behaviour with 1000+ job folders. The current test file (`services/jobDescriptionSearch.test.ts:345`) uses small fixtures.
- Behaviour with a `jobs/` directory that contains non-job folders (e.g. `_parent_jobs`, `_prev_jobs`, `previous/`, `applied-other-dir/` — all visible in the `ls jobs/` output). `isJobFolder` checks for the JD file, which is correct, but the walker hits the symlinks.
- Files: `services/jobDescriptionSearch.ts:126-153`
- Risk: Walking the symlink chain could double-count folders, or take an unbounded time.
- Priority: **Medium** — affects only the search-by-description endpoint, not the duplicate guard.

### `tectonic-svc/tectonic-server.ts` Has No Tests

**What's not tested:** All of it — the request handler, the body-size cap (no cap, so trivially passes), the timeout, the cleanup path, the error path when Tectonic is missing.
- Files: `tectonic-svc/tectonic-server.ts:1-77`
- Risk: Regressions in the LaTeX path break every PDF generation silently.
- Priority: **Medium** — only reachable in the Docker-compose deployment, which is itself one-off.

### `services/atsService.ts` Untested Branch

**What's not tested:** The `atsService.ts:135` commented-out early-return; the `atsService.ts:161` commented-out `buildEmptyResult` call. The actual current flow is "always re-extract keywords from the JD via AI even if `atsKeywordsFromAI` was supplied" — which is the opposite of what the function name suggests.
- Files: `services/atsService.ts:129-162`
- Risk: The function's name suggests "use what you have, fall back to AI," but the implementation always calls the AI. The user pays an extra model call per `Run ATS Analysis` click even when they supplied the keywords.
- Priority: **Low** (the behaviour is what the file does; the bug is the comment-vs-code drift).

### Snapshot / Golden Tests for LaTeX Output

**What's not tested:** The exact LaTeX output for a given structured JSON. A model that returns `bullets: ["line 1\nline 2"]` (with a literal newline) would produce a LaTeX compile error. There is no test that pins the output format.
- Files: `services/latex.ts:133-166`
- Risk: A new model version returns multi-line bullets; LaTeX compilation fails silently, the user gets a 500 from `compilePDF`.
- Priority: **Medium**.

---

*Concerns audit: 2026-07-18*
