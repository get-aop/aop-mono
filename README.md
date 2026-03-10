# AOP - Agents Operating Platform

A platform for orchestrating AI agents. AOP manages agent lifecycle, coordinates task execution, and provides real-time visibility into agent operations.

## Architecture

AOP uses a client-server architecture with a local HTTP server for background task processing:

- **Local Server**: HTTP server that manages task lifecycle and coordinates all background operations
- **Orchestrator**: Initializes and coordinates the watcher, ticker, and queue processor
- **Watcher**: Monitors `docs/tasks/` directories for task file changes
- **Queue Processor**: Polls for READY tasks and dispatches to executor with concurrency control
- **Executor**: Spawns Claude CLI agents in isolated git worktrees
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
- **[CLI Reference](apps/cli/README.md)** - CLI commands and usage

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.3.6 or later
- Git 2.40+
- Claude CLI (for agent execution)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd <repository-directory>

# Install dependencies
bun install
```

The repository also vendors a minimal repo-local skill bundle under `.claude/skills` and `.codex/skills` so planning and execution workflows do not depend on machine-global installs.

### Usage

**Start the local server** (required for all operations):
```bash
# Start the local server (run in a separate terminal or as a service)
bun run apps/local-server/src/run.ts

# Or use the dev script which starts the local server and dashboard
bun dev
```

**Task creation from Claude/Codex**:
```text
/aop:from-scratch <idea>
/aop:from-ticket <github-issue|linear-ticket|file|pasted-text>
```

Use `/aop:from-scratch` when there is no existing ticket and the agent needs to clarify the work inline.
Use `/aop:from-ticket` when the requirements already exist and you want to skip brainstorming.

**CLI commands** (require local server running):
```bash
# Register a repository for task processing
aop repo:init /path/to/your/repo

# Check server and task status
aop status

# Mark a task as ready for processing
aop task:ready <task-id>

# Remove a task from the backlog
aop task:remove <task-id>

# Get/set configuration
aop config:get [key]
aop config:set <key> <value>
```

### Development

**Start the dev environment:**
```bash
# Start local server and dashboard
bun dev

# Start dashboard only
bun dev --no-local
```

This orchestrates:
1. AOP Local Server with auto-reload
2. Dashboard with HMR

**Other development commands:**
```bash
# Run all quality checks (recommended before committing)
bun check

# Build all packages
bun build
```

**Running tests:**
```bash
bun test          # All unit/integration tests
bun test:e2e      # E2E tests (requires Claude CLI)
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
  llm-provider/     # Claude CLI agent interface
e2e-tests/          # End-to-end tests with real agents
scripts/            # Development scripts
```

## Contribution Guidelines

1. Run `bun check` before creating a PR
2. Keep files under 300 lines, functions under 50 lines
3. Colocate tests with source files
4. Follow TypeScript strict mode
5. Use meaningful commit messages
