# @aop/cli

Command-line interface for the Agents Operating Platform. A thin HTTP client that communicates with the local server for all operations.

## Installation

```bash
# From repository root
bun install

# Run directly
bun apps/cli/src/main.ts <command>

# Or build and install globally
cd apps/cli && bun run build
```

## Prerequisites

The CLI requires a running local server. Start it before using any commands:

```bash
bun run apps/local-server/src/run.ts
```

If the server is not running, all commands will exit with an error message.

## Commands

### Status

```bash
aop status                    # Show server and task overview
aop status <task-id>          # Show specific task details
aop status --json             # Output status as JSON
```

### Repository Commands

```bash
aop repo:init [path]          # Register a repository (defaults to cwd)
aop repo:remove [path]        # Unregister a repository
```

### Task Commands

```bash
aop task:ready <task-id>      # Mark task as READY for execution
aop task:remove <task-id>     # Remove task from backlog
```

### Configuration Commands

```bash
aop config:get                # List all configuration values
aop config:get <key>          # Get specific config value
aop config:set <key> <value>  # Set config value
```

**Available settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `max_concurrent_tasks` | 3 | Max concurrent task executions |
| `agent_timeout_secs` | 600 | Timeout for agent execution (10 min) |
| `queue_poll_interval_secs` | 5 | Queue processor polling interval |
| `watcher_poll_interval_secs` | 30 | File watcher reconciliation interval |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AOP_URL` | URL of the local server | `http://localhost:3847` |
| `AOP_PORT` | Port for local server (if `AOP_URL` not set) | `3847` |

## Architecture

The CLI is a thin HTTP client. All business logic runs in the local server.

```
┌─────────────┐     HTTP      ┌─────────────────┐
│    CLI      │ ───────────▶  │  Local Server   │
│ (commands)  │               │ (orchestrator,  │
└─────────────┘               │  db, executor)  │
                              └─────────────────┘
```

```
src/
  commands/       # CLI command handlers (HTTP clients)
    client.ts     # Server connection helpers
    status.ts     # GET /api/status
    repo-init.ts  # POST /api/repos
    ...
  main.ts         # Entry point with command registration
```

## Scripts

```bash
bun run build      # Build to dist/
bun run dev        # Run with watch mode
bun run test       # Run unit tests
bun run typecheck  # TypeScript type checking
```
