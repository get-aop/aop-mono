## 1. Centralized Path Module

- [x] 1.1 Create `aopPaths` module in `@aop/infra` with all path resolvers (home, db, logs, repoDir, openspecChanges, worktrees, worktree, worktreeMetadata)
- [x] 1.2 Replace hardcoded `~/.aop/aop.sqlite` in db/connection.ts with `aopPaths.db()`
- [x] 1.3 Replace hardcoded `~/.aop/logs` in executor.ts with `aopPaths.logs()`

## 2. Repo Registration

- [x] 2.1 Update `initRepo` handler to create `~/.aop/repos/<repo_id>/openspec/changes/`, `worktrees/`, and `worktrees/.metadata/` directories after DB insert
- [x] 2.2 Update existing tests for initRepo to verify directory creation

## 3. GitManager Global Worktree Paths

- [x] 3.1 Add `repoId` to `GitManagerOptions` interface and pass it through constructor
- [x] 3.2 Change `worktreesDir` from `{repoPath}/.worktrees` to `aopPaths.worktrees(repoId)`
- [x] 3.3 Remove `ensureGitignore()` method and its call sites
- [x] 3.4 Update all GitManager instantiation sites (executor, CLI) to pass `repoId`
- [x] 3.5 Update GitManager tests to use global paths

## 4. Env File Sync

- [x] 4.1 Create env file discovery function using `git ls-files` for tracked and untracked `.env*` files
- [x] 4.2 Create symlink function that links discovered env files into worktree preserving directory structure
- [x] 4.3 Integrate env file sync into worktree creation flow (after `git worktree add`)
- [x] 4.4 Add tests for env discovery and symlinking

## 5. File Watcher

- [x] 5.1 Update watcher to watch `~/.aop/repos/<repo_id>/openspec/changes/` as primary path
- [x] 5.2 Add fallback watcher on `{repo}/openspec/changes/` that auto-relocates artifacts to global path
- [x] 5.3 Update reconciler to scan global openspec path instead of repo-local path
- [x] 5.4 Add reconciler logic to auto-relocate change directories found at repo-local path during ticker
- [x] 5.5 Update watcher and reconciler tests

## 6. Executor Path Resolution

- [x] 6.1 Update `buildContext` to resolve `changePath` via `aopPaths.openspecChanges(repo.id)` + change name
- [x] 6.2 Update `buildContext` to resolve `worktreePath` via `aopPaths.worktree(repo.id, task.id)`
- [x] 6.3 Update `createWorktree` to instantiate GitManager with `repoId`
- [x] 6.4 Update executor tests

## 7. Remove Dead Code

- [x] 7.1 Remove `resolveTaskByChangePath` function and its module
- [x] 7.2 Remove all callers/imports of `resolveTaskByChangePath`
- [x] 7.3 Remove associated tests for resolveTaskByChangePath

## 8. E2E Tests for Global Path Architecture

> **CRITICAL**: This is a major architecture reorg. E2E tests MUST cover the full lifecycle
> to ensure nothing breaks across repo registration, worktree creation, task execution,
> and file watcher reconciliation with the new global path layout.

- [x] 8.1 Create E2E test: **repo registration creates global directory structure** — Register a temp repo via `initRepo`, verify `~/.aop/repos/<repo_id>/openspec/changes/`, `worktrees/`, and `worktrees/.metadata/` directories are created on disk. Add to `e2e-tests/src/`.
- [x] 8.2 Create E2E test: **worktree creation at global path** — Register a repo, create a task, trigger worktree creation, verify the worktree is created at `~/.aop/repos/<repo_id>/worktrees/<task_id>` (NOT at `{repo}/.worktrees/`), verify it's a valid git worktree (`git worktree list` includes it), and verify `.env*` files are symlinked into the worktree.
- [x] 8.3 Create E2E test: **executor resolves paths from global location** — Register a repo, create a change at the global openspec path, create a task, and verify `buildContext` resolves `changePath` and `worktreePath` from `~/.aop/repos/<repo_id>/` and NOT from the repo directory.
- [x] 8.4 Create E2E test: **watcher auto-relocation from repo-local to global** — Register a repo, write an openspec change artifact to `{repo}/openspec/changes/my-feature/`, verify the watcher detects it and auto-relocates it to `~/.aop/repos/<repo_id>/openspec/changes/my-feature/`, and verify the repo-local copy is removed.
- [x] 8.5 Create E2E test: **full task lifecycle with global paths** — End-to-end: register repo → create change at global path → watcher reconciles and creates task → worktree is created at global path → executor runs with correct global paths → task completes. This tests the full happy path with the new architecture.
- [x] 8.6 Create E2E test: **no AOP artifacts in user repo** — After a full task lifecycle (register, create change, execute, complete), scan the user repo directory and verify NO `.worktrees/` directory, NO `openspec/` directory, and no AOP-related files exist in the user's repo root.
- [x] 8.7 Create E2E test: **backward compatibility — old repo-local paths still work** — Place change artifacts at the old `{repo}/openspec/changes/` location, verify the system still detects them (via fallback watcher), relocates them to global path, and processes them correctly.

## 9. Agent Review Report

```
I'll perform a thorough review of the implementation. Let me start by gathering context and understanding the changes.
Now let me read the actual changed files in parallel.
Now let me read the remaining modified files.
Now let me read the remaining test files and the E2E tests.
Now let me run the checks and tests in parallel.
All 1009 tests pass with 0 failures. Type checking and build pass. The linter finds 27 warnings, all `noNonNullAssertion` - let me check if these are pre-existing or new.
Main has 16 lint warnings, and with changes it's 27. So 11 new lint warnings were introduced. Let me check which specific ones are new.
Now let me also check the `resolve.ts` for the unused parameter issue I noticed.
Now let me check the E2E test files that were modified to see if they have correct `@aop/infra` import.
Good, `@aop/infra` is properly added as a dependency. Now I have enough context to write the review report. Let me check one more thing - the `_repoRepository` unused parameter in `resolve.ts`.
Now I have all the information needed. Let me write the review report.
Review report written to `agent-review-report.md`.

**Review Summary:**

3 findings (all quality/conformance, no critical/security issues):

1. **Dead `_repoRepository` parameter** in `resolve.ts:7` — the function now only does `taskRepository.get(identifier)`, making the repo parameter unused dead code (confidence: 95)

2. **11 new lint warnings** — `noNonNullAssertion` violations in `reconcile.test.ts` (7) and `global-paths.e2e.ts` (4+) from `repo!` / `completedTask!` patterns (confidence: 90)

3. **`reconcileAllRepos` untested** — the aggregation function has no direct test (confidence: 82)

All tests pass (1009/1009), type checking passes, build passes, coverage is 100% on all new files. The implementation is architecturally sound and well-tested.

<aop>REVIEW_FAILED</aop>
```

- [ ] 9.1 Address the review report

## 10. Verification Gate

> **BLOCKING**: Do NOT mark this change as DONE until this section is fully satisfied.

- [ ] 10.1 Run `bun check` and verify zero errors
- [x] 10.2 Run `bun test:coverage` (unit + integration tests) and verify all tests pass with no regressions
- [ ] 10.3 Run `bun test:e2e` and verify ALL E2E tests pass — including the new tests from section 8 AND all pre-existing E2E tests (daemon, aop-default, server-workflow, concurrency, etc.)
- [ ] 10.4 Confirm: paste the full output of `bun test:e2e` showing all tests passing before marking this change as complete

