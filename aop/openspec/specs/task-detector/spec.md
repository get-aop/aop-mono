## MODIFIED Requirements

### Requirement: Create task from change directory
The system SHALL create a DRAFT task when a new change directory is detected, now with sync fields.

#### Scenario: New change creates draft task
- **WHEN** file watcher or ticker detects new directory at `openspec/changes/<name>/`
- **THEN** system creates task with status=DRAFT, repo_id from repo lookup, change_path=<name>, remoteId=null, syncedAt=null

#### Scenario: Task ID generation
- **WHEN** a new task is created
- **THEN** system assigns a TypeID in format `task_xxxxxxxxxxxx`

#### Scenario: Duplicate detection
- **WHEN** a task already exists for the same repo_id and change_path
- **THEN** system takes no action (idempotent)

#### Scenario: Sync new task to server
- **WHEN** task is created and ServerSync is available
- **THEN** system calls `POST /tasks/{taskId}/sync`

### Requirement: Mark task ready for execution
The system SHALL allow users to mark a DRAFT task as READY via `aop task:ready`, triggering server workflow.

#### Scenario: Mark draft as ready
- **WHEN** user runs `aop task:ready <task_id>` for a DRAFT task
- **THEN** system updates status to READY and sets ready_at timestamp

#### Scenario: Mark non-draft as ready
- **WHEN** user runs `aop task:ready <task_id>` for a non-DRAFT task
- **THEN** system displays error indicating invalid state transition

#### Scenario: Call server ready endpoint
- **WHEN** task status changes to READY
- **THEN** system calls `POST /tasks/{taskId}/ready` to start workflow

### Requirement: Remove task when change deleted
The system SHALL mark tasks as REMOVED when their change directory is deleted (unless WORKING), syncing to server.

#### Scenario: Remove non-working task
- **WHEN** change directory is deleted and task is DRAFT, READY, BLOCKED, or DONE
- **THEN** system updates task status to REMOVED

#### Scenario: Abort working task when files deleted
- **WHEN** change directory is deleted and task is WORKING
- **THEN** system aborts execution with `error.reason: "change_files_deleted"`

#### Scenario: Sync removed status
- **WHEN** task is marked REMOVED
- **THEN** system calls `POST /tasks/{taskId}/sync`

### Requirement: Task status model
The system SHALL track tasks through states with ownership model: local owns DRAFT↔READY, remote owns WORKING↔DONE/BLOCKED.

#### Scenario: Valid state transitions
- **WHEN** task transitions occur
- **THEN** system enforces: DRAFT→READY (user), READY→WORKING (server), WORKING→DONE (server), WORKING→BLOCKED (server), BLOCKED→DRAFT (user retry)

#### Scenario: Local ownership
- **WHEN** task is in DRAFT, READY, or BLOCKED state
- **THEN** CLI can transition the task

#### Scenario: Remote ownership
- **WHEN** task is in WORKING state
- **THEN** only server can transition to DONE or BLOCKED (via step completion response)

### Requirement: FIFO queue ordering
The system SHALL order READY tasks by ready_at timestamp for queue processing.

#### Scenario: First ready first served
- **WHEN** multiple tasks are READY
- **THEN** server picks the task with earliest ready_at timestamp for execution

## ADDED Requirements

### Requirement: Remote sync fields
The system SHALL track server sync state on task records.

#### Scenario: RemoteId field
- **WHEN** task record is defined
- **THEN** record includes remoteId field (nullable) for server-assigned ID

#### Scenario: SyncedAt field
- **WHEN** task record is defined
- **THEN** record includes syncedAt field (nullable) for last sync timestamp

#### Scenario: Update sync fields on acknowledgment
- **WHEN** server responds with 200 to sync request
- **THEN** system updates syncedAt on local record

### Requirement: Sync all status changes
The system SHALL sync task status changes to remote server when connected.

#### Scenario: Sync on status change
- **WHEN** task status changes
- **THEN** system calls `POST /tasks/{taskId}/sync` if ServerSync is available

#### Scenario: Queue sync when offline
- **WHEN** task status changes and server is unreachable
- **THEN** system queues sync request for delivery when connection returns

#### Scenario: Reconcile on startup
- **WHEN** daemon starts and authenticates
- **THEN** system syncs any tasks with status changes since last syncedAt
