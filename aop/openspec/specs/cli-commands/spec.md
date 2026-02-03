## ADDED Requirements

### Requirement: Start daemon
The system SHALL start a background daemon via `aop start`.

#### Scenario: Start daemon successfully
- **WHEN** user runs `aop start` with no daemon running
- **THEN** system starts daemon, writes PID to `~/.aop/aop.pid`, and displays confirmation

#### Scenario: Start when already running
- **WHEN** user runs `aop start` with daemon already running
- **THEN** system displays message indicating daemon is already running

#### Scenario: Daemon runs watcher and queue
- **WHEN** daemon starts
- **THEN** system begins file watching, polling ticker, and queue processing

### Requirement: Stop daemon
The system SHALL stop the running daemon via `aop stop`.

#### Scenario: Stop daemon successfully
- **WHEN** user runs `aop stop` with daemon running
- **THEN** system sends SIGTERM to daemon PID, waits for exit, removes PID file

#### Scenario: Stop when not running
- **WHEN** user runs `aop stop` with no daemon running
- **THEN** system displays message indicating no daemon is running

### Requirement: Show status
The system SHALL display daemon and task status via `aop status`.

#### Scenario: Status with running daemon
- **WHEN** user runs `aop status` with daemon running
- **THEN** system displays: daemon state (running + PID), global capacity (working/max), repos with tasks grouped by status

#### Scenario: Status with stopped daemon
- **WHEN** user runs `aop status` with daemon stopped
- **THEN** system displays: daemon state (stopped), repos with tasks grouped by status

#### Scenario: Status output format
- **WHEN** user runs `aop status`
- **THEN** system displays tasks as: `<task_id> <status> <change_name>`

### Requirement: Register repository
The system SHALL register current directory via `aop repo:init`.

#### Scenario: Register repo
- **WHEN** user runs `aop repo:init` in a git repository
- **THEN** system adds repo to database and displays confirmation

### Requirement: Remove repository
The system SHALL unregister a repository via `aop repo:remove`.

#### Scenario: Remove repo by path
- **WHEN** user runs `aop repo:remove [path]`
- **THEN** system removes repo from database if no WORKING tasks

### Requirement: Mark task ready
The system SHALL mark a task as ready via `aop task:ready`.

#### Scenario: Mark task ready
- **WHEN** user runs `aop task:ready <task_id>`
- **THEN** system updates task status to READY and displays confirmation

### Requirement: Manual task execution
The system SHALL allow manual task execution via `aop task:run`.

#### Scenario: Run task manually
- **WHEN** user runs `aop task:run <task_id>`
- **THEN** system executes task immediately, bypassing queue and concurrency limits

#### Scenario: Run already working task
- **WHEN** user runs `aop task:run <task_id>` for a WORKING task
- **THEN** system displays error indicating task already running

### Requirement: Get configuration
The system SHALL display configuration values via `aop config:get`.

#### Scenario: Get single value
- **WHEN** user runs `aop config:get <key>`
- **THEN** system displays the value for that key

#### Scenario: Get all values
- **WHEN** user runs `aop config:get` without key
- **THEN** system displays all configuration keys and values

#### Scenario: Get non-existent key
- **WHEN** user runs `aop config:get <unknown_key>`
- **THEN** system displays error indicating key not found

### Requirement: Set configuration
The system SHALL update configuration values via `aop config:set`.

#### Scenario: Set valid value
- **WHEN** user runs `aop config:set <key> <value>`
- **THEN** system updates the setting and displays confirmation

#### Scenario: Set invalid key
- **WHEN** user runs `aop config:set <unknown_key> <value>`
- **THEN** system displays error indicating key not found

### Requirement: Remove task
The system SHALL remove a task via `aop task:remove`.

#### Scenario: Remove non-working task
- **WHEN** user runs `aop task:remove <task_id>` for a task in DRAFT, READY, BLOCKED, or DONE status
- **THEN** system marks task as REMOVED and displays confirmation

#### Scenario: Remove working task
- **WHEN** user runs `aop task:remove <task_id>` for a WORKING task
- **THEN** system prompts for confirmation, then aborts agent (SIGTERM→SIGKILL), marks task REMOVED (worktree preserved)

#### Scenario: Remove working task with force
- **WHEN** user runs `aop task:remove <task_id> --force` for a WORKING task
- **THEN** system skips confirmation, aborts agent, marks task REMOVED (worktree preserved)

#### Scenario: Remove non-existent task
- **WHEN** user runs `aop task:remove <task_id>` for a task that doesn't exist
- **THEN** system displays error indicating task not found

### Requirement: Force remove repository
The system SHALL allow force removal of repositories with working tasks via `aop repo:remove --force`.

#### Scenario: Force remove repo with working tasks
- **WHEN** user runs `aop repo:remove --force` for a repo with WORKING tasks
- **THEN** system aborts all working tasks for the repo, then removes repo from database

#### Scenario: Force remove repo aborts multiple tasks
- **WHEN** user runs `aop repo:remove --force` for a repo with multiple WORKING tasks
- **THEN** system aborts each working task sequentially (SIGTERM→SIGKILL) before removing repo (worktrees preserved)
