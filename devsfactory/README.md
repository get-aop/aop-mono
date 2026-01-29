# devsfactory

Turn Claude Code into a dev team.

## What is devsfactory?

devsfactory is an orchestration layer that transforms Claude Code into a team of AI agents working in parallel on your codebase. You define a task, devsfactory breaks it into subtasks, and multiple agents implement them concurrently—each in isolated git worktrees to avoid conflicts.

## Features

- **Parallel agent execution** — Run multiple agents simultaneously (configurable concurrency)
- **Automatic task breakdown** — Tasks are split into subtasks with dependency management
- **Git worktree isolation** — Each agent works in its own worktree, no merge conflicts during development
- **Auto-merge with conflict resolution** — Completed subtasks merge automatically; a conflict-solver agent handles any conflicts
- **Real-time web dashboard** — Monitor progress, view logs, and manage tasks at `localhost:3001`
- **Priority-based scheduling** — Finishing work takes precedence over starting new work
- **Crash recovery** — State lives in markdown files; restart and pick up where you left off

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                         TASK                                │
│  .devsfactory/my-feature/task.md                            │
│  Status: PENDING → INPROGRESS → REVIEW → DONE               │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                         PLAN                                │
│  .devsfactory/my-feature/plan.md                            │
│  Created by: task-planner skill (human-driven brainstorm)   │
└─────────────────────────────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   Subtask 001   │ │   Subtask 002   │ │   Subtask 003   │
│   (parallel)    │ │ (depends on 001)│ │ (depends on 002)│
│                 │ │                 │ │                 │
│ Implementation  │ │ Implementation  │ │ Implementation  │
│      ↓          │ │      ↓          │ │      ↓          │
│    Review       │ │    Review       │ │    Review       │
│      ↓          │ │      ↓          │ │      ↓          │
│    Merge        │ │    Merge        │ │    Merge        │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

**The workflow:**

1. Create a task using your agent (eg Claude Code), like so:
   - `/new-task gh issue #123`
   - `/new-task add user authentication`
   - the `/new-task` skill will brainstorm with you to define the task and plan teh subtasks.
   - you can also use the interactive dashboard brainstorming session to do this!
2. Run `aop` — the orchestrator starts watching for tasks
3. Agents implement subtasks in parallel (respecting dependencies)
4. Each subtask goes through: Implementation → Review → Merge
5. When all subtasks are done, a completion review verifies acceptance criteria
6. Task moves to REVIEW status, ready for human approval and PR

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.0 or later
- [Git](https://git-scm.com/)
- [Claude CLI](https://github.com/anthropics/claude-code)

### Installation

```bash
# Clone the repository
git clone https://github.com/get-aop/aop.git
cd devsfactory

# Install dependencies
bun install

# Link globally (makes 'aop' command available)
bun link
```

### Start the Orchestrator

```bash
# From your project root (must be a git repository)
aop
```

This will:

- Create `.devsfactory/` if it doesn't exist
- Start the file watcher
- Launch the dashboard at `http://localhost:3001`

### Create Your First Task

You can create a task using the `/new-task` skill on your agent or open the dashboard at `http://localhost:3001` for an interactive brainstorming session:

1. Open the dashboard at `http://localhost:3001`
2. Click "New Task" to start the task creation wizard
3. Once the task is planned and moved to `PENDING` the orchestrator will detect and work on the subtasks.

## Configuration

Configuration is read from environment variables. Create a `.env` file in your project root:

```bash
cp .env.example .env
```

### Environment Variables

| Variable                | Default        | Description                    |
| ----------------------- | -------------- | ------------------------------ |
| `DEVSFACTORY_DIR`       | `.devsfactory` | Task definitions directory     |
| `WORKTREES_DIR`         | `.worktrees`   | Git worktrees directory        |
| `MAX_CONCURRENT_AGENTS` | `2`            | Maximum parallel agents        |
| `DASHBOARD_PORT`        | `3001`         | Dashboard server port          |
| `DEBOUNCE_MS`           | `100`          | File watcher debounce (ms)     |
| `RETRY_INITIAL_MS`      | `2000`         | Initial retry backoff (ms)     |
| `RETRY_MAX_MS`          | `300000`       | Maximum retry backoff (5 min)  |
| `RETRY_MAX_ATTEMPTS`    | `5`            | Maximum retry attempts         |
| `DEBUG`                 | `false`        | Enable debug logging           |
| `LOG_MODE`              | `pretty`       | Log format: `pretty` or `json` |

## Tasks

Tasks are markdown files with YAML frontmatter:

```markdown
---
title: string # Task title
status: PENDING # DRAFT | BACKLOG | PENDING | INPROGRESS | BLOCKED | REVIEW | DONE
created: 2026-01-28 # ISO date
priority: high # high | medium | low
tags: [string] # Optional tags
assignee: null # Optional assignee
dependencies: [] # Other task folders this depends on
---

## Description

What needs to be done.

## Requirements

Specific requirements.

## Acceptance Criteria

- [ ] Checkbox items for verification
```

**Task statuses:**

- `DRAFT` — Work in progress, not ready for agents
- `BACKLOG` — Ready but not prioritized
- `PENDING` — Ready for planning
- `INPROGRESS` — Agents are working on subtasks
- `BLOCKED` — Requires human intervention
- `REVIEW` — All work complete, ready for human review
- `DONE` — Completed and merged

## Commands

```bash
# Start orchestrator with defaults
aop

# Show help
aop --help

# Show version
aop --version

# Start with custom config
MAX_CONCURRENT_AGENTS=4 DEBUG=true aop

# Export timing statistics for a task
aop stats my-task-folder
```

## Development

```bash
# Run unit tests
bun test src/

# Run e2e tests
bun run test:e2e

# Type checking
bun run typecheck

# Linting
bun run lint
bun run lint:fix

# Build
bun run build
```

## Links

- [ARCHITECTURE.md](./docs/ARCHITECTURE.md) — Technical deep-dive into the system design
- [RUNBOOK.md](./docs/RUNBOOK.md) — Troubleshooting and recovery guide
