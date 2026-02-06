## MODIFIED Requirements

### Requirement: Register repository
The system SHALL allow users to register a git repository for task tracking, creating the global directory structure.

#### Scenario: Register current directory
- **WHEN** user runs `aop repo:init` in a git repository
- **THEN** system creates a repo record with path, name (from directory), and remote origin (if available)
- **AND** system creates `~/.aop/repos/<repo_id>/openspec/changes/` directory
- **AND** system creates `~/.aop/repos/<repo_id>/worktrees/` directory
- **AND** system creates `~/.aop/repos/<repo_id>/worktrees/.metadata/` directory

#### Scenario: Register already registered repo
- **WHEN** user runs `aop repo:init` in an already registered repository
- **THEN** system displays message indicating repo is already registered

#### Scenario: Register non-git directory
- **WHEN** user runs `aop repo:init` in a directory that is not a git repository
- **THEN** system displays error and exits with non-zero code

### Requirement: Remove repository registration
The system SHALL allow users to unregister a repository, cleaning up global directories.

#### Scenario: Remove repo with no working tasks
- **WHEN** user runs `aop repo:remove` for a repo with no WORKING tasks
- **THEN** system removes the repo record and marks associated tasks as REMOVED

#### Scenario: Remove repo with working tasks
- **WHEN** user runs `aop repo:remove` for a repo with WORKING tasks (without --force)
- **THEN** system displays error indicating tasks are in progress and exits with non-zero code

#### Scenario: Force remove repo with working tasks
- **WHEN** user runs `aop repo:remove --force` for a repo with WORKING tasks
- **THEN** system aborts all working tasks for the repo (worktrees preserved), then removes repo from database
