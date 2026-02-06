## MODIFIED Requirements

### Requirement: Create task from change directory
The system SHALL create a DRAFT task when a new change directory is detected at the global openspec path.

#### Scenario: New change creates draft task
- **WHEN** file watcher or ticker detects new directory at `~/.aop/repos/<repo_id>/openspec/changes/<name>/`
- **THEN** system creates task with status=DRAFT, repo_id from repo lookup, change_path=`openspec/changes/<name>`, remoteId=null, syncedAt=null

#### Scenario: Task ID generation
- **WHEN** a new task is created
- **THEN** system assigns a TypeID in format `task_xxxxxxxxxxxx`

#### Scenario: Duplicate detection
- **WHEN** a task already exists for the same repo_id and change_path
- **THEN** system takes no action (idempotent)

#### Scenario: Sync new task to server
- **WHEN** task is created and ServerSync is available
- **THEN** system calls `POST /tasks/{taskId}/sync`

### Requirement: Remove task when change deleted
The system SHALL mark tasks as REMOVED when their change directory is deleted from the global path (unless WORKING), syncing to server.

#### Scenario: Remove non-working task
- **WHEN** change directory is deleted from `~/.aop/repos/<repo_id>/openspec/changes/` and task is DRAFT, READY, BLOCKED, or DONE
- **THEN** system updates task status to REMOVED

#### Scenario: Abort working task when files deleted
- **WHEN** change directory is deleted and task is WORKING
- **THEN** system aborts execution with `error.reason: "change_files_deleted"`

#### Scenario: Sync removed status
- **WHEN** task is marked REMOVED
- **THEN** system calls `POST /tasks/{taskId}/sync`

## REMOVED Requirements

### Requirement: Resolve task by change path
**Reason**: `resolveTaskByChangePath` walked filesystem to find git root and resolve tasks from relative/absolute change paths. All task interactions now go through the dashboard which always has the task ID. No CLI-based path resolution needed.
**Migration**: Remove `resolveTaskByChangePath` function and its callers. Use task ID lookup directly.
