## MODIFIED Requirements

### Requirement: Watch openspec changes directories
The system SHALL watch `~/.aop/repos/<repo_id>/openspec/changes/` directories for all registered repositories. It SHALL also watch `{repo}/openspec/changes/` as a fallback, auto-relocating artifacts found there.

#### Scenario: Detect new change in global directory
- **WHEN** a new directory is created at `~/.aop/repos/<repo_id>/openspec/changes/<name>/`
- **THEN** system triggers task creation for that change

#### Scenario: Detect deleted change in global directory
- **WHEN** a directory is deleted from `~/.aop/repos/<repo_id>/openspec/changes/`
- **THEN** system triggers task removal for that change (if not WORKING)

#### Scenario: Auto-relocate from repo path
- **WHEN** a new directory is created at `{repo}/openspec/changes/<name>/`
- **THEN** system moves it to `~/.aop/repos/<repo_id>/openspec/changes/<name>/`
- **AND** removes the original directory from the repo
- **AND** triggers task creation for the relocated change

#### Scenario: Ignore non-change paths
- **WHEN** files are modified outside openspec changes directories
- **THEN** system takes no action

### Requirement: Polling ticker reconciliation
The system SHALL periodically scan global openspec directories for all registered repos to reconcile state.

#### Scenario: Ticker finds new change on disk
- **WHEN** polling ticker runs and finds a change directory at `~/.aop/repos/<repo_id>/openspec/changes/<name>` not in database
- **THEN** system creates DRAFT task for that change

#### Scenario: Ticker finds missing change
- **WHEN** polling ticker runs and finds a database task whose change directory no longer exists at global path
- **THEN** system marks task as REMOVED (if not WORKING)

#### Scenario: Ticker auto-relocates from repo path
- **WHEN** polling ticker finds change directories at `{repo}/openspec/changes/` that are not at the global path
- **THEN** system relocates them to `~/.aop/repos/<repo_id>/openspec/changes/`

#### Scenario: Configurable poll interval
- **WHEN** user sets `watcher_poll_interval_secs` via `aop config:set`
- **THEN** system uses that interval for reconciliation ticker (default 30s)
