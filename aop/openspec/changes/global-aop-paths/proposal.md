## Why

AOP currently creates `.worktrees/` and stores `openspec/` artifacts inside the user's repository. This pollutes the repo with AOP-specific directories, requires `.gitignore` management, and tightly couples AOP's internal storage to the user's project filesystem. Moving to a global `~/.aop/repos/<repo_id>/` structure cleanly separates AOP state from user code.

## What Changes

- **BREAKING**: Worktrees move from `{repo}/.worktrees/{taskId}` to `~/.aop/repos/<repo_id>/worktrees/{taskId}`
- **BREAKING**: OpenSpec changes move from `{repo}/openspec/changes/` to `~/.aop/repos/<repo_id>/openspec/changes/`
- New centralized path module (`aopPaths`) replaces all scattered path construction
- File watcher switches to watching global paths; adds fallback watcher on repo paths that auto-relocates artifacts found in old location
- `resolveTaskByChangePath` removed -- dashboard always has task ID
- Repo registration (`initRepo`) now creates the global directory structure
- `.gitignore` management for `.worktrees/` removed (no longer needed)
- After worktree creation, `.env*` files from the main repo are discovered via `git ls-files` (respecting `.gitignore`) and symlinked into the worktree

## Capabilities

### New Capabilities
- `aop-paths`: Centralized path resolution module providing all AOP directory paths from a single source of truth
- `env-file-sync`: Discovery and symlinking of `.env*` files from main repo into worktrees

### Modified Capabilities
- `git-manager`: Worktree paths resolve via global `~/.aop/repos/<repo_id>/worktrees/` instead of `{repo}/.worktrees/`. Remove `.gitignore` management.
- `file-watcher`: Primary watch target becomes `~/.aop/repos/<repo_id>/openspec/changes/`. Fallback watcher on repo path auto-relocates artifacts.
- `repo-management`: Registration creates global directory structure at `~/.aop/repos/<repo_id>/`.
- `task-detector`: Task creation uses global openspec path. Remove `resolveTaskByChangePath`.
- `execution-tracking`: Executor resolves worktree and change paths via `aopPaths` instead of repo-relative construction.

## Impact

- **Packages**: `git-manager` (worktree path resolution), `common` or `infra` (new `aopPaths` module)
- **Apps**: `local-server` (watcher, reconciler, executor, repo handlers), `cli` (any commands referencing openspec/worktree paths)
- **Database**: No schema changes -- `task.change_path` stays relative, resolution base changes
- **Filesystem**: `~/.aop/repos/` directory tree created per repo; existing repo-local `.worktrees/` and `openspec/` become legacy (auto-relocated)
- **User repos**: No longer contain any AOP-specific directories or `.gitignore` entries
