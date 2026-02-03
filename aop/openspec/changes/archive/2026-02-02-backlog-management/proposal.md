## Why

Milestone 1 validated the core loop: one task, one agent, manual execution. Now we need the backlog infrastructure to manage tasks across multiple repositories before building the remote orchestration layer. This milestone establishes the local-first task management that all future capabilities (server sync, dashboard) build upon.

## What Changes

- **Repository registration**: CLI tracks which repos to watch, stored in SQLite
- **File watcher daemon**: Long-running process detects OpenSpec changes across all registered repos
- **Task auto-detection**: New `openspec/changes/` directories automatically create DRAFT tasks
- **Unified backlog**: Single view of all tasks across all repos with status tracking
- **Execution tracking**: Record of workflow runs, step attempts, and outcomes
- **Full CLI interface**: `init`, `start`, `stop`, `status`, `list`, `run` commands
- **Local workflow runner**: Minimal throwaway implementation (replaced by server in Milestone 3)

## Capabilities

### New Capabilities

- `repo-management`: Repository registration, listing, and removal. Stores repo metadata in SQLite including path, name, remote origin, and default workflow.
- `file-watcher`: Daemon mode file watching for `openspec/changes/` directories across all registered repos. Detects new changes, deletions, and modifications.
- `task-detector`: Automatic task creation from OpenSpec changes. Maps change directories to DRAFT tasks with proper repo association.
- `execution-tracking`: Track workflow executions, current step, iteration count, and step-level history with agent PID and session ID for resume.
- `cli-commands`: Full CLI command set for backlog management (`init`, `start`, `stop`, `status`, `list`, `run`).
- `local-workflow-runner`: Temporary local workflow execution (throwaway code). Runs steps sequentially, handles transitions, tracks state. Will be deleted in Milestone 3.
- `abort-operations`: Force removal of repos and tasks even when agents are running. Sends SIGTERM/SIGKILL to agent processes, updates statuses to REMOVED/ABORTED. Worktrees preserved (user must clean up manually).

### Modified Capabilities

None - existing packages (git-manager, llm-provider) work as-is. Multi-repo awareness lives in the CLI orchestration layer.

## Impact

**Code changes**:
- New `apps/cli/` application with domain modules (repos, watcher, tasks, executions, commands)
- SQLite database with Kysely migrations (repos, tasks, executions, step_executions tables)
- Integration with existing `git-manager` and `llm-provider` packages

**Dependencies**:
- `kysely` + `kysely-bun-sqlite` for database
- Bun's native file watcher for change detection

**Breaking changes**: None (greenfield CLI app)

**Testing**: Each domain module needs unit tests. Integration tests for watcher → detector → task flow.
