## ADDED Requirements

### Requirement: Discover env files in repository
The system SHALL discover all `.env*` files in a repository using `git ls-files`, respecting `.gitignore`.

#### Scenario: Find tracked env files
- **WHEN** the repository contains tracked `.env*` files
- **THEN** system discovers them via `git ls-files --cached "**/.env*"`

#### Scenario: Find untracked env files
- **WHEN** the repository contains untracked `.env*` files not in `.gitignore`
- **THEN** system discovers them via `git ls-files --others --exclude-standard "**/.env*"`

#### Scenario: Exclude gitignored paths
- **WHEN** `.env*` files exist inside `node_modules/`, `dist/`, or other `.gitignore`-excluded directories
- **THEN** system does NOT discover those files

#### Scenario: Deduplicate results
- **WHEN** a `.env*` file appears in both tracked and untracked results
- **THEN** system returns it only once

### Requirement: Symlink env files into worktree
The system SHALL symlink discovered `.env*` files from the main repo into the worktree after creation.

#### Scenario: Symlink root-level env file
- **WHEN** worktree is created and main repo has `.env` at root
- **THEN** system creates symlink at `{worktreePath}/.env` pointing to `{repoPath}/.env`

#### Scenario: Symlink nested env file
- **WHEN** worktree is created and main repo has `packages/api/.env.test`
- **THEN** system creates intermediate directories and symlinks at `{worktreePath}/packages/api/.env.test`

#### Scenario: No env files in repo
- **WHEN** worktree is created and main repo has no `.env*` files
- **THEN** system takes no action (no error)

#### Scenario: Env file already exists in worktree
- **WHEN** worktree already has a `.env*` file at the target path (e.g., tracked in git)
- **THEN** system skips that file without overwriting
