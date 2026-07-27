# JustHireMe MCP × resume-opencode Auto-Tailor — Plan

**Status:** Proposed
**Owner:** Joel
**Last updated:** 2026-07-27

---

## TL;DR

Wire `JustHireMe`'s Python MCP server (`backend/mcp_server.py`) into the
`resume-opencode` Express server (`server.ts`) over HTTP, so an AI agent
(or the JustHireMe auto-tailor scheduler) can ask for a tailored resume +
cover letter for any high-match lead with one MCP call. Strategy is
**A only**: bridge via `httpx` to the existing `resume-opencode` API.
**No Rust, no Tauri, no `package.json` changes on the resume-opencode side
beyond documenting the new env vars and call shapes this plan expects.**

The user has confirmed:

- Default backend: `resume-opencode` (HTTP) — Strategy A only.
- Auto-trigger location: inside the JustHireMe MCP server + a small
  cron-style caller (no apscheduler-only, no per-session agent loop).
- Default match threshold: **80%**, configurable per call.
- No built-in generator fallback.

---

## Goals

1. Let any MCP client (opencode, Claude Desktop, Cursor) call a small set
   of new MCP tools that end up producing a tailored `resume.pdf`,
   `cover-letter.pdf`, and `cover-letter.txt` inside the standard
   `jobs/<slug>/` folder of this repository.
2. Gate generation on a configurable match percentage (default 80%) so
   the tool is safe to call in a loop without producing noise.
3. Add a headless cron-style auto-tailor process in JustHireMe that polls
   its lead store, scores new leads, and triggers tailoring when the
   threshold is met.
4. Re-use **every** existing resume-opencode capability: opencode-agent
   rewriting, structured output, LaTeX compilation, ATS-AI analysis, the
   page-limit trim loop, the duplicate guard, and `applications.csv`.

## Non-goals (explicit)

- No new UI in resume-opencode. The MCP tools are not user-facing here;
  they are consumed by the JustHireMe MCP server.
- No changes to the existing metadata-based duplicate guard on
  `POST /generate` in this repo.
