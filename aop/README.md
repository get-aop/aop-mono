# AOP - Agents Operating Platform

A platform for orchestrating AI agents. AOP manages agent lifecycle, coordinates task execution, and provides real-time visibility into agent operations.

## Architecture

AOP uses a client-server architecture with a local HTTP server for background task processing:

- **Local Server**: HTTP server that manages task lifecycle and coordinates all background operations
- **Orchestrator**: Initializes and coordinates the watcher, ticker, processor, and remote sync
- **Watcher**: Monitors `openspec/changes/` directories for task file changes
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

- **[Architecture](docs/ARCHITECTURE.md)** - System design, decisions, and build milestones
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
cd aop

# Install dependencies
bun install
```

### Usage

**Start the local server** (required for all operations):
```bash
# Start the local server (run in a separate terminal or as a service)
bun run apps/local-server/src/run.ts

# Or use the dev script which also starts the remote server
bun dev
```

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

**Prerequisites for development:**
- Docker (for PostgreSQL)

**Start the dev environment:**
```bash
# Start all services (PostgreSQL + Server + Local Server)
bun dev

# Start only the database
bun dev --db-only

# Start database and server (no local server)
bun dev --no-cli
```

This orchestrates:
1. PostgreSQL via docker-compose
2. AOP Server with auto-reload (port 3000)
3. AOP Local Server (connected to remote server)

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
| `AOP_SERVER_URL` | URL of the remote AOP server | `https://api.aop.dev` |
| `AOP_API_KEY` | API key for remote server authentication | Optional (enables sync) |

**Remote Server (`apps/server`):**
| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `PORT` | HTTP server port | `3000` |

**Development defaults (set by `bun dev`):**
```bash
AOP_PORT=3847
DATABASE_URL=postgres://aop:aop@localhost:5432/aop
PORT=3000
AOP_SERVER_URL=http://localhost:3000
AOP_API_KEY=aop_test_key_dev
```

## Project Structure

```
apps/
  cli/              # AOP command-line interface (thin HTTP client)
  local-server/     # Local HTTP server (Hono)
    orchestrator/   #   Background services (watcher, queue, sync)
    executor/       #   Agent spawning and execution tracking
    repo/           #   Repository domain
    task/           #   Task domain
    settings/       #   Settings domain
    db/             #   SQLite connection and migrations
  server/           # Remote AOP server (workflow engine, prompt library)
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
