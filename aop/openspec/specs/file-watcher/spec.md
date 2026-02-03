## ADDED Requirements

### Requirement: Watch openspec changes directories
The system SHALL watch `openspec/changes/` directories in all registered repositories for filesystem events.

#### Scenario: Detect new change directory
- **WHEN** a new directory is created at `openspec/changes/<name>/` in a registered repo
- **THEN** system triggers task creation for that change

#### Scenario: Detect deleted change directory
- **WHEN** a directory is deleted from `openspec/changes/` in a registered repo
- **THEN** system triggers task removal for that change (if not WORKING)

#### Scenario: Ignore non-change paths
- **WHEN** files are modified outside `openspec/changes/` directories
- **THEN** system takes no action

### Requirement: Debounce rapid events
The system SHALL debounce filesystem events to handle rapid writes during artifact creation.

#### Scenario: Debounce file writes
- **WHEN** multiple filesystem events occur within 500ms for the same change directory
- **THEN** system processes only one reconciliation event

### Requirement: Polling ticker reconciliation
The system SHALL periodically scan all registered repos to reconcile state with filesystem.

#### Scenario: Ticker finds new change on disk
- **WHEN** polling ticker runs and finds a change directory not in database
- **THEN** system creates DRAFT task for that change

#### Scenario: Ticker finds missing change
- **WHEN** polling ticker runs and finds a database task whose change directory no longer exists
- **THEN** system marks task as REMOVED (if not WORKING)

#### Scenario: Configurable poll interval
- **WHEN** user sets `watcher_poll_interval_secs` via `aop config:set`
- **THEN** system uses that interval for reconciliation ticker (default 30s)

### Requirement: Idempotent reconciliation
The system SHALL use idempotent database operations to prevent race conditions between watcher and ticker.

#### Scenario: Concurrent detection
- **WHEN** both watcher and ticker attempt to create the same task simultaneously
- **THEN** system creates exactly one task record (INSERT ON CONFLICT DO NOTHING)

#### Scenario: Concurrent removal
- **WHEN** both watcher and ticker attempt to remove the same task simultaneously
- **THEN** system updates at most once (UPDATE with status guard)

### Requirement: Daemon lifecycle
The system SHALL run the file watcher as part of the daemon process started by `aop start`.

#### Scenario: Start watching on daemon start
- **WHEN** user runs `aop start`
- **THEN** system begins watching all registered repos immediately

#### Scenario: Stop watching on daemon stop
- **WHEN** user runs `aop stop`
- **THEN** system stops all watchers gracefully
