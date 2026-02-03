## 1. Database Schema Migration

- [x] 1.1 Add `settings` table to schema.ts (key TEXT PRIMARY KEY, value TEXT NOT NULL)
- [x] 1.2 Add `repos` table to schema.ts (id, path, name, remote_origin, max_concurrent_tasks, created_at, updated_at)
- [x] 1.3 Refactor `tasks` table: add repo_id FK, ready_at, remove agent_pid/session_id/exit_code/error (move to step_executions)
- [x] 1.4 Add `executions` table to schema.ts (id, task_id, status, started_at, completed_at)
- [x] 1.5 Add `step_executions` table to schema.ts (id, execution_id, agent_pid, session_id, status, exit_code, error, started_at, ended_at)
- [x] 1.6 Update migrations.ts to create all tables with proper FKs and indexes
- [x] 1.7 Add default settings insert (max_concurrent_tasks, watcher_poll_interval_secs, queue_poll_interval_secs, agent_timeout_secs)
- [x] 1.8 Update connection.ts to use `~/.aop/aop.sqlite` path
- [x] 1.9 Write unit tests for migrations (tables created, defaults inserted)

## 2. Settings Domain

- [x] 2.1 Create `apps/cli/src/settings/types.ts` with Setting type and known keys
- [x] 2.2 Create `apps/cli/src/settings/store.ts` with getSetting, setSetting, getAllSettings
- [x] 2.3 Write unit tests for settings store (get/set/getAll, unknown key handling)

## 3. Repos Domain

- [x] 3.1 Create `apps/cli/src/repos/types.ts` with Repo type
- [x] 3.2 Create `apps/cli/src/repos/store.ts` with createRepo, getRepoByPath, getAllRepos, removeRepo
- [x] 3.3 Add helper to extract repo name from path and detect remote origin via git
- [x] 3.4 Write unit tests for repos store (create, get, remove, duplicate handling)

## 4. Tasks Domain Refactor

- [x] 4.1 Update `apps/cli/src/tasks/types.ts` to match new schema (repo_id, ready_at, REMOVED status)
- [x] 4.2 Update `apps/cli/src/tasks/store.ts` with new queries (by repo, by status, FIFO ordering)
- [x] 4.3 Add createTaskIdempotent (INSERT ON CONFLICT DO NOTHING)
- [x] 4.4 Add markTaskRemoved (UPDATE with status guard for non-WORKING)
- [x] 4.5 Add getNextExecutableTask (FIFO, respects global + repo limits)
- [x] 4.6 Write unit tests for task store (idempotent create, status transitions, FIFO ordering)

## 5. Executions Domain

- [x] 5.1 Create `apps/cli/src/executions/types.ts` with Execution and StepExecution types
- [x] 5.2 Create `apps/cli/src/executions/store.ts` with CRUD for executions and step_executions
- [x] 5.3 Add getLatestStepExecution for resume logic
- [x] 5.4 Write unit tests for executions store

## 6. File Watcher

- [x] 6.1 Create `apps/cli/src/watcher/types.ts` with WatcherEvent type
- [x] 6.2 Create `apps/cli/src/watcher/watcher.ts` using Bun's fs.watch for openspec/changes/
- [x] 6.3 Implement debouncing (500ms) for rapid file writes
- [x] 6.4 Create `apps/cli/src/watcher/ticker.ts` for polling reconciliation
- [x] 6.5 Create `apps/cli/src/watcher/reconcile.ts` with idempotent task detection logic
- [x] 6.6 Write unit tests for watcher (debounce, event types)
- [x] 6.7 Write unit tests for reconcile (new dir → task, deleted dir → removed)

## 7. Queue Processor

- [x] 7.1 Create `apps/cli/src/queue/processor.ts` with processQueue loop
- [x] 7.2 Implement global + per-repo concurrency limit checking
- [x] 7.3 Implement FIFO task selection via getNextExecutableTask
- [x] 7.4 Add configurable poll interval from settings
- [x] 7.5 Write unit tests for queue processor (limit enforcement, FIFO ordering)

## 8. Workflow Executor (Throwaway)

- [x] 8.1 Create `apps/cli/src/executor/executor.ts` with executeTask function
- [x] 8.2 Implement worktree creation via git-manager
- [x] 8.3 Implement prompt rendering via naive-implement.md.hbs
- [x] 8.4 Implement agent spawning via ClaudeCodeProvider.run() with onOutput streaming
- [x] 8.5 Implement log streaming to `~/.aop/logs/<task_id>.jsonl`
- [x] 8.6 Implement inactivity timeout watchdog
- [x] 8.7 Implement status updates (WORKING → DONE/BLOCKED)
- [x] 8.8 Write unit tests for executor (mocked agent, status transitions)

## 9. Daemon Lifecycle

