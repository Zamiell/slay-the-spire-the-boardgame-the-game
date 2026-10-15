# T3 checkpoint capture on the WSL host

T3 Code 0.0.42 creates a fresh index from HEAD for every checkpoint, then runs
`git add -A`. The fresh index has no file-stat cache, so Git rereads the large
tracked animation assets even when they are unchanged and can exceed T3's
30-second process timeout.

`infra/t3-checkpoint-git.py` is a Linux Git passthrough for this host. Only T3's
`read-tree HEAD` with a fresh `t3-checkpoint-index-<UUID>` in the repository's
common Git directory uses the developer index's stat cache. It clears inherited
assume-unchanged/skip-worktree flags and resets the copied index to HEAD before
capture. The developer index and working files are never written. Every other
command goes directly to `/usr/bin/git`.

Run `node scripts/verify-t3-checkpoint.mjs`, then install a durable copy:

```sh
install -m 755 infra/t3-checkpoint-git.py "$HOME/.local/bin/git"
```

The T3 service already puts `~/.local/bin` first in PATH. Its next Git subprocess
uses the installed copy without a service restart. Do not symlink into a task
worktree. To remove the workaround, delete only that installed copy after
verifying it matches this script; Git then resolves to `/usr/bin/git`.
