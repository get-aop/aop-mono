## Context

AOP stores worktrees at `{repo}/.worktrees/{taskId}` and discovers OpenSpec changes at `{repo}/openspec/changes/`. Paths are constructed inline across watcher, executor, reconciler, and git-manager. This creates three problems:

1. **Repo pollution**: `.worktrees/` and `openspec/` directories in the user's repo require `.gitignore` entries and confuse developers.
2. **Scattered path logic**: Each component builds paths independently -- `join(repo.path, ".worktrees", task.id)`, `join(repoPath, "openspec/changes")`, etc. No single source of truth.
3. **Coupling**: AOP's internal storage is tied to the repo filesystem, preventing multi-tool or shared-machine scenarios.

AOP already uses `~/.aop/` for the database (`aop.sqlite`), PID file, and execution logs. This change extends that pattern to worktrees and OpenSpec artifacts.

## Goals / Non-Goals

**Goals:**
- Move all AOP-managed directories out of user repositories into `~/.aop/repos/<repo_id>/`
- Centralize path resolution into a single `aopPaths` module
- Auto-relocate artifacts found at old repo-local paths (backward compatibility during transition)
- Symlink `.env*` files from main repo into worktrees so tests and tooling work

**Non-Goals:**
- Database schema migration (task.change_path stays relative)
- Changing TypeID format or task/repo identity model
- Supporting multiple AOP homes (always `~/.aop`)
- Version-controlling OpenSpec artifacts in the user repo

## Decisions

### 1. Centralized path module in `@aop/infra`

All AOP paths derive from `~/.aop/`:

```
~/.aop/
  aop.sqlite
  aop.pid
  logs/{taskId}.jsonl
  repos/{repoId}/
    openspec/changes/{changeName}/
    openspec/changes/archive/
    worktrees/{taskId}/
    worktrees/.metadata/{taskId}.json
```

A single `aopPaths` object replaces all inline `join()` calls. Every component imports from `@aop/infra` instead of constructing paths.

**Why `@aop/infra`**: It already hosts shared utilities (logger, etc.) and is imported by both `local-server` and `cli`. The path module is infrastructure, not domain logic.

### 2. Repo-local fallback watcher with auto-relocation

The watcher adds a secondary watch on `{repo}/openspec/changes/`. When artifacts appear at the old location (e.g., Claude Code skills writing there), the watcher moves them to `~/.aop/repos/<repo_id>/openspec/changes/` and removes the repo copy.

**Why auto-relocation vs. hard cutover**: OpenSpec skills run inside Claude Code sessions and may reference the repo path. Auto-relocation provides a smooth transition without requiring all skills to update simultaneously.

### 3. `git worktree add` with external path

Git supports worktrees at arbitrary paths: `git worktree add /absolute/path -b branch`. The worktree is managed by the repo's `.git/worktrees/` metadata regardless of where the checkout directory lives. This means `~/.aop/repos/<repo_id>/worktrees/{taskId}` works natively with git.

**Why not symlinks**: Actual git worktrees at external paths are first-class git citizens. Symlinks would add fragility.

### 4. `.env*` discovery via `git ls-files`

After worktree creation, discover all `.env*` files using:
- `git ls-files --cached "**/.env*"` (tracked)
- `git ls-files --others --exclude-standard "**/.env*"` (untracked, respecting `.gitignore`)

Symlink each into the worktree at the same relative path. This naturally skips `node_modules/`, `dist/`, etc.

**Why symlinks not copies**: Env files may change. Symlinks keep worktrees in sync with the main repo's env without manual updates.

### 5. Remove `resolveTaskByChangePath`

This function walks up directories to find git root, looks up the repo, and queries by change path. It exists for CLI-based task resolution. Since all task interactions now go through the dashboard (which has the task ID), this code path is dead.

### 6. GitManager receives `repoId` parameter

Currently `GitManager` only knows `repoPath`. To construct global worktree paths, it also needs `repoId`. The constructor options expand:

```typescript
interface GitManagerOptions {
  repoPath: string;
  repoId: string; // new
}
```

The `worktreesDir` is then `aopPaths.worktrees(repoId)` instead of `join(repoPath, ".worktrees")`.

### 7. `initRepo` creates global directory structure

When a repo is registered, `initRepo` creates:
```
~/.aop/repos/<repo_id>/openspec/changes/
~/.aop/repos/<repo_id>/worktrees/
~/.aop/repos/<repo_id>/worktrees/.metadata/
```

This ensures the directory structure exists before the watcher starts monitoring.

## Risks / Trade-offs

- **[Risk] Existing worktrees in `.worktrees/` become orphaned** → Migration: on first access, detect repo-local worktrees and log a warning. Existing WORKING tasks will still resolve because executor will check both locations during transition.
- **[Risk] Claude Code skills write to old repo path** → Mitigated by auto-relocation watcher. Skills can be updated incrementally.
- **[Risk] `~/.aop/repos/` grows unbounded** → Tracked by repo lifecycle: when a repo is unregistered, its global directory can be cleaned up. Not in scope for this change but natural extension.
- **[Trade-off] Opaque directory names (`repo_abc123`)** → Accepted for consistency with DB. Users don't interact with `~/.aop/` directly.
- **[Trade-off] `.env*` symlinks may expose secrets to worktree agents** → Same exposure as today (agents already run in the repo). No change in security posture.
