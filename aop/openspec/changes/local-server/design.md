## Context

The AOP CLI currently uses a custom daemon architecture with:
- PID file management (`~/.aop/aop.pid`) for lifecycle tracking
- Signal-based communication (SIGTERM for stop, SIGUSR1 for refresh)
- A `DaemonInstance` class that orchestrates watcher, ticker, processor, and executor
- CLI commands that interact via PID utilities and direct process signals

This works but creates complexity:
1. Custom process management code (pid-utils, signal handlers)
2. No HTTP interface for future dashboard
3. Tight coupling between CLI commands and daemon internals

The roadmap requires serving an internal dashboard. Rather than bolt HTTP onto the daemon, we unify into a single Hono server that handles both HTTP requests and background services.

## Goals / Non-Goals

**Goals:**
- Replace daemon with Hono server listening on `localhost:<port>`
- CLI commands become HTTP clients (`fetch` to server endpoints)
- Preserve all existing functionality (watcher, ticker, processor, executor)
- Simplify lifecycle: port check replaces PID file management
- Enable future dashboard serving from the same process

**Non-Goals:**
- Implementing the dashboard UI (future work)
- Changing the remote server sync protocol
- Modifying the executor/workflow logic
- Supporting multiple simultaneous local servers

## Decisions

### 1. Server Framework: Hono

**Decision**: Use Hono with `Bun.serve()`.

**Rationale**: Hono is lightweight, TypeScript-first, and already in our tech stack (used by apps/server). Bun.serve handles graceful shutdown on SIGTERM automatically.

**Alternatives considered**:
- Raw `Bun.serve()`: Would work but Hono adds routing, middleware, and cleaner code structure
- Express: Heavier, not Bun-native

### 2. Port Selection

**Decision**: Default to port `3847`, configurable via `AOP_PORT` environment variable only.

**Rationale**: Standard practice for local servers - port comes from ENV, not database. Fixed default simplifies detection ("is something listening on 3847?"). High port avoids conflicts with common services.

**Alternatives considered**:
- Store port in SQLite settings: Non-standard, servers use ENV vars
- Dynamic port with port file: Adds complexity, harder to connect dashboard
- Unix socket: Works for API but dashboard needs HTTP port anyway

### 3. Server Detection (replaces PID file)

**Decision**: Check if port is in use via TCP connect attempt.

```typescript
const isServerRunning = async (port: number): Promise<boolean> => {
  try {
    const response = await fetch(`http://localhost:${port}/api/health`, {
      signal: AbortSignal.timeout(1000)
    });
    return response.ok;
  } catch {
    return false;
  }
};
```

**Rationale**: Simpler than PID files. Health endpoint confirms it's *our* server, not a random process on that port.

**Alternatives considered**:
- Keep PID file alongside port: Redundant, adds complexity
- Just check port binding: Could false-positive on other services

### 4. API Structure

**Decision**: REST endpoints under `/api/` prefix, tasks nested under repos:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check with orchestrator stats, db status, uptime |
| `/api/status` | GET | Full server status (repos, tasks, capacity) |
| `/api/refresh` | POST | Trigger repo refresh |
| `/api/repos` | POST | Register repo |
| `/api/repos/:id` | DELETE | Remove repo |
| `/api/repos/:id/tasks` | GET | List tasks for repo |
| `/api/repos/:id/tasks/:taskId/ready` | POST | Mark task ready |
| `/api/repos/:id/tasks/:taskId` | DELETE | Remove task |
| `/api/settings` | GET | Get all config |
| `/api/settings/:key` | GET/PUT | Get/set config value |

**Rationale**: RESTful conventions with proper resource nesting. Tasks belong to repos, so they're nested under `/api/repos/:id/tasks`. Dashboard will use the same endpoints.

### 5. CLI as HTTP Client Only

**Decision**: CLI commands are HTTP clients that require a running server. No start/stop commands, no offline mode.

**Before** (status.ts):
```typescript
const result = await getFullStatus(ctx, { pidFile });
```

**After**:
```typescript
const serverUrl = process.env.AOP_URL || 'http://localhost:3847';
const result = await fetch(`${serverUrl}/api/status`).then(r => r.json());
```

**Behavior when server not running**:
```typescript
// All CLI commands check server health first
const isRunning = await isServerRunning();
if (!isRunning) {
  console.error('Local server not running. Start it with: bun run apps/local-server/src/run.ts');
  process.exit(1);
}
```

**Rationale**: Clean separation of concerns. Server is a standalone process managed by user/system (systemd, launchd, Docker). CLI is just a client. No process spawning complexity in CLI.

### 6. Orchestrator Initialization

**Decision**: Start orchestrator after Hono server is listening.

```typescript
const server = Bun.serve({ fetch: app.fetch, port });

