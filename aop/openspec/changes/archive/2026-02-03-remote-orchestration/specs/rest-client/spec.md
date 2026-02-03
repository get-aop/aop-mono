## ADDED Requirements

### Requirement: ServerSync component
The system SHALL implement a ServerSync class that manages HTTP communication with the server.

#### Scenario: Create ServerSync
- **WHEN** daemon starts
- **THEN** daemon creates ServerSync with API key from config and server URL

#### Scenario: Degrade without API key
- **WHEN** no API key is configured
- **THEN** ServerSync operates in degraded mode (no sync, no workflows)

### Requirement: Authentication
The system SHALL authenticate with the server using API key.

#### Scenario: Call auth endpoint
- **WHEN** ServerSync initializes
- **THEN** ServerSync calls `POST /auth` to validate API key

#### Scenario: Request lower concurrency
- **WHEN** local settings specify max_concurrent_tasks
- **THEN** ServerSync includes `requestedMaxConcurrentTasks` in auth request

#### Scenario: Handle auth success
- **WHEN** server responds with 200
- **THEN** ServerSync stores `clientId` and `effectiveMaxConcurrentTasks`

#### Scenario: Handle auth failure
- **WHEN** server responds with 401
- **THEN** ServerSync logs error and operates in degraded mode

### Requirement: Repo sync
The system SHALL sync repo registration to server.

#### Scenario: Sync repo
- **WHEN** user registers a new repository via `aop repo:init`
- **THEN** ServerSync calls `POST /repos/{repoId}/sync`

#### Scenario: Retry on failure
- **WHEN** repo sync fails due to network error
- **THEN** ServerSync queues request and retries with exponential backoff

### Requirement: Task sync
The system SHALL sync task status changes to server.

#### Scenario: Sync task status
- **WHEN** local task status changes (DRAFT, READY, BLOCKED, DONE, REMOVED)
- **THEN** ServerSync calls `POST /tasks/{taskId}/sync`

#### Scenario: Queue when offline
- **WHEN** sync fails and ServerSync is offline
- **THEN** ServerSync queues sync request for later delivery

### Requirement: Mark task ready
The system SHALL call server when user marks task ready.

#### Scenario: Call ready endpoint
- **WHEN** user marks task READY via `aop task:ready`
- **THEN** ServerSync calls `POST /tasks/{taskId}/ready`

#### Scenario: Receive first step
- **WHEN** server responds with `status: "WORKING"` and step
- **THEN** ServerSync passes step command to executor

#### Scenario: Handle queued response
- **WHEN** server responds with `queued: true`
- **THEN** ServerSync marks task as queued locally and waits (task stays READY)

### Requirement: Retry queued tasks
The system SHALL retry queued READY tasks when capacity becomes available.

#### Scenario: Retry on task completion
- **WHEN** ServerSync receives `taskStatus: "DONE"` or `taskStatus: "BLOCKED"` or `taskStatus: "REMOVED"`
- **THEN** ServerSync retries `POST /tasks/{taskId}/ready` for any locally-queued READY tasks

#### Scenario: Retry order
- **WHEN** multiple tasks are queued locally
- **THEN** ServerSync retries in `ready_at` order (FIFO)

#### Scenario: Retry on daemon start
- **WHEN** daemon starts and finds READY tasks that were previously queued
- **THEN** ServerSync retries `POST /tasks/{taskId}/ready` for each

### Requirement: Complete step
The system SHALL report step completion and receive next step.

#### Scenario: Report success
- **WHEN** agent completes step successfully
- **THEN** ServerSync calls `POST /steps/{stepId}/complete` with `status: "success"`

#### Scenario: Report failure
- **WHEN** agent fails step
- **THEN** ServerSync calls `POST /steps/{stepId}/complete` with error details

#### Scenario: Report abort
- **WHEN** task is aborted (user removed or change files deleted)
- **THEN** ServerSync calls `POST /steps/{stepId}/complete` with `error.code: "aborted"` and appropriate `error.reason`

#### Scenario: Receive next step
- **WHEN** server responds with `taskStatus: "WORKING"` and step
- **THEN** ServerSync passes step command to executor

#### Scenario: Handle workflow complete
- **WHEN** server responds with `taskStatus: "DONE"`
- **THEN** ServerSync updates local task status to DONE

#### Scenario: Handle workflow blocked
- **WHEN** server responds with `taskStatus: "BLOCKED"`
- **THEN** ServerSync updates local task status to BLOCKED

### Requirement: Template resolution
The system SHALL resolve Handlebars placeholders in prompts locally.

#### Scenario: Resolve worktree path
- **WHEN** prompt contains `{{ worktree.path }}`
- **THEN** ServerSync substitutes actual local worktree path

#### Scenario: Resolve task context
- **WHEN** prompt contains `{{ task.id }}` or `{{ task.changePath }}`
- **THEN** ServerSync substitutes actual task values

#### Scenario: Privacy preserved
- **WHEN** prompt is resolved
- **THEN** resolved values are never sent to server

### Requirement: Network resilience
The system SHALL handle network failures gracefully.

#### Scenario: Retry with backoff
- **WHEN** HTTP request fails
- **THEN** ServerSync retries with exponential backoff (1s → 2s → 4s → max 60s)

#### Scenario: Queue sync requests
- **WHEN** network is down
- **THEN** ServerSync queues sync requests and sends on recovery

#### Scenario: Recovery check
- **WHEN** network recovers after step was running
- **THEN** ServerSync calls `GET /tasks/{taskId}/status` to reconcile state

#### Scenario: Handle awaiting result
- **WHEN** status response shows `awaitingResult: true`
- **THEN** ServerSync sends queued step completion

### Requirement: Server address configuration
The system SHALL use configurable server address.

#### Scenario: Default server address
- **WHEN** no server address is configured
- **THEN** ServerSync uses default production server URL

#### Scenario: Custom server address
- **WHEN** AOP_SERVER_URL environment variable is set
- **THEN** ServerSync connects to specified URL
