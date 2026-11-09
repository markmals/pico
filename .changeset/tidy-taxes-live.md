---
"pico": minor
---

Start delegated children in Worktrunk worktrees. Before Sesh starts a child, Pico creates its worktree with `wt`: a new `pico/<name>-<id>` branch from the parent session's last commit, in a hidden `.worktrees` folder beside your main checkout, with the project's `pre-start` hooks from `.config/wt.toml` already run. A launch from a checkout with uncommitted changes fails and asks you to commit or discard them first; a failing hook, a missing `wt` (`brew install worktrunk`) or a refused launch starts no child and leaves nothing behind. Once a child's turn has ended, Pico removes its worktree and branch if it changed nothing, shown as a tool call in the conversation; a child that committed or left files keeps both for you to review and merge. In-place launches and folders outside git go to Sesh unchanged. `git worktree add` through `bash` now runs plain git: in the Homebrew build it used to fail with `pico has no command "worktree"`.
