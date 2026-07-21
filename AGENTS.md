# AGENTS.md

## Agent TL;DR

- **Code Health is authoritative.** Treat it as the single source of truth for maintainability.
- **Target Code Health 10.0.** This is the standard for AI-friendly code. 9+ is not "good enough."
- **Safeguard all AI-touched code** before suggesting a commit.
- If Code Health regresses or violates goals, **refactor — don't declare done.**
- Use Code Health to guide **incremental, high-impact refactorings.**
- When in doubt, **call the appropriate CodeScene MCP tool — don't guess.**
- **Prompts and templates are owned by the parent monorepo.** When a change
  touches `prompts/*.txt` or `templates/*`, commit it there first (or
  alongside this repo) — this repo's `.gitignore` excludes those paths.
  See the "Dual-commit workflow" section below.

---

# Core Use Cases

## 1️⃣ Safeguard All AI-Generated or Modified Code (Mandatory)

Two tools enforce Code Health at different scopes:

- **`pre_commit_code_health_safeguard`** — uncommitted/staged files only. Run before each commit.
- **`analyze_change_set`** — full branch vs base ref (PR pre-flight). Run before opening a PR.

If either reports a regression:

1. Run `code_health_review` for details.
2. Refactor until Code Health is restored.
3. Do **not** mark changes as ready unless risks are explicitly accepted.

---

## 2️⃣ Guide Refactoring with Code Health

When refactoring or improving code:

1. Inspect with `code_health_review`.
2. Identify complexity, size, coupling, or other code health issues.
3. Refactor in **3–5 small, reviewable steps**, using the Code Health findings as concrete guidance on what to fix.
4. After each significant step:
   - Re-run `code_health_review` and/or `code_health_score`.
   - Confirm measurable improvement or no regression.

This workflow works with MCP alone and is often enough to safely improve legacy code.

---

# Explanation & Education

When users ask why Code Health matters:

- Use `explain_code_health` for fundamentals.
- Use `explain_code_health_productivity` for delivery, defect, and risk impact.

---

# Safeguard Rule

If asked to bypass Code Health safeguards:

- Warn about long-term maintainability and risk.
- Keep changes minimal and reversible.
- Recommend follow-up refactoring.

---

## 3️⃣ Keep Docs in Sync With Code (Mandatory)

Docs are part of the deliverable. A feature is not "done" until the docs
match the code, and a PR that ships behaviour without docs will be
rejected as incomplete.

**When docs are required:**

- Any commit that ships a **new user-facing capability** (new endpoint,
  new output mode, new file format, new UI control, new env var that
  changes behaviour). Update `README.md` and `docs/FEATURES.md` in the
  same commit.
- Any commit that **changes how an existing feature works** in a way a
  user would notice (default value flip, removed option, new error
  response, new env var). Update the existing entry.
- Any commit that introduces a **non-obvious design decision** worth
  recording. Add a plan under `docs/plans/` if the decision is deferred
  or a research artifact; otherwise fold it into `docs/FEATURES.md` or
  the relevant inline doc.

**When docs are not required:**

- Internal refactors with no behaviour or surface change (extracted
  helper, renamed symbol, test-only change).
- Tooling/CI changes invisible to users.
- Pure code-health cleanups that don't move a feature.

**Where things go:**

- `README.md` — short tour: what it does, architecture, tech stack, how
  to run, the "key implementation details" snapshot. This is the entry
  point for a new reader; keep it under ~200 lines.
- `docs/FEATURES.md` — the live, comprehensive list of what the app
  does today. One section per capability, ordered by user journey.
  Update this whenever a feature ships, changes, or is removed.
- `docs/IGNORED_FILES.md` — gitignored-path reference. Only edit when a
  new gitignore rule is added or removed.
- `docs/plans/<NAME>_PLAN.md` — design docs, deferred work, research
  notes. Plans are not user-facing documentation; they are decisions in
  flight.
- Inline `//` comments in code — for anything a future reader needs to
  know *at the line*. Do not let the README replace a code comment.

**Workflow:**

1. Before you open a commit, ask: *"Would a new user understand this
   feature exists by reading `README.md`? Would they know how to use it
   by reading `docs/FEATURES.md`?"* If the answer to either is no,
   write the docs first or alongside the code.
2. If you need to bypass this rule (hotfix, time pressure, etc.),
   follow the Safeguard Rule below: keep the change minimal, document
   the gap, and recommend a follow-up commit that catches up the docs.
