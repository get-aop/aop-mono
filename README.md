# AOP - Agents Operating Platform

AOP is a local-first platform for planning, queuing, and executing agent-driven tasks from repo-local task documents. It runs a local server, watches `docs/tasks/`, creates isolated git worktrees, executes tasks through configured LLM CLIs, and automatically hands completed work back to the main repository.

## Architecture

AOP uses a client-server architecture with a local HTTP server for background task processing:

- **Local Server**: HTTP server that manages task lifecycle and coordinates all background operations
- **Orchestrator**: Initializes and coordinates the watcher, ticker, and queue processor
- **Watcher**: Monitors `docs/tasks/` directories for task file changes
- **Queue Processor**: Polls for READY tasks and dispatches to executor with concurrency control
- **Executor**: Spawns configured agent CLIs in isolated git worktrees
- **CLI**: Thin client that communicates with the local server via REST API

```
┌─────────────────────────────────────────────────────────────────┐
│                     Local Server (HTTP)                          │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐        │
│  │   Watcher   │────▶│   Queue     │────▶│  Executor   │        │
│  │ (fs events) │     │ (processor) │     │ (agent spawn)│       │
│  └─────────────┘     └─────────────┘     └─────────────┘        │
│          │                  │                    │               │
│          └──────────────────┴────────────────────┘               │
│                             │                                    │
│                      ┌──────▼──────┐                             │
│                      │   SQLite    │                             │
│                      └─────────────┘                             │
└──────────────────────────────┬──────────────────────────────────┘
                               │ REST API
                        ┌──────▼──────┐
                        │   CLI       │
                        │ (thin client)│
                        └─────────────┘
```

## Documentation

- **[Workflow](docs/WORKFLOW.md)** - Task document workflow and execution model
- **[Local Server](apps/local-server/README.md)** - HTTP server, orchestrator, and API reference
- **[CLI Reference](apps/cli/README.md)** - thin-client command reference

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.3.8 or later
- Git 2.40+
- At least one supported agent CLI installed locally. Current providers in this repo include `codex` and `claude-code`.

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd <repository-directory>

# Install dependencies
bun install
```

The repository also vendors repo-local skill bundles under `.claude/skills` and `.codex/skills` so planning and execution workflows do not depend on machine-global installs.

### Usage

**Start the local server**:
```bash
# Start the local server
bun run apps/local-server/src/run.ts

# Or start the local server and dashboard together
bun dev
```

**Register the current repository once**:
```bash
aop repo:init .
```

**Create task docs from Claude/Codex commands**:
```text
/aop:from-scratch <idea>
/aop:from-ticket <github-issue|linear-ticket|file|pasted-text>
```

`/aop:from-scratch` runs the AOP brainstorming flow, writes the task under `docs/tasks/<task-slug>/`, and can mark it `READY` at the end.

`/aop:from-ticket` skips brainstorming, writes the task from existing requirements, and can also mark it `READY` at the end.

Once a task is `READY`, the orchestrator picks it up automatically.

The CLI still exists, but the main product flow is:
1. Start the local server
2. Register the repo
3. Create or update task docs under `docs/tasks/`
4. Mark tasks `READY`
5. Let the orchestrator execute and hand off completed work automatically

The most commonly used CLI commands are:
```bash
aop status
aop task:ready <task-id>
```

For the full command surface, see the dedicated CLI reference.

## Execution Model

Task state lives in `docs/tasks/<task-slug>/`.

The normal lifecycle is:

```text
DRAFT -> READY -> WORKING -> DONE
                     |
                     -> BLOCKED
```

When a task starts, AOP creates a worktree under `.aop/worktrees/` from the main branch and uses a task-derived branch name. When a task reaches `DONE`, AOP automatically hands the worktree changes back into the main repository branch and removes the temporary worktree. `BLOCKED` tasks are preserved for inspection and retry.

By default, AOP uses Codex as the local agent provider when `codex` is available.

### Development

**Start the dev environment:**
```bash
# Start local server and dashboard
bun dev

# Start dashboard only
bun dev --no-local
```

This starts:
1. AOP local server with auto-reload
2. Dashboard with HMR

**Other development commands:**
```bash
# Build all packages
bun build

# Type-check the workspaces
bun run typecheck
```

**Running tests:**
```bash
bun test          # All unit/integration tests
bun test:e2e      # E2E tests (requires a supported agent CLI)
bun test:coverage # Tests with coverage report
```

### Environment Variables

**Local Server (`apps/local-server`):**
| Variable | Description | Default |
|----------|-------------|---------|
| `AOP_PORT` | Port for the local HTTP server | `3847` |

**CLI (`apps/cli`):**
| Variable | Description | Default |
|----------|-------------|---------|
| `AOP_URL` | URL of the local server | `http://localhost:3847` |
| `AOP_PORT` | Port for local server (if `AOP_URL` not set) | `3847` |

**Development defaults (set by `bun dev`):**
```bash
AOP_PORT=3847
```

## Project Structure

```
apps/
  cli/              # AOP command-line interface (thin HTTP client)
  dashboard/        # Web dashboard for local status and task management
  local-server/     # Local HTTP server (Hono)
    orchestrator/   #   Background services (watcher, queue)
    executor/       #   Agent spawning and execution tracking
    repo/           #   Repository domain
    task/           #   Task domain
    settings/       #   Settings domain
    db/             #   SQLite connection and migrations
packages/
  common/           # Shared types (Task, TaskStatus, protocol schemas)
  git-manager/      # Git worktree lifecycle management
  infra/            # Logging, TypeID utilities
  llm-provider/     # Agent CLI provider interfaces and log parsing
e2e-tests/          # End-to-end tests with real agents
scripts/            # Development scripts
```

## Contribution Guidelines

1. Run the relevant tests for the area you changed
2. Keep files under 300 lines, functions under 50 lines
3. Colocate tests with source files
4. Follow TypeScript strict mode
5. Use meaningful commit messages
