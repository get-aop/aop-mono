## ADDED Requirements

### Requirement: Centralized path resolution
The system SHALL provide a single `aopPaths` module that resolves all AOP-managed filesystem paths from `~/.aop/`.

#### Scenario: Resolve AOP home directory
- **WHEN** `aopPaths.home()` is called
- **THEN** system returns `~/.aop`

#### Scenario: Resolve database path
- **WHEN** `aopPaths.db()` is called
- **THEN** system returns `~/.aop/aop.sqlite`

#### Scenario: Resolve logs directory
- **WHEN** `aopPaths.logs()` is called
- **THEN** system returns `~/.aop/logs`

#### Scenario: Resolve repo base directory
- **WHEN** `aopPaths.repoDir(repoId)` is called
- **THEN** system returns `~/.aop/repos/{repoId}`

#### Scenario: Resolve openspec changes directory
- **WHEN** `aopPaths.openspecChanges(repoId)` is called
- **THEN** system returns `~/.aop/repos/{repoId}/openspec/changes`

#### Scenario: Resolve worktrees directory
- **WHEN** `aopPaths.worktrees(repoId)` is called
- **THEN** system returns `~/.aop/repos/{repoId}/worktrees`

#### Scenario: Resolve single worktree path
- **WHEN** `aopPaths.worktree(repoId, taskId)` is called
- **THEN** system returns `~/.aop/repos/{repoId}/worktrees/{taskId}`

#### Scenario: Resolve worktree metadata directory
- **WHEN** `aopPaths.worktreeMetadata(repoId)` is called
- **THEN** system returns `~/.aop/repos/{repoId}/worktrees/.metadata`
