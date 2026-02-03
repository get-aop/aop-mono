## Why

Agents working on tasks need isolated workspaces to avoid conflicts when multiple tasks run in parallel. Git worktrees provide real filesystem isolation without the overhead of cloning, and enable clean PR workflows through squash merging.

## What Changes

- New `packages/git-manager` package providing git worktree operations
- `createWorktree(taskId, baseBranch)` - Creates isolated workspace at `.worktrees/<taskId>`
- `squashMerge(taskId, targetBranch, message)` - Squash merges work into a PR branch
- `removeWorktree(taskId)` - Cleans up worktree and work branch
- Auto-initialization of `.worktrees/` directory and `.gitignore` entry on first use
- **SRP Architecture:** Decomposed into focused modules (git-executor, branch-ops, worktree-ops, merge-ops, metadata) with thin facade

## Capabilities

### New Capabilities

- `git-manager`: Git worktree lifecycle management for task isolation - create, squash merge, and remove worktrees

### Modified Capabilities

<!-- None - this is a new package with no changes to existing specs -->

## Impact

- **New package:** `packages/git-manager` with TypeScript source and tests
- **Filesystem convention:** `.worktrees/` directory in repo root (gitignored)
- **Dependencies:** None beyond Bun's built-in `Bun.$` for git commands
- **Consumers:** Orchestrator and CLI will use this to manage agent workspaces
