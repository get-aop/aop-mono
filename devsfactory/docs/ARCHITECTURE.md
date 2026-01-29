# devsfactory Architecture

## Overview

devsfactory is an orchestration layer that transforms Claude Code into a team of AI agents working in parallel on your codebase. It coordinates multiple agent processes, manages state through markdown files, and isolates work using git worktrees.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              devsfactory                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌───────────────┐     ┌───────────────┐     ┌───────────────────────┐    │
│   │   Dashboard   │◄───►│  Orchestrator │◄───►│    Agent Runner       │    │
│   │  (WebSocket)  │     │  (event loop) │     │   (claude CLI)        │    │
│   └───────────────┘     └───────┬───────┘     └───────────────────────┘    │
│          ▲                      │                         │                 │
│          │                      ▼                         ▼                 │
│          │              ┌───────────────┐         ┌──────────────┐         │
│          │              │    Watcher    │         │ Git Worktrees│         │
│          │              │  (fs.watch)   │         │  (.worktrees)│         │
│          │              └───────┬───────┘         └──────────────┘         │
│          │                      │                                           │
│          │                      ▼                                           │
│          │              ┌─────────────────────────────────┐                │
│          └─────────────►│       .devsfactory/             │                │
│                         │  Task, Plan, Subtask Files      │                │
│                         └─────────────────────────────────┘                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

All state lives in markdown files in `.devsfactory/`. The orchestrator reads state, produces jobs, and the worker executes them through agents that modify the files. The dashboard provides real-time visibility via WebSocket.

## Core Components

### Orchestrator (`src/core/orchestrator.ts`)

The central coordinator that:

- Extends `EventEmitter` for event-driven communication
- Manages the reconciliation loop (event-driven + 15s periodic tick)
- Coordinates Watcher, JobProducer, JobWorker, and AgentRunner
- Handles state transitions and recovery on startup

### Watcher (`src/core/watcher.ts`)

Monitors `.devsfactory/` for file changes using Node's `fs.watch()`:

| File Pattern             | Event Emitted    |
| ------------------------ | ---------------- |
| `{taskFolder}/task.md`   | `taskChanged`    |
| `{taskFolder}/plan.md`   | `planChanged`    |
| `{taskFolder}/NNN-*.md`  | `subtaskChanged` |
| `{taskFolder}/review.md` | `reviewChanged`  |

Debounces events at configurable interval (default: 100ms).

### Job Producer (`src/core/producer/job-producer.ts`)

Analyzes orchestrator state and creates jobs:

- Scans all tasks and subtasks for actionable states
- Checks dependency satisfaction before creating jobs
- Prevents duplicate jobs via queue key checking
- Assigns priority weights from `JOB_PRIORITY` constant

### Job Worker (`src/core/worker/job-worker.ts`)

Processes jobs from the queue:

- Respects `maxConcurrentAgents` limit
- Implements exponential backoff retry: `delay = initialMs × 2^(attempt-1)`
- Emits `jobCompleted`, `jobFailed`, `jobRetrying` events
- Delegates to type-specific handlers

### Agent Runner (`src/core/agent-runner.ts`)

Spawns and manages agent subprocess lifecycle:

- Generates KSUID-based agent IDs (`agent-{ksuid}`)
- Streams stdout/stderr, optionally to log files
- Handles graceful shutdown: SIGTERM → 500ms wait → SIGKILL
- Tracks running processes for registry

### Dashboard Server (`src/core/dashboard-server.ts`)

Web server at `localhost:3001`:

- Serves React dashboard via Bun's HTML imports
- REST API for state queries and status updates
- WebSocket for real-time state broadcasting
- Brainstorming session management API

## State Machines

### Task States

```
                    ┌──────────────────────────────────────────────────────────┐
                    │                                                          │
                    ▼                                                          │
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌────────────┐    ┌────────┐      │
│  DRAFT  │───►│ BACKLOG │───►│ PENDING │───►│ INPROGRESS │───►│ REVIEW │      │
└─────────┘    └─────────┘    └─────────┘    └─────┬──────┘    └────┬───┘      │
                                                   │                │          │
                                                   ▼                ▼          │
                                              ┌─────────┐      ┌────────┐      │
                                              │ BLOCKED │      │  DONE  │──────┘
                                              └─────────┘      └────────┘
```

| Status       | Description                               |
| ------------ | ----------------------------------------- |
| `DRAFT`      | User is still capturing requirements      |
| `BACKLOG`    | Ready but not prioritized for work        |
| `PENDING`    | Ready for orchestrator to start           |
| `INPROGRESS` | Agents actively working on subtasks       |
| `BLOCKED`    | Requires human intervention               |
| `REVIEW`     | All work complete, ready for human review |
| `DONE`       | Completed and merged                      |

### Plan States

```
┌────────────┐    ┌──────────────┐    ┌────────┐
│ INPROGRESS │───►│ AGENT_REVIEW │───►│ REVIEW │
└─────┬──────┘    └──────┬───────┘    └────────┘
      │                  │
      │                  ▼
      │             ┌─────────┐
      └────────────►│ BLOCKED │
                    └─────────┘
```

