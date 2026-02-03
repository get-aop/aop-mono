## ADDED Requirements

### Requirement: Register repository
The system SHALL allow users to register a git repository for task tracking via `aop repo:init`.

#### Scenario: Register current directory
- **WHEN** user runs `aop repo:init` in a git repository
- **THEN** system creates a repo record with path, name (from directory), and remote origin (if available)

#### Scenario: Register already registered repo
- **WHEN** user runs `aop repo:init` in an already registered repository
- **THEN** system displays message indicating repo is already registered

#### Scenario: Register non-git directory
- **WHEN** user runs `aop repo:init` in a directory that is not a git repository
- **THEN** system displays error and exits with non-zero code

### Requirement: List registered repositories
The system SHALL display registered repositories as part of `aop status` output.

#### Scenario: Status shows repos with tasks
- **WHEN** user runs `aop status`
- **THEN** system displays each registered repo with its path, capacity (working/max), and associated tasks grouped by status

#### Scenario: Status with no registered repos
- **WHEN** user runs `aop status` with no registered repositories
- **THEN** system displays message indicating no repos are registered

### Requirement: Remove repository registration
The system SHALL allow users to unregister a repository via `aop repo:remove`.

#### Scenario: Remove repo with no working tasks
- **WHEN** user runs `aop repo:remove` for a repo with no WORKING tasks
- **THEN** system removes the repo record and marks associated tasks as REMOVED

#### Scenario: Remove repo with working tasks
- **WHEN** user runs `aop repo:remove` for a repo with WORKING tasks (without --force)
- **THEN** system displays error indicating tasks are in progress and exits with non-zero code

#### Scenario: Force remove repo with working tasks
- **WHEN** user runs `aop repo:remove --force` for a repo with WORKING tasks
- **THEN** system aborts all working tasks for the repo (worktrees preserved), then removes repo from database

#### Scenario: Remove non-existent repo
- **WHEN** user runs `aop repo:remove` for a path not registered
- **THEN** system displays error indicating repo not found

### Requirement: Per-repo concurrency limit
The system SHALL enforce a per-repo maximum concurrent tasks setting.

#### Scenario: Respect repo limit
- **WHEN** a repo has max_concurrent_tasks=2 and 2 tasks are WORKING
- **THEN** system SHALL NOT start additional tasks for that repo even if global capacity allows

#### Scenario: Default repo limit
- **WHEN** a repo is registered without explicit limit
- **THEN** system uses default max_concurrent_tasks of 1

### Requirement: Store repo metadata
The system SHALL persist repo metadata in SQLite including id, path, name, remote_origin, max_concurrent_tasks, created_at, updated_at.

#### Scenario: Repo record structure
- **WHEN** a repo is registered
- **THEN** system stores a record with TypeID (repo_xxx), unique path, extracted name, remote origin URL, and timestamps
