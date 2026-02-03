## ADDED Requirements

### Requirement: Define REST API request/response types
The system SHALL define typed request/response structures for CLI↔Server HTTP communication.

#### Scenario: Zod schema validation
- **WHEN** a request or response is processed at API boundary
- **THEN** system validates the payload against its Zod schema

#### Scenario: Shared types
- **WHEN** CLI or server needs request/response types
- **THEN** types are available from `@aop/common/protocol`

### Requirement: Authentication types
The system SHALL define types for API key authentication.

#### Scenario: Auth request
- **WHEN** CLI authenticates with server
- **THEN** request includes optional `requestedMaxConcurrentTasks`

#### Scenario: Auth response
- **WHEN** server validates API key
- **THEN** response includes `clientId` and `effectiveMaxConcurrentTasks`

### Requirement: Sync request types
The system SHALL define types for syncing repos and tasks.

#### Scenario: Repo sync request
- **WHEN** CLI syncs a repo
- **THEN** request includes `syncedAt` timestamp

#### Scenario: Task sync request
- **WHEN** CLI syncs a task
- **THEN** request includes `repoId`, `status`, and `syncedAt`

### Requirement: Task ready request/response types
The system SHALL define types for marking tasks ready.

#### Scenario: Ready request
- **WHEN** CLI marks task as ready
- **THEN** request includes `repoId`

#### Scenario: Ready response with step
- **WHEN** server starts workflow
- **THEN** response includes `status: "WORKING"`, `execution` info, and first `step` command

#### Scenario: Ready response when queued
- **WHEN** client is at max concurrent tasks
- **THEN** response includes `status: "READY"`, `queued: true`

### Requirement: Step completion request/response types
The system SHALL define types for reporting step results.

#### Scenario: Step completion request (success)
- **WHEN** agent completes step successfully
- **THEN** request includes `executionId`, `attempt`, `status: "success"`, `durationMs`

#### Scenario: Step completion request with signal
- **WHEN** CLI detects a signal keyword in agent output
- **THEN** request includes optional `signal` field with the detected keyword (e.g., `"TASK_COMPLETE"`, `"NEEDS_REVIEW"`)

#### Scenario: Step completion request (failure)
- **WHEN** agent fails step
- **THEN** request includes `error` object with `code`, `message`, and optional `reason`

#### Scenario: Step completion request (aborted)
- **WHEN** task is aborted (user removed or change files deleted)
- **THEN** request includes `error.code: "aborted"` and `error.reason` explaining cause (e.g., "task_removed", "change_files_deleted")

#### Scenario: Step completion response (next step)
- **WHEN** workflow has more steps
- **THEN** response includes `taskStatus: "WORKING"` and next `step` command

#### Scenario: Step completion response (done)
- **WHEN** workflow completes
- **THEN** response includes `taskStatus: "DONE"`, `step: null`

#### Scenario: Step completion response (blocked)
- **WHEN** workflow fails
- **THEN** response includes `taskStatus: "BLOCKED"`, `step: null`, `error`

### Requirement: Task status response type
The system SHALL define types for querying task status.

#### Scenario: Task status response
- **WHEN** CLI queries task status
- **THEN** response includes `status`, `execution` info with `awaitingResult` flag

### Requirement: Step command type
The system SHALL define the step command structure.

#### Scenario: Step command fields
- **WHEN** server sends step command
- **THEN** command includes `id`, `type`, `promptTemplate`, `attempt`

#### Scenario: Step command with signals
- **WHEN** workflow step defines signal keywords
- **THEN** step command includes `signals` array for CLI to scan agent output

### Requirement: Error codes enum
The system SHALL define standard error codes.

#### Scenario: Agent error codes
- **WHEN** step fails due to agent issue
- **THEN** error code is one of: `agent_timeout`, `agent_crash`, `script_failed`, `aborted`

#### Scenario: Abort reason values
- **WHEN** error code is `aborted`
- **THEN** error reason is one of: `task_removed`, `change_files_deleted`

#### Scenario: Server error codes
- **WHEN** step fails due to server issue
- **THEN** error code is one of: `max_retries_exceeded`, `prompt_not_found`
