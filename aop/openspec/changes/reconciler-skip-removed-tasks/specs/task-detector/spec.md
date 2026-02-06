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
- **WHEN** a task already exists for the same repo_id and change_path (regardless of status, including REMOVED)
- **THEN** system takes no action (idempotent) and SHALL NOT emit a task-created event

#### Scenario: Sync new task to server
- **WHEN** task is created and ServerSync is available
- **THEN** system calls `POST /tasks/{taskId}/sync`

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

#### Scenario: Removed task stays dismissed across reconciliation
- **WHEN** reconciler runs and a change directory exists on disk with a corresponding REMOVED task in the database
- **THEN** reconciler SHALL skip that change directory and SHALL NOT attempt to create or re-create a task for it