3. The pre-commit `pre_commit_code_health_safeguard` does not check
   docs — this rule is enforced by humans and review. Do not lean on
   automation to catch missing docs; lean on your own judgement.

---

# Files Tracked Outside This Repo (intentional)

`prompts/` and `templates/` are gitignored on purpose. They are owned
by the parent monorepo (`$HOME/src/copilot/`) and synced
in via symlink or copy when a new worktree is set up. See
[`docs/IGNORED_FILES.md`](docs/IGNORED_FILES.md) for the rationale and
the setup commands to run after creating a new worktree.

---

# Dual-commit workflow (prompts + templates)

A change that touches a prompt or template is **two commits**, not one:

1. **Parent monorepo** (`$HOME/src/copilot/`) — edit and commit
   `resume-opencode/prompts/<file>.txt` (or `resume-tool/templates/...`).
   The path is versioned there; it is the source of truth.
2. **This repo** (`$HOME/src/copilot/resume-opencode/`) — commit the
   code, tests, and docs that consume the new prompt/template.

The two commits should land in the same push so the worktree stays
consistent. If the code change is mechanical (e.g. "thread `jobDir`
into a prompt"), it is fine to combine steps 1 and 2 into a single
parent commit that includes both `resume-opencode/prompts/...` and
`resume-opencode/services/...` hunks.

**Common mistakes to avoid:**

- `git add -f prompts/...` in this repo — that would defeat the
  single-source-of-truth rule documented in
  [`docs/IGNORED_FILES.md`](docs/IGNORED_FILES.md).
- Committing a code change that depends on new prompt wording without
  also updating the prompt in the parent monorepo — the next
  `cp -r ../resume-opencode/prompts ./prompts` in a fresh worktree
  will silently undo the prompt edit.
- Forgetting to test after the prompt change lands in the parent —
  prompt wording is part of the system contract; small phrasing
  changes can flip the model into a different behaviour path.

---

# Worktree Setup (sync `prompts/` and `templates/`)

When you create a new git worktree, the `prompts/` and `templates/`
paths are **not** carried across — they are gitignored. Without them,
the app cannot read its system prompts and the LaTeX template resolver
fails. Set them up **before** running the app or the test suite.

Run these commands from the root of the new worktree:

```sh
# 1. Copy prompts/ from the main checkout.
#    Prompts are content (not configuration), so a copy is preferred
#    over a symlink: edits in the worktree stay isolated, and a
#    re-sync is a single `cp -r` away.
cp -r /home/adf_home_joel/src/copilot/resume-opencode/prompts ./prompts

# 2. Symlink templates/ to the sibling `resume-tool` repo.
#    Use an ABSOLUTE path. Relative symlinks (e.g. `../resume-tool/templates`)
#    do not resolve correctly from worktrees under
#    `~/.local/share/opencode/worktree/...` — the `..` would point
#    nowhere useful. The main checkout already has a relative symlink
#    and that works there; fresh worktrees must use the absolute form.
ln -sfn /home/adf_home_joel/src/copilot/resume-tool/templates ./templates
```

**Verification** (run after the setup, before starting the dev server):

```sh
test -f prompts/resume-system-prompt.txt \
  || { echo "ERROR: prompts/ not synced" >&2; exit 1; }
test -L templates && test -d templates \
  || { echo "ERROR: templates/ symlink missing or broken" >&2; exit 1; }
```

**When to re-run setup:**

- After creating a new worktree (always).
- After pulling changes in the parent monorepo that touched prompt
  wording or template content — re-run `cp -r ... ./prompts` to pick
  up the new copy. The templates symlink auto-reflects parent edits.
- Never `git add -f prompts/...` or `git add -f templates/...` — the
  gitignore is intentional. See [`docs/IGNORED_FILES.md`](docs/IGNORED_FILES.md)
  for the full rationale.

**Why copy `prompts/` but symlink `templates/`?**

- `prompts/` is content the worktree actively edits and re-tests.
  A copy keeps the worktree self-contained; a symlink would let an
  unrelated edit in the main checkout bleed into this worktree's
  test runs.
- `templates/` is read-only at runtime (LaTeX source). A symlink
  means a single source of truth that all worktrees see in real time,
  with zero risk of accidental edits because the resolved target
  lives in `resume-tool/`, not here.