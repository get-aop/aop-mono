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

1. **Create a task** using one of these methods:
   - CLI: `aop create-task "add user authentication"`
   - Claude Code skill: `/create-task add user authentication`
   - Dashboard: Open `http://localhost:3001` and click "New Task"
2. **Run the orchestrator**: `aop run` — starts watching for tasks
3. **Agents implement** subtasks in parallel (respecting dependencies)
4. **Each subtask** goes through: Implementation → Review → Merge
5. **Completion review** verifies acceptance criteria when all subtasks are done
6. **Task moves to REVIEW** status, ready for human approval and PR

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

### Register Your Project

```bash
# Navigate to your project (must be a git repository)
cd /path/to/my-project

# Register it with AOP
aop init
```

### Create Your First Task

```bash
# Option 1: Via CLI (interactive Claude session)
aop create-task "Add user authentication with JWT tokens"

# Option 2: Via dashboard
aop run   # Opens dashboard at http://localhost:3001
# Then click "New Task" in the dashboard
```

### Start the Orchestrator

```bash
# Run from anywhere (auto-detects project from cwd)
aop

# Or specify project by name
aop run my-project
```

This will:
- Create `.devsfactory/` directory if needed
- Start the file watcher for task changes
- Launch the dashboard at `http://localhost:3001`
- Open the dashboard in your browser
- Begin processing any PENDING tasks

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

## CLI Reference

The `aop` command provides project management, orchestration, and task creation capabilities.

```bash
aop [command] [options]
```

### Global Options

| Option | Description |
|--------|-------------|
| `-h, --help` | Show help message |
| `-v, --version` | Show version number |

### Commands Overview

| Command | Description |
|---------|-------------|
| `init` | Register a git repository with AOP |
| `projects` | List and manage registered projects |
| `status` | Show task status across projects |
| `run` | Run the orchestrator (default command) |
| `stats` | Export timing statistics |
| `create-task` | Create a new task via Claude Code |
| `sys-debug` | Debug an issue via Claude Code |

---

### `aop init`

Register a git repository with AOP for global access.

```bash
aop init [path]
```

**Arguments:**
- `path` — Path to the git repository (default: current directory)

**Examples:**
```bash
aop init                    # Register current directory
aop init /path/to/my-repo   # Register a specific repository
```

After registration, you can run `aop` from anywhere and specify the project by name.

---

### `aop projects`

List and manage registered projects.

```bash
aop projects [subcommand] [name]
```

**Subcommands:**
- `(none)` — List all registered projects
- `remove <name>` — Unregister a project

**Examples:**
```bash
aop projects                # List all projects
aop projects remove my-app  # Unregister 'my-app'
```

**Output example:**
```
Registered projects:

  my-app        /home/user/projects/my-app
  backend-api   /home/user/projects/backend-api
  frontend      /home/user/projects/frontend

3 projects registered
```

---

### `aop status`

Show task status for one or more projects.

```bash
aop status [project]
```

**Arguments:**
- `project` — Project name (optional)
  - If omitted and you're in a project directory: shows that project
  - If omitted and not in a project: shows all projects summary

**Examples:**
```bash
aop status              # Show current project or all projects
aop status my-app       # Show detailed status for 'my-app'
```

**Output includes:**
- Task counts by status (PENDING, INPROGRESS, DONE)
- Detailed task list with progress for in-progress tasks
- Subtask completion percentages

---

### `aop run`

Start the orchestrator to process tasks. This is the default command when running `aop` without arguments.

```bash
aop run [project] [options]
aop [project]              # Shorthand (run is default)
```

**Arguments:**
- `project` — Project name (default: auto-detect from current directory)

**Options:**
- `-a, --all` — Run orchestrator for all registered projects

**Examples:**
```bash
aop                      # Run for current project (auto-detect)
aop run                  # Same as above
aop run my-app           # Run for a specific project
aop my-app               # Shorthand for above
aop run --all            # Run for all registered projects
```

**What happens:**
1. Creates `.devsfactory/` directory if needed
2. Starts the file watcher for task changes
3. Launches the web dashboard at `http://localhost:3001`
4. Processes tasks: planning, implementation, review, merge
5. Opens the dashboard in your browser

**With environment overrides:**
```bash
MAX_CONCURRENT_AGENTS=4 DEBUG=true aop run
```

---

### `aop stats`

Export timing statistics for a completed task as JSON.

```bash
aop stats <task-folder>
```

**Arguments:**
- `task-folder` — Name of the task folder in `.devsfactory/`

**Examples:**
```bash
aop stats add-authentication
aop stats fix-login-bug > stats.json
```

**Output includes:**
- Total task duration
- Per-subtask timing breakdown
- Agent execution times
- Review and merge durations

---

### `aop create-task`

Create a new task by launching an interactive Claude Code session that brainstorms requirements and generates subtasks.

```bash
aop create-task <description> [options]
```

**Arguments:**
- `description` — Task description (use quotes for multi-word descriptions)

**Options:**
- `-p, --project <name>` — Project name (default: auto-detect from cwd)
- `-s, --slug <name>` — Custom slug for the task folder name

**Examples:**
```bash
aop create-task "Add user authentication with JWT"
aop create-task "Fix the login bug" -p my-app
aop create-task "Implement dark mode" --slug dark-mode
aop create-task "Refactor database layer to use connection pooling"
```

**What happens:**
1. Spawns Claude Code with the `/create-task` skill
2. Claude brainstorms with you to clarify requirements
3. Generates `task.md` with description and acceptance criteria
4. Creates numbered subtask files with dependencies
5. Task is ready for the orchestrator to process

---

### `aop sys-debug`

Launch a systematic debugging session via Claude Code to investigate and fix issues.

```bash
aop sys-debug <description> [options]
```

**Arguments:**
- `description` — Bug or issue description (use quotes for details)

**Options:**
- `-p, --project <name>` — Project name (default: auto-detect from cwd)

**Examples:**
```bash
aop sys-debug "Tests are failing with timeout errors"
aop sys-debug "Login page crashes on submit" -p my-app
aop sys-debug "Memory leak in the dashboard component"
aop sys-debug "API returns 500 error on user registration"
```

**What happens:**
1. Spawns Claude Code with the `/systematic-debugging` skill
2. Claude investigates the issue methodically
3. Identifies root cause through code analysis
4. Proposes and implements fixes
5. Verifies the fix resolves the issue

---

### Workflow Examples

**Setting up a new project:**
```bash
cd /path/to/my-project
aop init                           # Register the project
aop create-task "Add user login"   # Create first task
aop                                # Start orchestrator
```

**Working with multiple projects:**
```bash
aop projects                       # See all projects
aop status                         # Quick status of all
aop status backend-api             # Detailed status of one
aop run backend-api                # Run orchestrator for specific project
```

**Quick debugging session:**
```bash
aop sys-debug "Users can't upload files larger than 1MB"
```

**Creating a task from a GitHub issue:**
```bash
aop create-task "Implement feature from GitHub issue #42"
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
