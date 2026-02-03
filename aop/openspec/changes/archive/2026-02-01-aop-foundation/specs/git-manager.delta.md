## MODIFIED Purpose

Git worktree lifecycle management for task isolation. Enables parallel agent work through isolated filesystems, applying completed work to main repo, and clean PR workflows via squash merging.

## ADDED Requirements

### Requirement: Apply Worktree Changes

The system SHALL apply changes from a worktree to the main repository working directory, allowing users to review and commit manually.

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
- **AND** error message suggests committing or stashing first

#### Scenario: Worktree has no changes

- **WHEN** `applyWorktree` is called on a worktree with no changes beyond base
- **THEN** the system throws `NoChangesError`

**Note**: Worktree is NOT removed after apply. Cleanup is handled separately via dashboard (future).
