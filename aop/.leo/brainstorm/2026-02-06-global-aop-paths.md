# Global AOP Paths: Move worktrees & openspec out of user repos

## Problem

AOP currently creates `.worktrees/` and depends on `openspec/` inside the user's repository. This pollutes the repo with AOP-specific directories, requires `.gitignore` management, and couples AOP's internal storage to the repo's filesystem.

## Decision

Move both worktrees and openspec artifacts to a global location at `~/.aop/repos/<repo_id>/`.

- **repo_id**: Existing TypeID format (`repo_abc123`) from the database
- **No symlinks in user repo**: Clean separation -- nothing AOP-related in the user's repo
- **Auto-relocation**: Watcher moves artifacts from repo to global path if found in old location

## Global Path Structure

```
~/.aop/
  aop.sqlite              # (existing)
  aop.pid                 # (existing)
  logs/                   # (existing)
  repos/
    repo_abc123/          # One per registered repo
      openspec/
        changes/
          my-feature/     # Change artifacts
          archive/        # Archived changes
      worktrees/
        task_xyz789/      # Git worktrees
        .metadata/
          task_xyz789.json
```

## Centralized Path Module

Single source of truth in `@aop/infra` (or `@aop/common`):

```typescript
// aop-paths.ts
const AOP_HOME = join(homedir(), ".aop");

export const aopPaths = {
  home: () => AOP_HOME,
  db: () => join(AOP_HOME, "aop.sqlite"),
  logs: () => join(AOP_HOME, "logs"),
  repoDir: (repoId: string) => join(AOP_HOME, "repos", repoId),
  openspecChanges: (repoId: string) => join(AOP_HOME, "repos", repoId, "openspec", "changes"),
  worktrees: (repoId: string) => join(AOP_HOME, "repos", repoId, "worktrees"),
  worktree: (repoId: string, taskId: string) => join(AOP_HOME, "repos", repoId, "worktrees", taskId),
  worktreeMetadata: (repoId: string) => join(AOP_HOME, "repos", repoId, "worktrees", ".metadata"),
};
```

## Component Changes

### 1. Watcher (dual-mode)
- **Primary**: Watch `~/.aop/repos/<repo_id>/openspec/changes/` for task reconciliation
- **Fallback**: Watch `{repo}/openspec/changes/` -- if changes appear here, auto-move to global path and delete repo copy
- Task reconciliation uses the global path as source of truth

### 2. GitManager / WorktreeOps
- `worktreesDir` resolves via `aopPaths.worktrees(repoId)` instead of `{repoPath}/.worktrees`
- `MetadataStore` path updated similarly
- Remove `.gitignore` management for `.worktrees/` (no longer needed)
- **New**: After worktree creation, symlink `.env` files from main repo into worktree

### 3. Executor (`buildContext`)
- `changePath` resolves via `aopPaths.openspecChanges(repoId)` + change name
- `worktreePath` resolves via `aopPaths.worktree(repoId, task.id)`
- `task.change_path` in DB stays relative (`openspec/changes/{name}`)

### 4. Task Resolution (`resolveTaskByChangePath`)
- **Remove entirely**. The dashboard always has the task ID -- no need for filesystem-based task resolution via change path walking.

### 5. OpenSpec Skills (Claude Code)
- Can write to `{repo}/openspec/changes/` -- watcher auto-relocates
- Or write directly to global path if repo is registered
- Auto-register repo on first use (detect git root -> register -> create dirs)

### 6. Repo Registration (`initRepo`)
- After registering repo in DB, create `~/.aop/repos/<repo_id>/openspec/changes/` directory structure

## .env File Handling

Worktrees don't get untracked files. After `git worktree add`, find ALL `.env*` files in the repo tree (respecting `.gitignore` to skip `node_modules`, `dist`, etc.) and symlink them into the worktree at the same relative paths.

```typescript
// Use git ls-files to find .env* files not in .gitignore
// git ls-files --others --exclude-standard matches untracked files respecting .gitignore
// Combined with tracked .env* files, this gives the complete set
const findEnvFiles = async (repoPath: string): Promise<string[]> => {
  // Find all .env* files that git knows about or would track
  const tracked = await exec(["git", "ls-files", "--cached", "**/.env*"], { cwd: repoPath });
  const untracked = await exec(["git", "ls-files", "--others", "--exclude-standard", "**/.env*"], { cwd: repoPath });
  return [...new Set([...tracked, ...untracked])]; // dedupe, relative paths
};

// After worktree creation:
const envFiles = await findEnvFiles(repoPath);
for (const envFile of envFiles) {
  const src = join(repoPath, envFile);
  const dest = join(worktreePath, envFile);
  await mkdir(dirname(dest), { recursive: true }); // preserve directory structure
  await symlink(src, dest);
}
```

## Migration

- Existing `.worktrees/` and `openspec/changes/` in repos continue to work via the watcher's auto-relocation
- No database migration needed -- `task.change_path` stays as relative path
- GitManager needs `repoId` parameter added (currently only has `repoPath`)

## What's NOT Changing

- Database schema (besides potentially passing repoId to more places)
- TypeID format for repos/tasks
- OpenSpec artifact format (design.md, tasks.md, etc.)
- Execution logs location (already at `~/.aop/logs/`)
