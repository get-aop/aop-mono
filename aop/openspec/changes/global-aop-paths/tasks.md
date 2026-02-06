## 1. Centralized Path Module

- [ ] 1.1 Create `aopPaths` module in `@aop/infra` with all path resolvers (home, db, logs, repoDir, openspecChanges, worktrees, worktree, worktreeMetadata)
- [ ] 1.2 Replace hardcoded `~/.aop/aop.sqlite` in db/connection.ts with `aopPaths.db()`
- [ ] 1.3 Replace hardcoded `~/.aop/logs` in executor.ts with `aopPaths.logs()`

## 2. Repo Registration

- [ ] 2.1 Update `initRepo` handler to create `~/.aop/repos/<repo_id>/openspec/changes/`, `worktrees/`, and `worktrees/.metadata/` directories after DB insert
- [ ] 2.2 Update existing tests for initRepo to verify directory creation

## 3. GitManager Global Worktree Paths

- [ ] 3.1 Add `repoId` to `GitManagerOptions` interface and pass it through constructor
- [ ] 3.2 Change `worktreesDir` from `{repoPath}/.worktrees` to `aopPaths.worktrees(repoId)`
- [ ] 3.3 Remove `ensureGitignore()` method and its call sites
- [ ] 3.4 Update all GitManager instantiation sites (executor, CLI) to pass `repoId`
- [ ] 3.5 Update GitManager tests to use global paths

## 4. Env File Sync

- [ ] 4.1 Create env file discovery function using `git ls-files` for tracked and untracked `.env*` files
- [ ] 4.2 Create symlink function that links discovered env files into worktree preserving directory structure
- [ ] 4.3 Integrate env file sync into worktree creation flow (after `git worktree add`)
- [ ] 4.4 Add tests for env discovery and symlinking

## 5. File Watcher

- [ ] 5.1 Update watcher to watch `~/.aop/repos/<repo_id>/openspec/changes/` as primary path
- [ ] 5.2 Add fallback watcher on `{repo}/openspec/changes/` that auto-relocates artifacts to global path
- [ ] 5.3 Update reconciler to scan global openspec path instead of repo-local path
- [ ] 5.4 Add reconciler logic to auto-relocate change directories found at repo-local path during ticker
- [ ] 5.5 Update watcher and reconciler tests

## 6. Executor Path Resolution

- [ ] 6.1 Update `buildContext` to resolve `changePath` via `aopPaths.openspecChanges(repo.id)` + change name
- [ ] 6.2 Update `buildContext` to resolve `worktreePath` via `aopPaths.worktree(repo.id, task.id)`
- [ ] 6.3 Update `createWorktree` to instantiate GitManager with `repoId`
- [ ] 6.4 Update executor tests

## 7. Remove Dead Code

- [ ] 7.1 Remove `resolveTaskByChangePath` function and its module
- [ ] 7.2 Remove all callers/imports of `resolveTaskByChangePath`
- [ ] 7.3 Remove associated tests for resolveTaskByChangePath
