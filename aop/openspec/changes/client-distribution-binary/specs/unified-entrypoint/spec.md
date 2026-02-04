## ADDED Requirements

### Requirement: Single binary dispatches CLI and server commands
The system SHALL provide a unified entrypoint that routes to either local-server startup or CLI commands based on the subcommand.

#### Scenario: `aop run` starts the local-server
- **WHEN** user executes `aop run`
- **THEN** system starts the local-server (HTTP server + orchestrator) in the foreground
- **AND** server listens on the configured port (default 3847)

#### Scenario: `aop run` with `--daemon` backgrounds the server
- **WHEN** user executes `aop run --daemon`
- **THEN** system spawns the local-server as a detached background process
- **AND** writes the PID to `~/.aop/server.pid`
- **AND** exits immediately after confirming the server started

#### Scenario: `aop stop` stops a running server
- **WHEN** user executes `aop stop`
- **AND** a server process is running (PID file exists)
- **THEN** system sends SIGTERM to the server process
- **AND** removes the PID file after process exits

#### Scenario: `aop stop` with no server running
- **WHEN** user executes `aop stop`
- **AND** no server process is running
- **THEN** system prints "No AOP server running" and exits with code 0

#### Scenario: CLI commands route to HTTP client
- **WHEN** user executes any command other than `run` or `stop` (e.g., `aop status`, `aop repo:init`)
- **THEN** system delegates to the CLI command handler
- **AND** CLI sends HTTP request to the local-server

### Requirement: Unified entrypoint reuses existing code
The system SHALL import and reuse CLI command registration and server startup logic from their respective apps.

#### Scenario: CLI commands are identical to standalone CLI
- **WHEN** unified entrypoint registers CLI commands
- **THEN** all commands from `apps/cli/src/main.ts` are available with identical behavior
- **AND** no command logic is duplicated

#### Scenario: Server startup is identical to standalone local-server
- **WHEN** `aop run` invokes server startup
- **THEN** the server initializes identically to `apps/local-server/src/run.ts`
- **AND** orchestrator, database, and routes behave the same

### Requirement: Dashboard is served from the compiled binary
The unified entrypoint SHALL resolve the embedded dashboard assets and configure the local-server to serve them.

#### Scenario: Embedded dashboard path is resolved and passed to startServer
- **WHEN** `aop run` starts from the compiled binary
- **THEN** entrypoint resolves the path to the embedded dashboard assets (relative to `process.execPath`)
- **AND** passes it as `dashboardStaticPath` to `startServer()`
- **AND** the dashboard is accessible at `http://localhost:3847/`

#### Scenario: Dashboard path falls back to env var in dev mode
- **WHEN** running from source (not compiled)
- **THEN** the entrypoint does not provide an embedded path
- **AND** `startServer` falls back to `DASHBOARD_STATIC_PATH` env var (existing behavior)

### Requirement: Data directory management
The system SHALL use `~/.aop/` as the default data directory for all persistent state.

#### Scenario: Data directory created on first run
- **WHEN** user runs any `aop` command for the first time
- **AND** `~/.aop/` does not exist
- **THEN** system creates `~/.aop/` directory

#### Scenario: SQLite database stored in data directory
- **WHEN** server starts without `AOP_DB_PATH` override
- **THEN** system uses `~/.aop/data.db` as the SQLite database path

#### Scenario: PID file stored in data directory
- **WHEN** server starts in daemon mode
- **THEN** system writes PID to `~/.aop/server.pid`

#### Scenario: Logs stored in data directory
- **WHEN** server starts
- **THEN** system writes logs to `~/.aop/logs/`

### Requirement: Version reporting
The system SHALL report its version from the compiled binary.

#### Scenario: Version flag prints version
- **WHEN** user executes `aop --version` or `aop -v`
- **THEN** system prints the version string embedded at build time

#### Scenario: Version available in health endpoint
- **WHEN** client sends GET to `/api/health`
- **THEN** response includes `version` field matching the binary version
