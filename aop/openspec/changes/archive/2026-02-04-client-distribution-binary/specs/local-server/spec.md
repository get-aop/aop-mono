## MODIFIED Requirements

### Requirement: Server startup is exportable
The local-server SHALL export a `startServer` function that the unified entrypoint can call, instead of only running as a top-level script.

#### Scenario: startServer function is importable
- **WHEN** the unified entrypoint imports `startServer` from `apps/local-server`
- **THEN** it receives a function that accepts configuration options and starts the server

#### Scenario: startServer accepts configuration
- **WHEN** `startServer` is called with `{ port, dbPath, dashboardStaticPath }`
- **THEN** system uses the provided port, database path, and dashboard static path
- **AND** falls back to defaults (port 3847, `~/.aop/aop.sqlite`) for omitted options

#### Scenario: startServer serves embedded dashboard when path is provided
- **WHEN** `startServer` is called with `dashboardStaticPath` pointing to embedded assets
- **THEN** the server serves the dashboard at the root URL
- **AND** SPA fallback routing works for all client-side routes
- **AND** the `DASHBOARD_STATIC_PATH` env var is not required

#### Scenario: startServer returns a handle for shutdown
- **WHEN** `startServer` resolves
- **THEN** it returns an object with a `shutdown()` method
- **AND** calling `shutdown()` performs the same graceful shutdown as SIGTERM (stop orchestrator, stop server, destroy db)

#### Scenario: Standalone run.ts still works
- **WHEN** `apps/local-server/src/run.ts` is executed directly (e.g., during development)
- **THEN** it calls `startServer` with defaults and registers SIGTERM/SIGINT handlers
- **AND** behavior is identical to before this change

### Requirement: No side effects on import
The local-server module SHALL not start the server or configure logging when imported.

#### Scenario: Import without execution
- **WHEN** `startServer` is imported but not called
- **THEN** no HTTP server is started
- **AND** no database connection is opened
- **AND** no logging is configured
- **AND** no orchestrator is created

### Requirement: Server reports to caller when ready
The local-server SHALL signal to the caller when the HTTP server and orchestrator are fully initialized.

#### Scenario: startServer resolves after server is listening
- **WHEN** `startServer` is called
- **THEN** the returned promise resolves only after the HTTP server is bound to the port
- **AND** the orchestrator has started

#### Scenario: startServer rejects on failure
- **WHEN** `startServer` is called and the port is already in use
- **THEN** the returned promise rejects with a descriptive error