| Status         | Trigger                                              |
| -------------- | ---------------------------------------------------- |
| `INPROGRESS`   | Subtasks being executed                              |
| `AGENT_REVIEW` | All subtasks DONE, completion-review agent validates |
| `REVIEW`       | Validation passed, ready for human review            |
| `BLOCKED`      | Validation failed after max attempts                 |

### Subtask States

```
┌─────────┐    ┌────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────┐
│ PENDING │───►│ INPROGRESS │───►│ AGENT_REVIEW │───►│ PENDING_MERGE│───►│ DONE │
└─────────┘    └─────┬──────┘    └──────┬───────┘    └───────┬──────┘    └──▲───┘
                     │                  │                    │              │
                     │                  │                    ▼              │
                     │                  │             ┌───────────────┐     │
                     │                  │             │ MERGE_CONFLICT│─────┘
                     │                  │             └───────────────┘
                     │                  │
                     └────────┬─────────┘
                              ▼
                        ┌─────────┐
                        │ BLOCKED │
                        └─────────┘
```

| Status           | Description                                    |
| ---------------- | ---------------------------------------------- |
| `PENDING`        | Waiting for dependencies to complete           |
| `INPROGRESS`     | Implementation agent working                   |
| `AGENT_REVIEW`   | Review agent evaluating changes                |
| `PENDING_MERGE`  | Review passed, ready to merge into task branch |
| `MERGE_CONFLICT` | Merge failed, conflict-solver agent needed     |
| `DONE`           | Successfully merged                            |
| `BLOCKED`        | Needs human intervention                       |

## Agent Lifecycle

### Agent Types

| Agent Type          | Trigger Condition                  | Working Directory | Output                               |
| ------------------- | ---------------------------------- | ----------------- | ------------------------------------ |
| `implementation`    | Subtask INPROGRESS                 | Subtask worktree  | Code changes, status → AGENT_REVIEW  |
| `review`            | Subtask AGENT_REVIEW               | Subtask worktree  | Status → PENDING_MERGE or INPROGRESS |
| `completing-task`   | All subtasks DONE, plan INPROGRESS | Task worktree     | Status → AGENT_REVIEW or 3           |
| `completion-review` | Plan AGENT_REVIEW                  | Task worktree     | Status → REVIEW or BLOCKED           |
| `conflict-solver`   | Subtask MERGE_CONFLICT             | Task worktree     | Resolve conflict, status → DONE      |

### Spawn → Execute → Cleanup Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           Agent Lifecycle                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Job dequeued by JobWorker                                                │
│     │                                                                        │
│     ▼                                                                        │
│  2. Handler creates RunningAgent entry in registry                           │
│     │                                                                        │
│     ▼                                                                        │
│  3. AgentRunner.spawn() generates KSUID, builds command, spawns subprocess   │
│     │                                                                        │
│     ▼                                                                        │
│  4. Subprocess runs claude CLI with prompt                                   │
│     ├── stdout/stderr streamed to log storage                                │
│     └── Agent modifies files in worktree                                     │
│     │                                                                        │
│     ▼                                                                        │
│  5. Process exits                                                            │
│     │                                                                        │
│     ├── Exit 0: Job acknowledged, agent unregistered                         │
│     └── Exit !0: Retry with backoff or permanent failure                     │
│     │                                                                        │
│     ▼                                                                        │
│  6. Watcher detects file changes → scheduleReconcile()                       │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Prompt Templates

Templates live in `src/templates/` as markdown files with `{{variable}}` placeholders:

```markdown
# Implementation Agent

<context>
Read these files before proceeding:
- Subtask: {{subtaskPath}}
- Task context: {{taskDir}}/task.md
</context>
```

The `getTemplate()` function loads and renders templates:

```typescript
// src/templates/index.ts
export const getTemplate = async (
  name: string,
  vars: Record<string, string>,
) => {
  const template = await loadTemplate(name);
  return renderTemplate(template, vars);
};
```

## Job System

### Priority Queue

Jobs are prioritized to finish work before starting new work:

| Job Type            | Priority | Rationale                  |
| ------------------- | -------- | -------------------------- |
| `conflict-solver`   | 40       | Unblock stuck merges first |
| `merge`             | 30       | Complete approved subtasks |
| `completion-review` | 25       | Verify task completion     |
| `review`            | 20       | QA code changes            |
| `completing-task`   | 15       | Check acceptance criteria  |
| `implementation`    | 10       | Start new work (lowest)    |

The `MemoryQueue` dequeues highest priority jobs first.

### Job Types

| Type                | Is Agent Job | Description                    |
| ------------------- | ------------ | ------------------------------ |
| `implementation`    | Yes          | Implement subtask changes      |
| `review`            | Yes          | Review subtask implementation  |
| `merge`             | No           | Git merge operation (no agent) |
| `conflict-solver`   | Yes          | Resolve merge conflicts        |
| `completing-task`   | Yes          | Create completion summary      |
| `completion-review` | Yes          | Validate acceptance criteria   |

