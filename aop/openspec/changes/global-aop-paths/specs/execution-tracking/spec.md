## MODIFIED Requirements

### Requirement: Build execution context
The system SHALL resolve worktree and change paths via the centralized `aopPaths` module instead of repo-relative path construction.

#### Scenario: Resolve change path
- **WHEN** executor builds context for a task
- **THEN** changePath is resolved as `aopPaths.openspecChanges(repo.id)` + change name extracted from `task.change_path`

#### Scenario: Resolve worktree path
- **WHEN** executor builds context for a task
- **THEN** worktreePath is resolved as `aopPaths.worktree(repo.id, task.id)`

#### Scenario: Create worktree with repo ID
- **WHEN** executor creates a worktree for a task
- **THEN** GitManager is instantiated with both `repoPath` and `repoId`
- **AND** worktree is created at `~/.aop/repos/{repoId}/worktrees/{taskId}`
