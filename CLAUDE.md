# HexCrawl VTT — agent instructions

Read [docs/AI-DEVELOPMENT.md](docs/AI-DEVELOPMENT.md) before changing
anything; it holds the workflow, architecture summary, and the gotchas that
keep biting. Architecture background is in [docs/DESIGN.md](docs/DESIGN.md).

Two rules that are not optional:

1. **Survey other work before starting.** Run `git fetch --all --prune`,
   `git branch -a --no-merged main`, and `git worktree list` (then
   `git -C <worktree> status --short` for each worktree). Read the diff of any
   branch or dirty worktree that overlaps the files you are about to touch, so
   you build on it instead of re-implementing, colliding with, or dropping it.
2. **Commit AND push after every change set.** Once `pnpm typecheck && pnpm test`
   pass, commit on your branch and push it. Work left uncommitted in a
   worktree is invisible to other sessions and to deploys, and has been lost
   that way before (PR #152 restored a feature set that only ever existed in
   a worktree and the production image built from it).

Deploys go only from a commit merged to `main`; see the Deployment section
of the guide and `deploy/RUNBOOK.md`.