### Retry & Backoff

```typescript
// Exponential backoff calculation
const delay = initialMs * Math.pow(2, attempt - 1);
const cappedDelay = Math.min(delay, maxMs);
```

Configuration:

- `RETRY_INITIAL_MS`: 2000ms (2 seconds)
- `RETRY_MAX_MS`: 300000ms (5 minutes)
- `RETRY_MAX_ATTEMPTS`: 5

After max attempts, job fails permanently and is removed from queue.

### Reconciliation Loop

The orchestrator uses event-driven reconciliation with a backup periodic tick:

```typescript
// Event-driven: any watcher event triggers reconcile
this.watcher.on("taskChanged", () => this.scheduleReconcile());
this.watcher.on("planChanged", () => this.scheduleReconcile());
this.watcher.on("subtaskChanged", () => this.scheduleReconcile());

// Periodic tick: every 15 seconds as backup
setInterval(() => this.scheduleReconcile(), 15_000);
```

Reconciliation is debounced—if already reconciling, the next run is queued.

## Git Integration

### Worktree Strategies

#### Simple Setup (Getting Started)

Worktrees live in `.worktrees/` within the project:

```
my-project/
├── .devsfactory/
│   └── add-auth/
├── .worktrees/
│   ├── add-auth/                  # Task worktree
│   └── add-auth--create-model/    # Subtask worktree
└── src/
```

Good for: Solo developers, trying out devsfactory.

#### Bare Repo Setup (Recommended for Teams)

Clone as bare repository, worktrees as siblings:

```
~/projects/
├── my-project.git/                # Bare repo
├── my-project/                    # Main worktree
└── my-project-worktrees/
    ├── add-auth/                  # Task worktree
    └── add-auth--create-model/    # Subtask worktree
```

Configure `WORKTREES_DIR` to point to sibling directory.

### Branch Naming

| Context        | Branch Pattern                    |
| -------------- | --------------------------------- |
| Task branch    | `aop/{taskFolder}`                |
| Subtask branch | `aop/{taskFolder}--{subtaskSlug}` |

Examples:

- `aop/add-user-auth`
- `aop/add-user-auth--create-model`

### Worktree Naming

| Context          | Worktree Path                             |
| ---------------- | ----------------------------------------- |
| Task worktree    | `.worktrees/{taskFolder}/`                |
| Subtask worktree | `.worktrees/{taskFolder}--{subtaskSlug}/` |

The double-dash (`--`) separator distinguishes task folder from subtask slug.

### Merge Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Merge Flow                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Subtask PENDING_MERGE                                                       │
│     │                                                                        │
│     ▼                                                                        │
│  MergeHandler executes git merge                                             │
│     │                                                                        │
│     ├── Success                                                              │
│     │     │                                                                  │
│     │     ├── Delete subtask worktree                                        │
│     │     ├── Set subtask status → DONE                                      │
│     │     └── Record phase timing                                            │
│     │                                                                        │
│     └── Conflict                                                             │
│           │                                                                  │
│           ├── Leave conflict markers in task worktree                        │
│           ├── Set subtask status → MERGE_CONFLICT                            │
│           └── ConflictSolverHandler spawned next cycle                       │
│                 │                                                            │
│                 ├── Success: Complete merge, status → DONE                   │
│                 └── Failure: Retry with backoff                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## File Formats

All of the file templates are inside the `task-planner` skill folder.

- Task file: `./skills/task-planner/templates/task.md`
- Plan file: `./skills/task-planner/templates/plan.md`
- Subtask file: `./skills/task-planner/templates/subtask.md`
- Reviews attempts file: `./skills/task-planner/templates/review-attempts.md`

### Phase Timing

Subtasks track duration for each phase:

| Phase            | Recorded When                 |
| ---------------- | ----------------------------- |
| `implementation` | Implementation job completes  |
| `review`         | Review job completes          |
| `merge`          | Merge job completes           |
| `conflictSolver` | Conflict solver job completes |

## Configuration Reference

All configuration via environment variables (auto-loaded from `.env` by Bun):

| Variable                | Default        | Description                       |
| ----------------------- | -------------- | --------------------------------- |
| `DEVSFACTORY_DIR`       | `.devsfactory` | Task definitions directory        |
| `WORKTREES_DIR`         | `.worktrees`   | Git worktrees directory           |
| `MAX_CONCURRENT_AGENTS` | `2`            | Maximum parallel agent processes  |
| `DASHBOARD_PORT`        | `3001`         | Web dashboard port                |
| `DEBOUNCE_MS`           | `100`          | File watcher debounce (ms)        |
| `RETRY_INITIAL_MS`      | `2000`         | Initial retry backoff (ms)        |
| `RETRY_MAX_MS`          | `300000`       | Maximum retry backoff (5 min)     |
| `RETRY_MAX_ATTEMPTS`    | `5`            | Max retry attempts before failure |
| `DEBUG`                 | `false`        | Enable debug logging              |
| `LOG_MODE`              | `pretty`       | Log format: `pretty` or `json`    |