- No Strategy B (JustHireMe's built-in `backend/generation/generator.py`)
  bridge. That stays a separate path inside the JustHireMe app for the
  manual "open the desktop app and click generate" flow.
- No Rust / Tauri changes anywhere. The JustHireMe Tauri shell is
  orthogonal.
- No WebSocket push from resume-opencode to JustHireMe in this iteration.
  Polling only.
- No `applications.csv` schema changes.

---

## Background

### What's already in place

- `JustHireMe/backend/mcp_server.py` — stdio JSON-RPC MCP server, no
  external SDK dependency, with three tools: `score_job_fit`,
  `evaluate_lead_quality`, `extract_lead_intel`. Uses `uv`-managed
  Python 3.13 venv at `backend/.venv`.
- `JustHireMe/docs/MCP.md` and `JustHireMe/README.md` §"Agent Skill And
  MCP" — describe how to launch the MCP server and wire it into a
  client.
- `JustHireMe/skills/justhireme/SKILL.md` — agent-neutral skill for
  working inside the JustHireMe repo.
- `JustHireMe/backend/generation/generator.py` — built-in LaTeX→PDF
  tailoring (Strategy B, **out of scope** for this plan).
- `JustHireMe/backend/api/routers/scheduler.py` — existing
  scheduler-router module (kept as a reference for scheduler wiring;
  this plan adds a separate headless `auto_tailor.py`).
- `JustHireMe/backend/pyproject.toml` — already includes
  `httpx>=0.28.1` and `apscheduler>=3.11.2`.

### What's already in `resume-opencode` (this repo)

- Express server on `PORT` (default `3001`) with endpoints
  `POST /generate`, `GET /generate/task/:taskId`,
  `POST /generate/prefill`, `GET /generate/checkDuplicate`,
  `GET /generate/searchByDescription`, `GET /generate/diffResume`,
  `POST /generate/applySuggestions`, and the
  `jobs/applications.csv` reader.
- `jobs/<slug>/` folder layout with `resume.pdf`, `cover-letter.pdf`,
  `cover-letter.txt`, `ats-analysis.md`, `structured-output.json`,
  `permalink.txt`, etc.
- The metadata-based duplicate guard on `POST /generate`.
- The per-model AI concurrency queue and 10-minute prompt timeout.

### The gap

The JustHireMe MCP server can score and quality-gate leads but has zero
resume-generation tools. Without a bridge, an agent (or a scheduler)
that wants to actually produce a tailored PDF + cover letter for a
high-match lead has to either open the JustHireMe desktop app or call
`resume-opencode` directly. Neither is MCP-shaped, and the desktop app
is local-only.

This plan closes that gap by adding MCP tools that proxy into
`resume-opencode` over HTTP, gated on a configurable match percentage.

---

## Architecture

```
opencode agent / Claude Desktop / Cursor
        │  (JSON-RPC over stdio)
        ▼
JustHireMe/backend/mcp_server.py
        │
        ├─► JustHireMe/backend/mcp_tailoring.py  (helpers)
        │       │
        │       └─► JustHireMe/backend/resume_opencode_client.py
        │               │
        │               └─► httpx ──► resume-opencode Express (PORT, default 3001)
        │                                │
        │                                ├─ POST /generate            (start)
        │                                ├─ GET  /generate/task/:id   (poll)
        │                                ├─ GET  /generate/checkDuplicate
        │                                ├─ GET  /generate/prefill?folderPath=…
        │                                └─ GET  /generate/searchByDescription
        │
        └─► JustHireMe/backend/scheduler/auto_tailor.py
                (apscheduler async loop, gated on AUTO_TAILOR_ENABLED)
                │
                └─ reads JustHireMe lead store
                   calls score_job_fit (in-process)
                   if match_pct ≥ AUTO_TAILOR_MIN_MATCH_PCT
                       calls tailor_resume_for_lead (MCP-style helper)
```

---

## Phase 0 — Pre-flight (no new code)

1. From `JustHireMe/`:
   ```bash
   cd backend && uv sync --dev
   ```
2. Smoke-test the existing MCP server with a one-line JSON-RPC echo
   against `initialize` and `tools/list`.
3. Start `resume-opencode` in a separate terminal:
   ```bash
   cd /home/joel/Documents/JobStuff/copilot-adf/resume-opencode
   npm run dev
   ```
4. Run existing tests:
   ```bash
   cd JustHireMe/backend && .venv/bin/python -m pytest tests/test_mcp_server.py
   ```
5. Verify the score scale of
   `JustHireMe/backend/ranking/evaluator.score` — confirm whether
   `score_job_fit` returns `score` as 0–1 or 0–100, so the threshold
   adapter is unambiguous. (Likely 0–100; confirm before writing the
   client.)

Exit criteria: existing 3 MCP tools respond, `resume-opencode` serves a
known endpoint, score scale is confirmed.

---

## Phase 1 — `resume_opencode_client.py` (JustHireMe side)

**New file:** `JustHireMe/backend/resume_opencode_client.py`

A small async `httpx.AsyncClient` wrapper. Base URL from env
`RESUME_OPENCODE_URL` (default `http://localhost:3001`). 10s connect
timeout, 600s read timeout (mirrors the existing
`OPENCODE_AI_PROMPT_TIMEOUT_MS` of 10 min).

Public surface:

```python
class ResumeOpenCodeClient:
    def __init__(self, base_url: str, *, timeout: float = 600.0): ...
    async def __aenter__(self) -> "ResumeOpenCodeClient": ...
    async def __aexit__(self, *exc): ...

    async def start_generate(
        self,
        *,
        posting: str,
        company: str | None = None,
        role: str | None = None,
        link: str | None = None,
        extra_notes: str = "",
        cover_output: str = "both",   # 'pdf' | 'txt' | 'both' | 'none'
        model: str | None = None,
        force: bool = False,
    ) -> dict: ...  # { task_id, slug, duplicate?: {...} }

    async def poll_task(self, task_id: str) -> dict: ...
    # { status, step, stepLabel, ... } from GET /generate/task/:taskId

    async def get_permalink(self, slug: str) -> dict:
        # reads <jobs>/<slug>/permalink.txt via GET /jobs/<slug>/permalink.txt
        ...
    async def check_duplicate(
        self,
        *,
        link: str | None = None,
        company: str | None = None,
        role: str | None = None,
    ) -> dict: ...  # mirrors GET /generate/checkDuplicate

    async def list_recent_applications(self, limit: int = 20) -> list[dict]:
        # parses jobs/applications.csv via GET /generate/searchByDescription?…
        # OR a dedicated listing if we add one — see "resume-opencode side"
        # below.
        ...
```

Singleton accessor: `get_client() -> ResumeOpenCodeClient` (lazy init,
per-event-loop, closable on MCP server shutdown).

Error mapping:
- `4xx` → `ResumeOpenCodeClientError(status, body)` with the response
  body decoded (so duplicate-guard `409` responses are still surfaced
  to the MCP tool with their `matchedBy` / `partialMatch` fields
  intact).
- `5xx` and `httpx.TransportError` → `ResumeOpenCodeClientUnavailable`
  with the cause.

**New file:** `JustHireMe/backend/tests/test_resume_opencode_client.py`

- Uses `httpx.MockTransport` to cover all 5 methods.
- Asserts: happy paths return the expected shape; 4xx bodies are
  surfaced verbatim in the exception; 5xx raises
  `ResumeOpenCodeClientUnavailable`; transport errors bubble up as
  `httpx.TransportError` (not swallowed).

---

## Phase 2 — New MCP tools (JustHireMe side)

Extend `JustHireMe/backend/mcp_server.py`. Add to `TOOL_DEFINITIONS`
and `TOOLS`:

| Tool | Args | Behavior |
|---|---|---|
| `tailor_resume_for_lead` | `{ job_id: string, min_match_pct?: int = 80, force?: bool = false, cover_letter?: bool = true, model?: string }` | Loads the lead (in-process from the lead repo), runs `score_job_fit(posting, candidate)` internally, gates on `match_pct ≥ min_match_pct` (or `force=true`), calls `check_duplicate` (unless `force=true`), then `start_generate` + `poll_task` until terminal status, then `get_permalink`. Returns `{ tailored: true, match_pct, task_id, slug, permalink, files }` or `{ tailored: false, reason, match_pct, duplicate? }`. |
| `tailor_resume_from_text` | `{ posting: string, candidate: object, company?: string, role?: string, link?: string, min_match_pct?: int = 80, force?: bool = false, cover_letter?: bool = true }` | Same pipeline but takes a raw posting + candidate JSON directly. No lead-store read. |
| `list_recent_applications` | `{ limit?: int = 20 }` | Reads `jobs/applications.csv` from `resume-opencode` (or via the HTTP client if a listing endpoint exists; see Phase 1). |
| `get_tailoring_status` | `{ task_id: string }` | Wraps `poll_task`. Lets an agent resume polling across turns. |

Threshold logic:

- If `ranking.evaluator.score` returns 0–1, multiply by 100.
- If 0–100, use directly. Confirm in Phase 0.
- `force=true` skips both the threshold and the duplicate guard.
- Duplicate guard behavior matches `resume-opencode`'s `409` contract:
  the tool returns `{ tailored: false, reason: "duplicate", match_pct,
  duplicate: { matchedBy, partialMatch, row } }` — same shape the
  resume-opencode UI already renders.

### New helper: `JustHireMe/backend/mcp_tailoring.py`

Keeps `mcp_server.py` small. The four tool functions in
`mcp_server.py` become thin wrappers around:

- `score_for_posting(posting, candidate) -> { score, components }`
- `gate_on_threshold(score, threshold) -> bool`
- `run_tailoring(client, *, posting, company, role, link, cover_output, force) -> { task_id, slug, files }`
- `poll_until_done(client, task_id, *, interval=2.0, timeout=900.0) -> { status, step, stepLabel, ... }`

The MCP handlers in `mcp_server.py` orchestrate: gate → duplicate check
→ `run_tailoring` → `poll_until_done` → `get_permalink` → return
result.

**New tests** in `JustHireMe/backend/tests/test_mcp_server.py`:
mirror the existing `_handle({jsonrpc, method: "tools/call", params})`
pattern. Cover:

- Below-threshold returns `{ tailored: false, reason: "below_threshold", match_pct }` without calling the client.
- Above-threshold happy path: monkey-patched client returns a
  `task_id` → terminal status → `permalink`; assert the response
  shape.
- `force=true` bypasses the threshold.
- Duplicate-guard `409` is surfaced with `matchedBy` / `partialMatch`
  intact.
- `get_tailoring_status` proxies `poll_task`.
- `list_recent_applications` proxies the client listing.
- `tailor_resume_from_text` accepts raw posting + candidate without
  touching the lead store.

---

## Phase 3 — Auto-tailor cron-style caller (JustHireMe side)

**New dir:** `JustHireMe/backend/scheduler/`
**New files:**

- `JustHireMe/backend/scheduler/__init__.py` (empty)
- `JustHireMe/backend/scheduler/auto_tailor.py`

Shape:

- Async entry point: `async def run() -> None`.
- Uses `apscheduler.AsyncIOScheduler` (`>=3.11.2`, already in
  `pyproject.toml`) to fire every
  `AUTO_TAILOR_INTERVAL_MINUTES` (default 60).
- Reads leads from the JustHireMe lead repo (same source the
  `api/routers/leads.py` router uses — verify in Phase 0).
- For each lead with status `quality_passed` and not yet
  `tailored`:
  1. Load the candidate profile via the `profile` service.
  2. Call `score_for_posting(posting, candidate)` (in-process, no MCP
     round-trip).
  3. If `match_pct ≥ AUTO_TAILOR_MIN_MATCH_PCT` (default 80), call
     `tailor_resume_for_lead(force=False, cover_letter=True)`.
  4. Append the outcome to
     `JustHireMe/backend/data/auto_tailor_log.jsonl` with
     `{ ts, job_id, match_pct, action, task_id?, slug?, error? }`.
- Graceful shutdown on `SIGINT` / `SIGTERM` — drains the in-flight
  generate, then exits.

Two ways to run:

1. **Standalone (default, documented):**
   ```bash
   backend/.venv/bin/python backend/scheduler/auto_tailor.py
   ```
2. **In-app (optional, opt-in):** add a `lifespan` hook in
   `JustHireMe/backend/main.py` that starts the scheduler when
   `AUTO_TAILOR_ENABLED=true` is set in the environment.

Env vars (added to `JustHireMe/backend/.env.example`):

```
# resume-opencode bridge
RESUME_OPENCODE_URL=http://localhost:3001
RESUME_OPENCODE_REQUEST_TIMEOUT_S=600

# auto-tailor scheduler
AUTO_TAILOR_ENABLED=false
AUTO_TAILOR_INTERVAL_MINUTES=60
AUTO_TAILOR_MIN_MATCH_PCT=80
AUTO_TAILOR_LOG_PATH=backend/data/auto_tailor_log.jsonl
```

**New test file:** `JustHireMe/backend/tests/test_auto_tailor.py`

- Monkey-patches the lead repo to return a fixed list (one
  below-threshold, one above-threshold, one already-tailored).
- Monkey-patches `score_for_posting` and `tailor_resume_for_lead`.
- Asserts: below-threshold is skipped, above-threshold is passed
  through with `force=False`, already-tailored is skipped, and the log
  file is appended with the expected JSONL line per outcome.

---

## Phase 4 — Documentation + skill updates

### JustHireMe side

- `JustHireMe/docs/MCP.md` — add the four new tools, the env vars
  (`RESUME_OPENCODE_URL`, `RESUME_OPENCODE_REQUEST_TIMEOUT_S`,
  `AUTO_TAILOR_*`), and a "headless auto-tailor" run example.
- `JustHireMe/README.md` §"Agent Skill And MCP" — same updates inline.
- `JustHireMe/backend/.env.example` — add the five new env vars with
  sane defaults and comments.
- `JustHireMe/skills/justhireme/SKILL.md` — add a
  `tailor_resume_for_lead` recipe, document the 80% default threshold,
  and a one-liner for the auto-tailor scheduler.

### resume-opencode side (this repo)

No code changes. The only docs update in this repo is a small note in
`README.md` §"Architecture" (or a new section, "MCP integration with
JustHireMe") listing the endpoints this plan depends on so future
maintainers know to keep their contract stable:

- `POST /generate`
- `GET  /generate/task/:taskId`
- `GET  /generate/checkDuplicate`
- `GET  /generate/prefill`
- `GET  /generate/searchByDescription` (or a future listing endpoint)
- `GET  /jobs/<slug>/permalink.txt`

The note will explicitly state that a `409` response from
`POST /generate` MUST include `{ matchedBy, partialMatch, row }` and
that a task's terminal status MUST be one of `complete | error |
cancelled` with a `step` and `stepLabel`.

---

## Phase 5 — Test matrix (JustHireMe side)

| Test file | Covers |
|---|---|
| `tests/test_mcp_server.py` (extend) | All four new tools, threshold gating, `force=true`, duplicate-guard passthrough, error mapping. |
| `tests/test_resume_opencode_client.py` (new) | All five client methods, 4xx passthrough, 5xx → `ResumeOpenCodeClientUnavailable`, transport errors. |
| `tests/test_auto_tailor.py` (new) | Scheduler skips below-threshold, processes above-threshold, skips already-tailored, appends to log, survives empty lead list, survives missing `resume-opencode` (logs error, continues). |

Run: `cd JustHireMe/backend && .venv/bin/python -m pytest -q`

---

## File-by-file change list (JustHireMe)

| File | Change |
|---|---|
| `backend/resume_opencode_client.py` | **NEW.** Async httpx client. |
| `backend/mcp_tailoring.py` | **NEW.** Helpers used by `mcp_server.py`. |
| `backend/mcp_server.py` | Extend `TOOL_DEFINITIONS` + `TOOLS` with 4 new tools. |
| `backend/scheduler/__init__.py` | **NEW.** Empty. |
| `backend/scheduler/auto_tailor.py` | **NEW.** Async loop with apscheduler. |
| `backend/main.py` | Optional `lifespan` hook to start the scheduler when `AUTO_TAILOR_ENABLED=true`. |
| `backend/.env.example` | Add 5 new env vars. |
| `docs/MCP.md` | Document new tools + env + auto-tailor run. |
| `README.md` | Update "Agent Skill And MCP" section. |
| `skills/justhireme/SKILL.md` | Add tailor recipe + 80% threshold note. |
| `backend/tests/test_mcp_server.py` | Extend with 4 new tool cases. |
| `backend/tests/test_resume_opencode_client.py` | **NEW.** |
| `backend/tests/test_auto_tailor.py` | **NEW.** |

## File-by-file change list (resume-opencode — this repo)

| File | Change |
|---|---|
| `README.md` | Add a short "MCP integration with JustHireMe" subsection listing the endpoints this plan depends on and their contract guarantees. No code changes. |

No Rust, no Tauri, no `package.json` changes, no LaTeX template
changes, no `applications.csv` schema changes.

---

## Risks / open items to verify in Phase 0

1. **Score scale** of `ranking.evaluator.score` — confirm whether the
   returned `score` is 0–1 or 0–100, and that `score_job_fit` surfaces
   it as `match_pct`. If not, the threshold adapter needs a small
   multiplication step.
2. **Lead shape** that the auto-tailor reads — `backend/repo/leads.py`
   (or equivalent) vs the lead shape `evaluate_lead_quality` accepts.
   Likely the same, but verify.
3. **Profile JSON shape** that `score_job_fit` expects vs what the
   profile service exposes — `backend/api/routers/profile.py` is the
   source of truth.
4. **Auth on resume-opencode admin endpoints** — only `applySuggestions`,
   `diffResume`, and `/api/config` are admin-protected (per
   `server.ts:40-52`). The endpoints this plan calls (`/generate`,
   `/generate/task/:id`, `/generate/prefill`, `/generate/checkDuplicate`,
   `/generate/searchByDescription`) are not admin-protected, so no
   `ADMIN_PASSWORD` plumbing is needed in the JustHireMe MCP server.
5. **`list_recent_applications` source of truth** — currently
   `resume-opencode` exposes `findApplications` programmatically and
   `GET /generate/checkDuplicate` for ad-hoc lookups, but no
   "list recent N applications" HTTP endpoint. Two options:
   (a) add a small `GET /generate/applications?limit=N` endpoint to
   resume-opencode (one-file change, mirror of the existing
   `findApplications` codepath); or
   (b) read `jobs/applications.csv` directly from the JustHireMe side
   via a shared path. Decide in Phase 0 based on whether
   `RESUME_OPENCODE_JOBS_PATH` is acceptable to expose. (a) is the
   preferred path and is the only code change this plan would request
   from resume-opencode.)

---

## Deferred (not in this plan)

- WebSocket push from resume-opencode → JustHireMe (replace polling).
- A "tailored leads" view in the JustHireMe React UI showing the
  auto-tailor log.
- Strategy B bridge to JustHireMe's `backend/generation/generator.py`
  as a fallback when `resume-opencode` is down.
- A retry-with-backoff wrapper around `start_generate` for transient
  5xx from `resume-opencode`.
- Per-lead `min_match_pct` overrides stored in the lead itself (instead
  of per-call / global env).
