# git-manager Specification

## Purpose

Git worktree lifecycle management for task isolation. Enables parallel agent work through isolated filesystems and clean PR workflows via squash merging.

## ADDED Requirements

### Requirement: Worktree Creation

The system SHALL create isolated git worktrees for tasks, enabling parallel work without conflicts.

#### Scenario: Create worktree from base branch

- **WHEN** `createWorktree("feat-auth", "main")` is called
- **THEN** a new directory is created at `.worktrees/feat-auth`
- **AND** a new branch `feat-auth` is created from `main`
- **AND** the worktree is checked out to that branch
- **AND** returns `WorktreeInfo` with path, branch, and baseCommit

#### Scenario: Auto-initialize worktrees directory

- **WHEN** `createWorktree` is called and `.worktrees/` does not exist
- **THEN** the system creates `.worktrees/` directory
- **AND** adds `.worktrees/` to `.gitignore` if not already present

#### Scenario: Worktree already exists

- **WHEN** `createWorktree` is called with a taskId that already has a worktree
- **THEN** the system throws `WorktreeExistsError`

#### Scenario: Base branch does not exist

- **WHEN** `createWorktree` is called with a non-existent base branch
- **THEN** the system throws `BranchNotFoundError`

### Requirement: Squash Merge to PR Branch

The system SHALL squash merge all work branch commits into a new PR branch for clean pull request workflows.

#### Scenario: Successful squash merge

- **WHEN** `squashMerge("feat-auth", "pr/feat-auth", "feat: add authentication")` is called
- **THEN** a new branch `pr/feat-auth` is created from the original base commit
- **AND** all commits from `feat-auth` are squash-merged into `pr/feat-auth`
- **AND** a single commit is created with the provided message
- **AND** returns `SquashResult` with targetBranch and commitSha

#### Scenario: Merge conflict occurs

- **WHEN** `squashMerge` is called and the merge has conflicts
- **THEN** the system throws `GitConflictError`
- **AND** the error includes the list of conflicting files
- **AND** no partial merge state is left behind

#### Scenario: Target branch already exists

- **WHEN** `squashMerge` is called with a targetBranch that already exists
- **THEN** the system checks out the existing target branch
- **AND** squash merges the work branch commits into it
- **AND** creates a commit with the provided message
- **AND** returns `SquashResult` with targetBranch and commitSha

#### Scenario: Worktree has no commits

- **WHEN** `squashMerge` is called on a worktree with no commits beyond base
- **THEN** the system throws `NoCommitsError`

### Requirement: Worktree Removal

The system SHALL clean up worktrees and their associated work branches.

#### Scenario: Remove clean worktree

- **WHEN** `removeWorktree("feat-auth")` is called on a worktree with no uncommitted changes
- **THEN** the `.worktrees/feat-auth` directory is removed
- **AND** the `feat-auth` branch is deleted
- **AND** the PR branch (if any) is NOT deleted

#### Scenario: Remove worktree with uncommitted changes

- **WHEN** `removeWorktree` is called on a worktree with uncommitted changes
- **THEN** the system throws `DirtyWorktreeError`
- **AND** the worktree is NOT removed

#### Scenario: Worktree does not exist

- **WHEN** `removeWorktree` is called with a taskId that has no worktree
- **THEN** the system throws `WorktreeNotFoundError`

### Requirement: Repository Context

The system SHALL operate within a git repository context.

#### Scenario: Initialize with repository path

- **WHEN** `GitManager` is instantiated with a repository path
- **THEN** it uses that path as the working directory for all git operations

#### Scenario: Not a git repository

- **WHEN** operations are attempted outside a git repository
- **THEN** the system throws `NotAGitRepositoryError`
