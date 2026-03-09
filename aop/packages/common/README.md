# @aop/common

Shared types and constants used across AOP packages.

## Contents

- **Task**: Core task type representing an agent work unit with status tracking
- **TaskStatus**: Enum for task lifecycle states

## TaskStatus

| Status | Description |
|--------|-------------|
| `DRAFT` | Task discovered but not ready for execution |
| `READY` | Task queued for execution |
| `WORKING` | Agent actively executing in worktree |
| `BLOCKED` | Execution failed or timed out |
| `DONE` | Execution completed successfully |
| `REMOVED` | Task deleted (change directory removed) |

## Usage

```typescript
import { Task, TaskStatus } from "@aop/common";

const task: Task = {
  id: "task_abc123",
  repoId: "repo_xyz",
  changePath: "docs/tasks/my-feature",
  worktreePath: null,
  status: TaskStatus.READY,
  readyAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Check status
if (task.status === TaskStatus.WORKING) {
  console.log("Task is being processed");
}
```

## Scripts

```bash
bun run build      # Build the package
bun run typecheck  # Run TypeScript type checking
```
