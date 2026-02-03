## ADDED Requirements

### Requirement: Create task from change directory
The system SHALL create a DRAFT task when a new change directory is detected.

#### Scenario: New change creates draft task
- **WHEN** file watcher or ticker detects new directory at `openspec/changes/<name>/`
- **THEN** system creates task with status=DRAFT, repo_id from repo lookup, change_path=<name>

#### Scenario: Task ID generation
- **WHEN** a new task is created
- **THEN** system assigns a TypeID in format `task_xxxxxxxxxxxx`

#### Scenario: Duplicate detection
- **WHEN** a task already exists for the same repo_id and change_path
- **THEN** system takes no action (idempotent)

### Requirement: Mark task ready for execution
The system SHALL allow users to mark a DRAFT task as READY via `aop task:ready`.

#### Scenario: Mark draft as ready
- **WHEN** user runs `aop task:ready <task_id>` for a DRAFT task
- **THEN** system updates status to READY and sets ready_at timestamp

#### Scenario: Mark non-draft as ready
- **WHEN** user runs `aop task:ready <task_id>` for a non-DRAFT task
- **THEN** system displays error indicating invalid state transition

### Requirement: Remove task when change deleted
The system SHALL mark tasks as REMOVED when their change directory is deleted (unless WORKING).

#### Scenario: Remove non-working task
- **WHEN** change directory is deleted and task is DRAFT, READY, BLOCKED, or DONE
- **THEN** system updates task status to REMOVED

#### Scenario: Preserve working task
- **WHEN** change directory is deleted and task is WORKING
- **THEN** system takes no action (agent still running)

### Requirement: Task status model
The system SHALL track tasks through states: DRAFT, READY, WORKING, BLOCKED, DONE, REMOVED.

#### Scenario: Valid state transitions
- **WHEN** task transitions occur
- **THEN** system enforces: DRAFT→READY (user), READY→WORKING (daemon), WORKING→DONE (success), WORKING→BLOCKED (failure), BLOCKED→DRAFT (user retry)

### Requirement: FIFO queue ordering
The system SHALL order READY tasks by ready_at timestamp for queue processing.

#### Scenario: First ready first served
- **WHEN** multiple tasks are READY
- **THEN** system picks the task with earliest ready_at timestamp for execution
