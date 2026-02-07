# @aop/local-server

Local HTTP server for the Agents Operating Platform. Manages task lifecycle, coordinates background operations, and provides the REST API for CLI and future dashboard.

## Quick Start

```bash
# Start the server
bun run apps/local-server/src/run.ts

# Or with dev mode (auto-reload)
cd apps/local-server && bun run dev
```

The server listens on `http://127.0.0.1:3847` by default.

## Architecture

The local server is a Hono HTTP server. All background work (watching, processing, executing) runs in the same process.

```
┌────────────────────────────────────────────────────────────┐
│                    Local Server (Hono)                      │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Orchestrator                       │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │   │
│  │  │ Watcher  │  │  Ticker  │  │ Queue Processor  │   │   │
│  │  │(fs events│  │(periodic │  │ (polls READY     │   │   │
│  │  │ debounce)│  │ reconcile│  │  tasks)          │   │   │
│  │  └──────────┘  └──────────┘  └──────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────▼─────────────────────────┐     │
│  │                     Executor                       │     │
│  │  (spawns Claude CLI agents in git worktrees)      │     │
│  └───────────────────────────────────────────────────┘     │
│                            │                                │
│  ┌─────────────────────────▼─────────────────────────┐     │
│  │                     SQLite                         │     │
│  │  (repos, tasks, executions, settings)             │     │
│  └───────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────┘
                             │
                        REST API
                             │
              ┌──────────────┴──────────────┐
              │                             │
         ┌────▼────┐                 ┌──────▼──────┐
         │   CLI   │                 │  Dashboard  │
         │ (client)│                 │  (future)   │
         └─────────┘                 └─────────────┘
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check (uptime, db status, orchestrator status) |
| `/api/status` | GET | Full server status (repos, tasks, capacity) |
| `/api/refresh` | POST | Trigger immediate reconciliation |
| `/api/repos` | POST | Register a repository |
| `/api/repos/:id` | DELETE | Remove a repository |
| `/api/repos/:id/tasks` | GET | List tasks for a repository |
| `/api/repos/:id/tasks/:taskId/ready` | POST | Mark task as READY |
| `/api/repos/:id/tasks/:taskId/apply` | POST | Apply worktree changes to main repo |
| `/api/repos/:id/tasks/:taskId` | DELETE | Remove a task |
| `/api/tasks/resolve/:identifier` | GET | Resolve task by id/name/index |
| `/api/settings` | GET | Get all settings |
| `/api/settings/:key` | GET | Get single setting |
| `/api/settings/:key` | PUT | Set setting value |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AOP_PORT` | HTTP server port | `3847` |
| `AOP_DB_PATH` | SQLite database path | `~/.aop/aop.db` |
| `AOP_LOG_LEVEL` | Log level (debug, info, warning, error) | `info` |
| `AOP_SERVER_URL` | Remote AOP server URL (for sync) | - |
| `AOP_API_KEY` | API key for remote server | - |

## Directory Structure

```
src/
  app.ts                # Hono app and route registration
  run.ts                # Entry point (server + orchestrator startup)
  config.ts             # Environment config
  context.ts            # Request context with db and services
  db/                   # SQLite connection, migrations, schema
  executor/             # Agent spawning, execution tracking, abort handling
  orchestrator/         # Background services coordination
    orchestrator.ts     # Main orchestrator (start/stop)
    watcher/            # File system watching and reconciliation
    queue/              # Task queue processor
    sync/               # Remote server sync
  repo/                 # Repository domain (handlers, routes, repository)
  task/                 # Task domain (handlers, routes, repository, resolve)
  settings/             # Settings domain (handlers, routes, repository)
  status/               # Status endpoint handlers
```

## Task Lifecycle

```
DRAFT → READY → WORKING → DONE
                    ↓
                 BLOCKED
```

1. **DRAFT**: Task discovered via watcher, not yet ready for execution
2. **READY**: Task queued for execution (set via API)
3. **WORKING**: Agent actively executing in worktree
4. **DONE**: Execution completed successfully
5. **BLOCKED**: Execution failed or timed out

## Database

SQLite database stored at `~/.aop/aop.db` (configurable via `AOP_DB_PATH`):

| Table | Description |
|-------|-------------|
| `repos` | Registered repositories |
| `tasks` | Task records with status tracking |
| `executions` | Execution history |
| `step_executions` | Per-step execution details (agent PID, session ID) |
| `settings` | Configuration key-value store |

## Graceful Shutdown

The server handles SIGTERM and SIGINT for graceful shutdown:

1. Stop orchestrator (watcher, ticker, processor)
2. Wait for executing tasks to complete (with timeout)
3. Close HTTP server
4. Close database connection

## Running as a Service

### macOS (launchd)

Create `~/Library/LaunchAgents/com.aop.local-server.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.aop.local-server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/bun</string>
        <string>run</string>
        <string>/path/to/aop/apps/local-server/src/run.ts</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/aop-local-server.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/aop-local-server.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.aop.local-server.plist
```

### Linux (systemd)

Create `~/.config/systemd/user/aop-local-server.service`:

```ini
[Unit]
Description=AOP Local Server
After=network.target

[Service]
Type=simple
ExecStart=/path/to/bun run /path/to/aop/apps/local-server/src/run.ts
Restart=always

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable aop-local-server
systemctl --user start aop-local-server
```

## Scripts

```bash
bun run build      # Build to dist/
bun run dev        # Run with watch mode (auto-reload)
bun run test       # Run unit tests
bun run typecheck  # TypeScript type checking
```