- [x] 9.1 Create `apps/cli/src/daemon/daemon.ts` with start/stop/isRunning
- [x] 9.2 Implement PID file management (`~/.aop/aop.pid`)
- [x] 9.3 Implement graceful shutdown on SIGTERM
- [x] 9.4 Integrate file watcher, ticker, and queue processor in daemon
- [x] 9.5 Implement resumeWorkingTasks on daemon start
- [x] 9.6 Implement isProcessAlive check for agent PID
- [x] 9.7 Write unit tests for daemon lifecycle (PID file, signal handling)

## 10. CLI Commands

- [x] 10.1 Create `apps/cli/src/commands/start.ts` - start daemon
- [x] 10.2 Create `apps/cli/src/commands/stop.ts` - stop daemon
- [x] 10.3 Update `apps/cli/src/commands/status.ts` - show daemon state + tasks grouped by repo
- [x] 10.4 Add `--json` flag to status command for machine-readable output
- [x] 10.5 Create `apps/cli/src/commands/repo-init.ts` - register current repo
- [x] 10.6 Create `apps/cli/src/commands/repo-remove.ts` - unregister repo
- [x] 10.7 Create `apps/cli/src/commands/task-ready.ts` - mark task READY
- [x] 10.8 Update `apps/cli/src/commands/run.ts` to work with new task structure
- [x] 10.9 Create `apps/cli/src/commands/config-get.ts` - get setting(s)
- [x] 10.10 Create `apps/cli/src/commands/config-set.ts` - set setting
- [x] 10.11 Update main.ts with command routing for namespaced commands (repo:init, task:ready, etc.)
- [x] 10.12 Write unit tests for each command (argument parsing, error cases)

## 11. Integration Tests

- [x] 11.1 Create integration test for watcher → task detection flow
- [x] 11.2 Create integration test for queue processor → executor flow
- [x] 11.3 Create integration test for daemon restart → resume flow
- [x] 11.4 Create integration test for concurrency limit enforcement

## 12. E2E Test Setup

- [x] 12.1 Update e2e-tests/src/utils.ts with helpers for daemon (startDaemon, stopDaemon, waitForTask)
- [x] 12.2 Create fixture: e2e-tests/fixtures/backlog-test/proposal.md (simple task for backlog testing)
- [x] 12.3 Create fixture: e2e-tests/fixtures/backlog-test/tasks.md

## 13. E2E Tests

**IMPORTANT**: E2E tests MUST use real agents. These are real-world use cases, NEVER mocks.

- [x] 13.1 Create e2e-tests/src/daemon.e2e.ts testing daemon start/stop lifecycle
- [x] 13.2 Create e2e-tests/src/backlog.e2e.ts testing full backlog flow:
  - Register repo with `aop repo:init`
  - Start daemon with `aop start`
  - Copy fixture to openspec/changes/
  - Verify task auto-detected as DRAFT via `aop status --json`
  - Mark task ready with `aop task:ready`
  - Wait for task to complete (status → DONE)
  - Stop daemon with `aop stop`
- [x] 13.3 Create e2e-tests/src/concurrency.e2e.ts testing concurrency limits (multiple READY tasks, verify limit enforced)
- [x] 13.4 Verify all E2E tests pass with real agent execution
- [x] 13.5 Update test scripts to include new E2E tests in `bun test:e2e`

## 14. E2E Test Comprehensive Verification

**IMPORTANT**: E2E tests must verify task status via CLI commands, not just file existence.

- [x] 14.1 Verify daemon.e2e.ts checks PID file creation and removal
- [x] 14.2 Verify backlog.e2e.ts uses `aop status <task> --json` to check status transitions
- [x] 14.3 Verify concurrency.e2e.ts uses `aop status --json` to verify working task counts
- [x] 14.4 Verify all E2E tests clean up properly (stop daemon, remove test repos)

## 15. Abort/Force Remove Operations

**Goal**: Allow removing repos and tasks even when agents are running. Behaves as an abort - halts agent executions and cleans up.

- [x] 15.1 Create `apps/cli/src/executor/abort.ts` with `abortTask(taskId)` function
  - Send SIGTERM to agent PID if running (from step_executions)
  - Wait briefly for graceful shutdown, then SIGKILL if still alive
  - Update task status to REMOVED
  - Update execution status to ABORTED
  - NOTE: Worktree NOT automatically removed (user must clean up manually to avoid losing work)
- [x] 15.2 Add `--force` flag to `repo:remove` command
  - When set, abort all working tasks for the repo before removal
  - Call abortTask for each working task
  - Then proceed with repo removal
- [x] 15.3 Create `apps/cli/src/commands/task-remove.ts` with `task:remove <task-id>` command
  - If task is WORKING, call abortTask to halt agent
  - If task is DRAFT/READY/BLOCKED/DONE, just mark as REMOVED
  - Add `--force` flag to skip confirmation for working tasks
- [x] 15.4 Add ABORTED status to execution types and store
- [x] 15.5 Write unit tests for abort.ts (signal handling, cleanup, status updates)
- [x] 15.6 Write unit tests for task:remove command (all status scenarios)
- [x] 15.7 Write unit tests for repo:remove --force (multiple working tasks aborted)
- [x] 15.8 Update CLI help text to document --force behavior
