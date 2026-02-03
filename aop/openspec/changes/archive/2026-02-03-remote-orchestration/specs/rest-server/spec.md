## ADDED Requirements

### Requirement: HTTP server
The system SHALL expose a REST API for CLI communication.

#### Scenario: Start HTTP server
- **WHEN** server application starts
- **THEN** server listens on configured PORT (default 3000)

#### Scenario: CORS configuration
- **WHEN** request comes from CLI
- **THEN** server allows cross-origin requests

### Requirement: API key authentication
The system SHALL validate API keys on all protected endpoints.

#### Scenario: Valid API key
- **WHEN** request includes valid `Authorization: Bearer <api_key>` header
- **THEN** server processes request with associated client context

#### Scenario: Invalid API key
- **WHEN** request includes invalid or missing API key
- **THEN** server responds with 401 Unauthorized

#### Scenario: Auth endpoint
- **WHEN** CLI calls `POST /auth` with valid API key
- **THEN** server responds with `clientId` and `effectiveMaxConcurrentTasks`

#### Scenario: Compute effective concurrency limit
- **WHEN** CLI includes `requestedMaxConcurrentTasks` in auth request
- **THEN** server computes `effectiveMaxConcurrentTasks = min(server_limit, cli_requested)`

### Requirement: Repo sync endpoint
The system SHALL accept repo sync requests.

#### Scenario: Sync repo
- **WHEN** CLI calls `POST /repos/{repoId}/sync`
- **THEN** server upserts repo record and responds with `{ ok: true }`

### Requirement: Task sync endpoint
The system SHALL accept task sync requests.

#### Scenario: Sync task
- **WHEN** CLI calls `POST /tasks/{taskId}/sync`
- **THEN** server upserts task record with status and responds with `{ ok: true }`

### Requirement: Task ready endpoint
The system SHALL handle task ready requests and return first workflow step.

#### Scenario: Mark task ready - start workflow
- **WHEN** CLI calls `POST /tasks/{taskId}/ready` and client is below concurrency limit
- **THEN** server creates execution, returns `status: "WORKING"` with first step command

#### Scenario: Mark task ready - at capacity
- **WHEN** CLI calls `POST /tasks/{taskId}/ready` and client is at max concurrent tasks
- **THEN** server returns `status: "READY"`, `queued: true`

#### Scenario: Concurrent task limit check
- **WHEN** evaluating whether to start workflow
- **THEN** server counts client's WORKING tasks against `effectiveMaxConcurrentTasks`

### Requirement: Step completion endpoint
The system SHALL process step completions and return next step.

#### Scenario: Step completed - next step
- **WHEN** CLI calls `POST /steps/{stepId}/complete` with success and workflow has more steps
- **THEN** server returns `taskStatus: "WORKING"` with next step command

#### Scenario: Step completed - workflow done
- **WHEN** CLI calls `POST /steps/{stepId}/complete` and workflow reaches terminal success
- **THEN** server returns `taskStatus: "DONE"`, `step: null`

#### Scenario: Step failed - retry available
- **WHEN** CLI calls `POST /steps/{stepId}/complete` with failure and retries remain
- **THEN** server returns `taskStatus: "WORKING"` with retry step command (incremented attempt)

#### Scenario: Step failed - workflow blocked
- **WHEN** CLI calls `POST /steps/{stepId}/complete` with failure and no retries remain
- **THEN** server returns `taskStatus: "BLOCKED"`, `step: null`, error details

#### Scenario: Step aborted
- **WHEN** CLI calls `POST /steps/{stepId}/complete` with `error.code: "aborted"`
- **THEN** server returns `taskStatus: "REMOVED"`, `step: null` (no retry, task is gone)

#### Scenario: Idempotent step completion
- **WHEN** CLI sends duplicate step completion (same executionId, stepId, attempt)
- **THEN** server returns same response without side effects

### Requirement: Task status endpoint
The system SHALL provide task status for recovery scenarios.

#### Scenario: Get task status
- **WHEN** CLI calls `GET /tasks/{taskId}/status`
- **THEN** server returns current status, execution info, and `awaitingResult` flag

#### Scenario: Awaiting result flag
- **WHEN** server sent step command but hasn't received result
- **THEN** `awaitingResult` is true in status response

### Requirement: Health endpoint
The system SHALL expose a health check endpoint.

#### Scenario: Health check
- **WHEN** request is made to `GET /health`
- **THEN** server responds with 200 OK and status JSON

### Requirement: Process deferred workflows
The system SHALL start queued workflows when capacity becomes available.

#### Scenario: Start deferred workflow on task completion
- **WHEN** task status changes from WORKING to DONE/BLOCKED
- **THEN** server evaluates queued READY tasks and starts workflows for newly eligible ones

#### Scenario: Respond to next queued task
- **WHEN** deferred workflow is started
- **THEN** next `POST /tasks/{taskId}/ready` call for that client may receive step command

### Requirement: Race condition handling
The system SHALL handle concurrent requests safely.

#### Scenario: Concurrent step completions
- **WHEN** multiple step completions arrive simultaneously
- **THEN** server uses `SELECT ... FOR UPDATE SKIP LOCKED` to prevent races

#### Scenario: Concurrent ready requests
- **WHEN** multiple ready requests arrive for same client
- **THEN** server enforces concurrency limit atomically
