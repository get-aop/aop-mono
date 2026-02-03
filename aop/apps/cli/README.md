# @aop/cli

Command-line interface for the Agents Operating Platform. Manages daemon lifecycle, repository registration, task execution, and configuration.

## Installation

```bash
# From repository root
bun install

# Run directly
bun apps/cli/src/main.ts <command>

# Or build and install globally
cd apps/cli && bun run build
```

## Commands

### Daemon Commands

```bash
aop start                     # Start the background daemon
aop stop                      # Stop the daemon gracefully
aop status                    # Show daemon and task overview
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
aop task:run <task-id|path>   # Run task manually (bypasses queue)
aop run <task-id|path>        # Alias for task:run
aop apply <task-id>           # Apply worktree changes to main repo
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
| `max_concurrent_tasks` | 3 | Global max concurrent task executions |
| `agent_timeout_secs` | 600 | Timeout for agent execution (10 min) |
| `queue_poll_interval_secs` | 5 | Queue processor polling interval |
| `watcher_poll_interval_secs` | 30 | File watcher reconciliation interval |

## Architecture

The CLI is organized into modules:

```
src/
  commands/       # CLI command handlers
  daemon/         # Daemon lifecycle (start, stop, run)
  db/             # SQLite connection, migrations, schema
  executions/     # Execution tracking store
  executor/       # Agent spawning and timeout management
  prompt/         # Prompt template rendering
  queue/          # Queue processor with concurrency control
  repos/          # Repository store
  settings/       # Settings store
  tasks/          # Task store with status transitions
  templates/      # Handlebars prompt templates
  watcher/        # File system watcher and reconciliation
```

### Daemon Components

- **Daemon**: Orchestrates watcher, ticker, and queue processor
- **Watcher**: Monitors `openspec/changes/` for file changes (debounced)
- **Ticker**: Periodic reconciliation of task states
- **Queue Processor**: Polls READY tasks and dispatches execution
- **Executor**: Creates worktree, runs Claude agent, tracks output

### Task Lifecycle

```
DRAFT → READY → WORKING → DONE
                    ↓
                 BLOCKED
```

1. **DRAFT**: Task discovered via watcher, not yet ready for execution
2. **READY**: Task queued for execution (set via `aop task:ready`)
3. **WORKING**: Agent actively executing in worktree
4. **DONE**: Execution completed successfully
5. **BLOCKED**: Execution failed or timed out

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AOP_LOG_LEVEL` | Log level: `debug`, `info`, `warning`, `error`, `fatal` (default: `info`) |
| `AOP_LOG_DIR` | Directory for log files (enables file logging) |
| `AOP_PID_FILE` | Custom PID file path (default: `~/.aop/aop.pid`) |
| `AOP_DB_PATH` | Custom database path (default: `~/.aop/aop.db`) |

## Database

SQLite database stored at `~/.aop/aop.db` with tables:

- `repos`: Registered repositories
- `tasks`: Task records with status tracking
- `executions`: Execution history
- `step_executions`: Per-step execution details (agent PID, session ID)
- `settings`: Configuration key-value store

## Scripts

```bash
bun run build      # Build to dist/
bun run dev        # Run with watch mode
bun run test       # Run unit tests
bun run typecheck  # TypeScript type checking
```
