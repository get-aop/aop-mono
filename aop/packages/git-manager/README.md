# @aop/git-manager

Git worktree lifecycle management for task isolation. Enables parallel agent work through isolated filesystems and clean PR workflows via squash merging.

## Installation

```bash
bun add @aop/git-manager
```

## Usage

```typescript
import { GitManager } from "@aop/git-manager";

const manager = new GitManager({ repoPath: "/path/to/repo" });
await manager.init();

// Create isolated worktree for a task
const worktree = await manager.createWorktree("feat-auth", "main");
// worktree.path = "/path/to/repo/.worktrees/feat-auth"
// worktree.branch = "feat-auth"
// worktree.baseBranch = "main"
// worktree.baseCommit = "abc123..."

// After work is done, squash merge to a PR branch
const result = await manager.squashMerge("feat-auth", "pr/feat-auth", "feat: add authentication");
// result.targetBranch = "pr/feat-auth"
// result.commitSha = "def456..."

// Clean up when done
await manager.removeWorktree("feat-auth");
```
