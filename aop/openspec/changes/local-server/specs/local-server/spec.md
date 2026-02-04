## ADDED Requirements

### Requirement: HTTP server on localhost
The system SHALL run a Hono HTTP server on localhost, listening on a configurable port.

#### Scenario: Server starts on default port
- **WHEN** server starts without port configuration
- **THEN** system listens on port 3847

#### Scenario: Server starts on configured port
- **WHEN** AOP_PORT environment variable is set
- **THEN** system listens on the specified port

#### Scenario: Server binds to localhost only
- **WHEN** server starts
- **THEN** system binds to 127.0.0.1 (not 0.0.0.0)

### Requirement: Health endpoint
The system SHALL expose a health check endpoint at `/api/health` with orchestrator stats.

#### Scenario: Health check returns ok
- **WHEN** client sends GET to `/api/health`
- **THEN** system returns `{ "ok": true, "service": "aop" }` with status 200

#### Scenario: Health check returns orchestrator status
- **WHEN** client sends GET to `/api/health`
- **THEN** response includes `orchestrator: { watcher: "running"|"stopped", ticker: "running"|"stopped", processor: "running"|"stopped" }`

#### Scenario: Health check returns database status
- **WHEN** client sends GET to `/api/health`
- **THEN** response includes `db: { connected: true|false }` based on SQLite connection health

#### Scenario: Health check returns uptime
- **WHEN** client sends GET to `/api/health`
- **THEN** response includes `uptime` in seconds since server start

### Requirement: Status endpoint
The system SHALL expose server status at `/api/status`.

#### Scenario: Status returns full state
- **WHEN** client sends GET to `/api/status`
- **THEN** system returns repos, tasks, global capacity, and service readiness

#### Scenario: Status indicates orchestrator readiness
- **WHEN** orchestrator is still initializing
- **THEN** status response includes `{ "ready": false }`

### Requirement: Refresh endpoint
The system SHALL trigger repo refresh via `/api/refresh`.

#### Scenario: Refresh triggers reconciliation
- **WHEN** client sends POST to `/api/refresh`
- **THEN** system reconciles all watched repos and returns confirmation

### Requirement: Repo management endpoints
The system SHALL expose repo management at `/api/repos`.

#### Scenario: Register repo
- **WHEN** client sends POST to `/api/repos` with `{ "path": "/path/to/repo" }`
- **THEN** system registers the repo and returns the repo ID

#### Scenario: Remove repo
- **WHEN** client sends DELETE to `/api/repos/:id`
- **THEN** system unregisters the repo if no WORKING tasks

#### Scenario: Remove repo with force
- **WHEN** client sends DELETE to `/api/repos/:id?force=true` with WORKING tasks
- **THEN** system aborts working tasks, then removes repo

### Requirement: Task management endpoints
The system SHALL expose task management under `/api/repos/:id/tasks`.

#### Scenario: List tasks for repo
- **WHEN** client sends GET to `/api/repos/:id/tasks`
- **THEN** system returns all tasks for the specified repo

#### Scenario: Mark task ready
- **WHEN** client sends POST to `/api/repos/:repoId/tasks/:taskId/ready`
- **THEN** system marks the task as READY and returns confirmation

#### Scenario: Remove task
- **WHEN** client sends DELETE to `/api/repos/:repoId/tasks/:taskId`
- **THEN** system marks task as REMOVED (aborts if WORKING)

### Requirement: Settings endpoints
The system SHALL expose settings at `/api/settings`.

#### Scenario: Get all settings
- **WHEN** client sends GET to `/api/settings`
- **THEN** system returns all settings keys and values

#### Scenario: Get single setting
- **WHEN** client sends GET to `/api/settings/:key`
- **THEN** system returns the value for that key

#### Scenario: Set setting
- **WHEN** client sends PUT to `/api/settings/:key` with `{ "value": "..." }`
- **THEN** system updates the setting and returns confirmation

### Requirement: Orchestrator initialization
The system SHALL start the orchestrator after HTTP server is listening.

#### Scenario: Orchestrator starts after server
- **WHEN** server binds to port successfully
- **THEN** system initializes orchestrator (watcher, ticker, queue processor, remote sync)

#### Scenario: Health responds during initialization
- **WHEN** client calls `/api/health` while orchestrator is starting
- **THEN** system returns 200 (server is up, even if orchestrator not ready)

### Requirement: Graceful shutdown on SIGTERM
The system SHALL perform graceful shutdown when receiving SIGTERM.

#### Scenario: Shutdown stops accepting work
- **WHEN** SIGTERM is received
- **THEN** system stops queue processor, ticker, and watcher from accepting new work

#### Scenario: Shutdown waits for executing tasks
- **WHEN** SIGTERM is received with tasks executing
- **THEN** system waits for executing tasks to complete before exiting

#### Scenario: Shutdown flushes queues
- **WHEN** SIGTERM is received with offline queue items
- **THEN** system attempts to flush server sync queue before exiting
