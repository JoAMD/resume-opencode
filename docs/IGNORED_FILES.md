# Gitignored Paths in This Repo

Some files that this app reads at runtime are intentionally **not tracked
in this repository**. They are owned by the parent monorepo (or its
sibling repos) and synced in via symlink or local checkout.

The relevant `.gitignore` entries are:

| Entry | Why it's ignored |
| --- | --- |
| `prompts/` | Prompt content is shared across apps in the parent monorepo and lives there as the source of truth. This app reads prompts at startup; the symlink or copied directory is set up out-of-band. |
| `templates`, `templates/` | `templates/` is a symlink that points at `../resume-tool/templates` in the parent monorepo layout, so the LaTeX and base-resume templates stay with the broader tool rather than being duplicated here. |

## Working in a fresh worktree

When you create a new git worktree, `prompts/` and `templates/` are
**not** carried across — they're outside git. Set them up before
running the app or the test suite:

```sh
# from the new worktree root
cp -r ../resume-opencode/prompts   ./prompts
ln -sfn /home/adf_home_joel/src/copilot/resume-tool/templates ./templates
```

(Adjust the source paths to match your local checkout of the parent
monorepo. The `templates` symlink path is absolute because relative
symlinks don't resolve correctly across worktrees — `../` from a
worktree under `~/.local/share/opencode/worktree/...` would point
nowhere useful.)

## Why this is intentional

- **Single source of truth.** Prompt wording and resume templates are
  shared between `resume-opencode`, `resume-tool`, and any other
  apps that consume them. Editing them in one place avoids drift.
- **No accidental cross-repo commits.** If `prompts/` were tracked
  here, a copy-paste from the parent repo could be committed here by
  mistake and silently diverge.
- **Smaller, focused repo.** This repo's source-of-truth diff stays
  about the code, not the content that flows through it.

## What to do when you change a prompt or template

1. Edit in the parent monorepo (or the symlink target), not here.
2. Re-run the copy/symlink command in every worktree where you need
   the change.
3. Don't add a `git add -f prompts/...` to force-track — that would
   defeat the purpose.