// Server is up, now start orchestrator (watcher, ticker, processor, sync)
const orchestrator = await startOrchestrator(db);
```

**Rationale**: Ensures health endpoint responds immediately while orchestrator initializes. Clients can poll `/api/status` to check readiness.

### 7. Graceful Shutdown

**Decision**: Handle SIGTERM like any standard web server. No shutdown endpoint.

```typescript
process.on('SIGTERM', async () => {
  await orchestrator.stop();  // Stop watcher, ticker, processor, sync
  await server.stop();        // Close HTTP server
  process.exit(0);
});
```

**Rationale**: Standard Unix process management. User stops server via Ctrl+C, `kill`, systemd, launchd, Docker, etc. No CLI command needed.

### 8. Orchestrator

**Decision**: No Hono abstraction for background work. The orchestrator runs JavaScript alongside the server.

```typescript
// run.ts entry point
const app = createApp(db);
const server = Bun.serve({ fetch: app.fetch, port });

// Start orchestrator - coordinates watcher, ticker, processor, remote sync
const orchestrator = await startOrchestrator(db);

// Standard signal handling
process.on('SIGTERM', async () => {
  await orchestrator.stop();
  server.stop();
});
```

**Rationale**: Hono is a router, not a background job framework. The orchestrator (watcher, ticker, processor, remote sync) is just JavaScript running in the same process. No abstraction needed.

### 9. Directory Structure

**Decision**: Create `apps/local-server/` as a separate application. CLI becomes a pure HTTP client.

```
apps/
  local-server/           # New standalone app (replaces daemon)
    src/
      app.ts              # Hono app + routes
      orchestrator.ts     # Orchestrator (watcher, ticker, processor, remote sync)
      run.ts              # Entry point
    package.json          # Own dependencies (hono, etc.)
  cli/
    src/
      commands/
        client.ts         # HTTP client helper (isServerRunning, getServerUrl)
        status.ts         # GET /api/status (requires local server)
        repo-init.ts      # POST /api/repos (requires local server)
        ...               # All commands require running local server
```

**Rationale**:
- Clear separation: `local-server` is the daemon, `cli` is a client
- Standard monorepo pattern: each app has its own package.json
- Server can be started independently via `bun run apps/local-server/src/run.ts`
- CLI has no process management responsibility

## Risks / Trade-offs

**[Port conflicts]** → User can configure port via `AOP_PORT` env var. Health endpoint distinguishes our server from others.

**[No offline mode]** → CLI requires running server. Mitigation: Clear error message with instructions to start server. Trade-off is acceptable for simpler architecture.

**[Backward compatibility]** → Breaking change: daemon removed, CLI commands require server. Mitigation: Document migration, old daemon code removed cleanly.

**[Startup latency]** → Server binds port before orchestrator is ready. Mitigation: `/api/status` indicates orchestrator readiness; `/api/health` always responds.

**[Security]** → Server listens on localhost only, no auth needed. Future dashboard may add optional auth if requested.

**[Process management]** → User responsible for starting/stopping server (Ctrl+C, systemd, launchd, Docker). Mitigation: Provide example service files in docs.
