## 1. Package Setup

- [x] 1.1 Create `packages/git-manager` directory with package.json, tsconfig.json
- [x] 1.2 Create `src/index.ts` with public exports
- [x] 1.3 Define TypeScript interfaces: `GitManager`, `WorktreeInfo`, `SquashResult`
- [x] 1.4 Define error classes: `GitConflictError`, `WorktreeExistsError`, `BranchNotFoundError`, `NoCommitsError`, `DirtyWorktreeError`, `WorktreeNotFoundError`, `NotAGitRepositoryError`

## 2. Core Infrastructure

- [x] 2.1 Implement `GitManager` class constructor with repository path validation
- [x] 2.2 Add helper to execute git commands via `Bun.$` with error handling
- [x] 2.3 Add helper to check if path is a git repository
- [x] 2.4 Add helper to get current branch and HEAD commit

## 3. Worktree Creation

- [x] 3.1 Implement `ensureWorktreesDir()` - create `.worktrees/` if missing
- [x] 3.2 Implement `ensureGitignore()` - add `.worktrees/` to `.gitignore` if not present
- [x] 3.3 Implement `createWorktree(taskId, baseBranch)` - create worktree and branch
- [x] 3.4 Add validation: check base branch exists, worktree doesn't already exist
- [x] 3.5 Write tests for worktree creation scenarios

## 4. Squash Merge

- [x] 4.1 Implement helper to get base commit for a worktree branch
- [x] 4.2 Implement helper to check if branch has commits beyond base
- [x] 4.3 Implement helper to detect merge conflicts
- [x] 4.4 Implement `squashMerge(taskId, targetBranch, message)` - squash to PR branch
- [x] 4.5 Add cleanup logic to abort merge on conflict (no partial state)
- [x] 4.6 Write tests for squash merge scenarios including conflicts

## 5. Worktree Removal

- [x] 5.1 Implement helper to check for uncommitted changes in worktree
- [x] 5.2 Implement `removeWorktree(taskId)` - remove directory and branch
- [x] 5.3 Write tests for removal scenarios including dirty worktree

## 6. Integration & Polish

- [x] 6.1 Add logging using `@aop/infra` logger
- [x] 6.2 Verify all error messages are clear and actionable
- [x] 6.3 Create README.md explaining the package: purpose, API overview, usage examples, error handling
- [x] 6.4 Run `bun check` and fix any issues

## 7. SRP Refactoring

Extract the monolithic `GitManager` into focused, single-responsibility modules.

- [x] 7.1 Create `git-executor.ts` - Low-level git command execution via `Bun.$` with error handling
- [x] 7.2 Create `branch-ops.ts` - Branch existence checks and validation (uses executor)
- [x] 7.3 Create `metadata.ts` - Worktree metadata save/get/delete operations
- [x] 7.4 Create `worktree-ops.ts` - Worktree create/remove lifecycle (uses executor, branch-ops, metadata)
- [x] 7.5 Create `merge-ops.ts` - Squash merge, conflict detection, abort cleanup (uses executor)
- [x] 7.6 Refactor `git-manager.ts` to thin facade composing the modules (~50 lines)
- [x] 7.7 Update tests to cover individual modules
- [x] 7.8 Update `index.ts` exports - keep public API unchanged
- [x] 7.9 Run `bun check` and verify all tests pass
