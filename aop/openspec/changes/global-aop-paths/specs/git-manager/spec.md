## MODIFIED Requirements

### Requirement: Worktree Creation
The system SHALL create isolated git worktrees for tasks at a global path, enabling parallel work without conflicts.

#### Scenario: Create worktree at global path
- **WHEN** `createWorktree("feat-auth", "main")` is called
- **THEN** a new directory is created at `~/.aop/repos/{repoId}/worktrees/feat-auth`
- **AND** a new branch `feat-auth` is created from `main`
- **AND** the worktree is checked out to that branch
- **AND** returns `WorktreeInfo` with path, branch, and baseCommit
- **AND** `.env*` files from the main repo are symlinked into the worktree

#### Scenario: Auto-initialize worktrees directory
- **WHEN** `createWorktree` is called and `~/.aop/repos/{repoId}/worktrees/` does not exist
- **THEN** the system creates the directory

#### Scenario: Worktree already exists
- **WHEN** `createWorktree` is called with a taskId that already has a worktree
- **THEN** the system throws `WorktreeExistsError`

#### Scenario: Base branch does not exist
- **WHEN** `createWorktree` is called with a non-existent base branch
- **THEN** the system throws `BranchNotFoundError`

### Requirement: Repository Context
The system SHALL operate within a git repository context, with awareness of the global AOP repo directory.

#### Scenario: Initialize with repository path and repo ID
- **WHEN** `GitManager` is instantiated with a repository path and repo ID
- **THEN** it uses the repository path for git operations and the repo ID for resolving global worktree paths via `aopPaths`

#### Scenario: Not a git repository
- **WHEN** operations are attempted outside a git repository
- **THEN** the system throws `NotAGitRepositoryError`

### Requirement: Worktree Removal
The system SHALL clean up worktrees from the global path and their associated work branches.

#### Scenario: Remove clean worktree
- **WHEN** `removeWorktree("feat-auth")` is called on a worktree with no uncommitted changes
- **THEN** the `~/.aop/repos/{repoId}/worktrees/feat-auth` directory is removed
- **AND** the `feat-auth` branch is deleted
- **AND** the PR branch (if any) is NOT deleted

#### Scenario: Remove worktree with uncommitted changes
- **WHEN** `removeWorktree` is called on a worktree with uncommitted changes
- **THEN** the system throws `DirtyWorktreeError`
- **AND** the worktree is NOT removed

#### Scenario: Worktree does not exist
- **WHEN** `removeWorktree` is called with a taskId that has no worktree
- **THEN** the system throws `WorktreeNotFoundError`

### Requirement: Apply Worktree Changes
The system SHALL apply changes from a globally-located worktree to the main repository working directory.

#### Scenario: Successful apply
- **WHEN** `applyWorktree("feat-auth")` is called
- **THEN** the diff between the worktree's base commit and current state is computed
- **AND** that diff is applied to the main repository working directory
- **AND** returns `ApplyResult` with list of affected files
- **AND** the worktree is NOT automatically removed

#### Scenario: Apply with conflicts
- **WHEN** `applyWorktree` is called and changes conflict with main repo working directory
- **THEN** the system throws `ApplyConflictError`
- **AND** the error includes the list of conflicting files
- **AND** no partial changes are applied

#### Scenario: Main repo has uncommitted changes
- **WHEN** `applyWorktree` is called and main repo has uncommitted changes
- **THEN** the system throws `DirtyWorkingDirectoryError`
- **AND** no changes are applied

#### Scenario: Worktree has no changes
- **WHEN** `applyWorktree` is called on a worktree with no changes beyond base
- **THEN** the system throws `NoChangesError`

## REMOVED Requirements

### Requirement: Auto-initialize worktrees directory
**Reason**: Worktrees no longer live at `{repo}/.worktrees/`. The `.gitignore` management for `.worktrees/` is no longer needed since worktrees are at `~/.aop/repos/{repoId}/worktrees/`.
**Migration**: Remove `ensureGitignore()` method. Directory creation handled by `aopPaths` or `initRepo`.
