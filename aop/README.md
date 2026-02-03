# AOP - Agents Operating Platform

A platform for orchestrating AI agents. AOP manages agent lifecycle, coordinates task execution, and provides real-time visibility into agent operations through a daemon-based background processing system.

## Architecture

AOP uses a daemon-based architecture for background task processing:

- **Daemon**: Long-running background process that manages task lifecycle
- **Watcher**: Monitors `openspec/changes/` directories for task file changes
- **Queue Processor**: Polls for READY tasks and dispatches to executor with concurrency control
- **Executor**: Spawns Claude CLI agents in isolated git worktrees

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Watcher   │────▶│   Queue     │────▶│  Executor   │
│ (fs events) │     │ (READY→WORKING)   │ (agent spawn)│
└─────────────┘     └─────────────┘     └─────────────┘
        │                  │                    │
        └──────────────────┴────────────────────┘
                           │
                    ┌──────▼──────┐
                    │   SQLite    │
                    │ (tasks, repos, executions)
                    └─────────────┘
```

## Documentation

- **[Architecture](docs/ARCHITECTURE.md)** - System design, decisions, and build milestones
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

```bash
# Register a repository for task processing
aop repo:init /path/to/your/repo

# Start the background daemon
aop start

# Check daemon and task status
aop status

# Manually run a specific task (bypasses queue)
aop run <task-id>

# Stop the daemon
aop stop
```

### Development

**Prerequisites for development:**
- Docker (for PostgreSQL)

**Start the dev environment:**
```bash
# Start all services (PostgreSQL + Server + CLI daemon)
bun dev

# Start only the database
bun dev --db-only

# Start database and server (no CLI)
bun dev --no-cli
```

This orchestrates:
1. PostgreSQL via docker-compose
2. AOP Server with auto-reload (port 3000)
3. AOP CLI daemon (connected to local server)

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

**Server (`apps/server`):**
| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `PORT` | HTTP server port | `3000` |

**CLI (`apps/cli`):**
| Variable | Description | Default |
|----------|-------------|---------|
| `AOP_SERVER_URL` | URL of the AOP server | `https://api.aop.dev` |
| `AOP_API_KEY` | API key for server authentication | Optional (enables sync) |

**Development defaults (set by `bun dev`):**
```bash
DATABASE_URL=postgres://aop:aop@localhost:5432/aop
PORT=3000
AOP_SERVER_URL=http://localhost:3000
AOP_API_KEY=aop_test_key_dev
```

## Project Structure

```
apps/
  cli/              # AOP command-line interface
  server/           # AOP REST API server (workflow orchestration)
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
