## Why

The CLI daemon has evolved into a complex process manager (watcher, ticker, processor, executor), and the roadmap requires serving a local dashboard for users on their machines. Rather than maintaining a custom daemon alongside a future HTTP server, unifying into a single Hono-based local server simplifies the architecture—one long-running process that handles both HTTP requests and background services.

## What Changes

- **BREAKING**: Replace custom daemon with Hono server in a new `apps/local-server/` app
- **BREAKING**: Remove `aop start` and `aop stop` commands (server is started/stopped externally via systemd, launchd, Docker, or manual `bun run`)
- **BREAKING**: Remove `aop task:run` command (POC feature, no longer needed)
- **BREAKING**: CLI commands require local server running - no offline fallback
- CLI commands (`status`, `task:ready`, `task:remove`, `repo:*`, `config:*`) become thin HTTP clients posting to the local server
- Orchestrator (watcher, ticker, processor, executor, remote sync) runs within the local server process
- Simplify lifecycle management: port-based detection replaces PID file management
- Port configured via `AOP_PORT` environment variable (default: 3847)
- Add foundation for serving a local dashboard (future)

## Capabilities

### New Capabilities

- `local-server`: Hono-based HTTP server that hosts the API, runs the orchestrator (watcher, ticker, processor, executor, remote sync), and will serve the dashboard. Includes health/status endpoints and task/repo management endpoints. Handles SIGTERM for graceful shutdown.

### Modified Capabilities

- `cli-commands`: Commands no longer interact directly with the daemon. Instead, they POST/GET to the local server's HTTP API. All commands require the local server to be running. Removed: `start`, `stop`, `task:run`.
- `local-workflow-runner`: Queue processor, watcher, and executor continue to function the same way but run inside the local server process rather than a standalone daemon.

## Impact

- **Code**: New `apps/local-server/` app with Hono routes + background service initialization
- **Code**: `apps/cli/src/daemon/` removed entirely
- **Code**: All CLI commands in `apps/cli/src/commands/` updated to use HTTP client
- **Code**: `pid-utils.ts` removed—server detection via health check
- **Dependencies**: Add `hono` to `apps/local-server/package.json`
- **User experience**: Users start server manually or via service manager. CLI commands error if server not running.
- **Future**: Enables serving React dashboard from the same process
