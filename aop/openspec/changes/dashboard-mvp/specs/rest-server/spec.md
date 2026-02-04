## ADDED Requirements

### Requirement: SSE task events endpoint
The system SHALL expose an SSE endpoint for streaming task status changes.

#### Scenario: Establish events connection
- **WHEN** client connects to `GET /api/events`
- **THEN** server responds with `Content-Type: text/event-stream` and keeps connection open

#### Scenario: Send initial state
- **WHEN** client connects to events stream
- **THEN** server sends `event: init` with current task list and capacity info

#### Scenario: Task created event
- **WHEN** a new task is detected by watcher
- **THEN** server broadcasts `event: task-created` with task data to all connected clients

#### Scenario: Task status changed event
- **WHEN** a task status changes
- **THEN** server broadcasts `event: task-status-changed` with task ID, old status, and new status

#### Scenario: Task removed event
- **WHEN** a task is removed
- **THEN** server broadcasts `event: task-removed` with task ID

#### Scenario: Heartbeat
- **WHEN** no events occur for 30 seconds
- **THEN** server sends `event: heartbeat` to keep connection alive

### Requirement: SSE log streaming endpoint
The system SHALL expose an SSE endpoint for streaming execution logs.

#### Scenario: Establish SSE connection
- **WHEN** client connects to `GET /api/executions/:executionId/logs`
- **THEN** server responds with `Content-Type: text/event-stream` and keeps connection open

#### Scenario: Stream log events
- **WHEN** agent process produces stdout/stderr output
- **THEN** server pushes SSE data event with timestamp, stream type, and content

#### Scenario: Send completion event
- **WHEN** execution completes
- **THEN** server sends `event: complete` with execution status and closes stream

### Requirement: Metrics endpoint
The system SHALL expose an endpoint for aggregated task metrics.

#### Scenario: Get all metrics
- **WHEN** client calls `GET /api/metrics`
- **THEN** server returns JSON with task counts, success rate, and duration stats

#### Scenario: Get metrics for repo
- **WHEN** client calls `GET /api/metrics?repoId=<id>`
- **THEN** server returns metrics filtered to tasks in that repository

### Requirement: Static file serving
The system SHALL serve dashboard static files in production.

#### Scenario: Serve index.html
- **WHEN** request is made to root path `/`
- **THEN** server serves `index.html` from dashboard static directory

#### Scenario: Serve static assets
- **WHEN** request is made to `/assets/*`
- **THEN** server serves corresponding file from dashboard static directory

#### Scenario: SPA routing fallback
- **WHEN** request is made to unknown path that doesn't match `/api/*`
- **THEN** server serves `index.html` for client-side routing

#### Scenario: Disable static serving
- **WHEN** `DASHBOARD_STATIC_PATH` environment variable is not set
- **THEN** server does not serve static files (API-only mode)

### Requirement: CORS for development
The system SHALL support CORS for dashboard development.

#### Scenario: Allow dashboard dev origin
- **WHEN** request includes `Origin: http://localhost:5173` (or configured dev port)
- **THEN** server includes appropriate CORS headers in response

#### Scenario: Preflight requests
- **WHEN** browser sends OPTIONS preflight request
- **THEN** server responds with CORS headers and 204 No Content
