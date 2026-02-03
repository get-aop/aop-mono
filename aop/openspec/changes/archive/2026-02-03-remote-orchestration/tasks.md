## 1. Protocol Types (packages/common)

- [x] 1.1 Create `packages/common/src/protocol/` directory structure
- [x] 1.2 Create Zod schema for `AuthRequest` (requestedMaxConcurrentTasks?)
- [x] 1.3 Create Zod schema for `AuthResponse` (clientId, effectiveMaxConcurrentTasks)
- [x] 1.4 Create Zod schema for `SyncRepoRequest` (syncedAt)
- [x] 1.5 Create Zod schema for `SyncTaskRequest` (repoId, status, syncedAt)
- [x] 1.6 Create Zod schema for `TaskReadyRequest` (repoId)
- [x] 1.7 Create Zod schema for `TaskReadyResponse` (status, execution?, step?, queued?)
- [x] 1.8 Create Zod schema for `StepCommand` (id, type, promptTemplate, attempt)
- [x] 1.9 Create Zod schema for `StepCompleteRequest` (executionId, attempt, status, error?, durationMs)
- [x] 1.10 Create Zod schema for `StepCompleteResponse` (taskStatus, step?, error?)
- [x] 1.11 Create Zod schema for `TaskStatusResponse` (status, execution with awaitingResult)
- [x] 1.12 Create error codes enum (agent_timeout, agent_crash, script_failed, aborted, max_retries_exceeded, prompt_not_found)
- [x] 1.13 Create abort reason enum (task_removed, change_files_deleted)
- [x] 1.14 Export all types and schemas from `@aop/common/protocol`
- [x] 1.15 Add unit tests for schema validation

## 2. Server Database (apps/server/src/db)

- [x] 2.1 Create `apps/server/` application structure
- [x] 2.2 Add PostgreSQL dependencies (Bun.sql, Kysely with pg dialect)
- [x] 2.3 Create database connection module with connection pooling
- [x] 2.4 Create Kysely migration for `clients` table (id, api_key, max_concurrent_tasks, created_at, last_seen_at)
- [x] 2.5 Create Kysely migration for `workflows` table (id, name, definition JSON, version, created_at)
- [x] 2.6 Create Kysely migration for `repos` table (id, client_id, synced_at)
- [x] 2.7 Create Kysely migration for `tasks` table (id, client_id, repo_id, status, synced_at)
- [x] 2.8 Create Kysely migration for `executions` table (id, client_id, task_id, workflow_id, status, started_at, completed_at)
- [x] 2.9 Create Kysely migration for `step_executions` table (id, client_id, execution_id, step_type, prompt_template, status, error_code, started_at, ended_at)
- [x] 2.10 Create seed migration for test client (api_key: `aop_test_key_dev`, max_concurrent_tasks: 5)
- [x] 2.11 Create migration runner that runs on server startup

## 3. Server Repositories (apps/server/src/repositories)

- [x] 3.1 Create `client-repository.ts` with findByApiKey, create, updateLastSeen
- [x] 3.2 Create `workflow-repository.ts` with findById, findByName, create
- [x] 3.3 Create `repo-repository.ts` with findById, upsert
- [x] 3.4 Create `task-repository.ts` with findById, upsert, countWorkingByClient
- [x] 3.5 Create `execution-repository.ts` with create, update, findActiveByTask
- [x] 3.6 Create `step-execution-repository.ts` with create, update, findById
- [x] 3.7 Add integration tests for repositories

### 3.8 Relocate Repositories to Domain Folders (vertical slices)

Move repositories next to their domain logic instead of a separate `repositories/` layer:

- [x] 3.8.1 Move `execution-repository.ts` and `step-execution-repository.ts` to `executions/`
- [x] 3.8.2 Move `workflow-repository.ts` to `workflow/`
- [x] 3.8.3 Create `tasks/` folder and move `task-repository.ts` there
- [x] 3.8.4 Create `clients/` folder and move `client-repository.ts` there
- [x] 3.8.5 Create `repos/` folder and move `repo-repository.ts` there
- [x] 3.8.6 Update all imports across the server app
- [x] 3.8.7 Delete the empty `repositories/` folder and its `index.ts`
- [x] 3.8.8 Update CLAUDE.md to document server vertical slice structure

### 3.9 Extract Domain Logic from Routes (thin routes refactor)

Routes currently violate thin-routes principle by calling repositories directly and containing business logic. Fix:

- [x] 3.9.1 Create `clients/client-service.ts` with `authenticate(apiKey, requestedMax)` - move logic from auth.ts
- [x] 3.9.2 Refactor `auth.ts` route to only parse input and call `clientService.authenticate()`
- [x] 3.9.3 Create `repos/repo-service.ts` with `syncRepo(clientId, repoId, syncedAt)` - move logic from repos.ts
- [x] 3.9.4 Refactor `repos.ts` route to only parse input and call `repoService.syncRepo()`
- [x] 3.9.5 Create `tasks/task-service.ts` with `syncTask()` and `getTaskStatus()` - move logic from tasks.ts
- [x] 3.9.6 Refactor `tasks.ts` routes to call task-service (sync and status endpoints)
- [x] 3.9.7 Remove all repository imports from route files - routes should only import services
- [x] 3.9.8 Add unit tests for new service functions

## 4. Prompt Library (apps/server/src/prompts)

- [x] 4.1 Create `templates/` directory structure
- [x] 4.2 Create `implement.md.hbs` prompt template with Handlebars placeholders
- [x] 4.3 Create `test.md.hbs` prompt template
- [x] 4.4 Create `review.md.hbs` prompt template
- [x] 4.5 Create `debug.md.hbs` prompt template
- [x] 4.6 Create `template-loader.ts` to load templates from filesystem
- [x] 4.7 Add unit tests for template loading

## 5. Workflow Engine (apps/server/src/workflow)

- [x] 5.1 Define workflow definition TypeScript types (steps, transitions, conditions)
- [x] 5.2 Create `workflow-parser.ts` to parse and validate workflow JSON
- [x] 5.3 Create `workflow-state-machine.ts` for execution state management
- [x] 5.4 Implement transition evaluation logic (success/failure conditions)
- [x] 5.5 Create `step-command-generator.ts` to build step command responses
- [x] 5.6 Implement workflow completion detection (terminal states)
- [x] 5.7 Seed default "simple" workflow in migration (implement → done)
- [x] 5.8 Add unit tests for workflow parser and state machine

## 6. REST API Server (apps/server/src/api)

- [x] 6.1 Create Hono HTTP server with routes structure
- [x] 6.2 Create auth middleware to validate API key header
- [x] 6.3 Implement `POST /auth` endpoint (validate key, return client info)
- [x] 6.4 Implement `POST /repos/{repoId}/sync` endpoint
- [x] 6.5 Implement `POST /tasks/{taskId}/sync` endpoint
- [x] 6.6 Implement `POST /tasks/{taskId}/ready` endpoint (start workflow, return first step)
- [x] 6.7 Implement `POST /steps/{stepId}/complete` endpoint (process result, return next step)
- [x] 6.8 Implement `GET /tasks/{taskId}/status` endpoint (for recovery)
- [x] 6.9 Implement `GET /health` endpoint
- [x] 6.10 Add request/response validation with Zod schemas
- [x] 6.11 Add error handling middleware

## 7. Server Execution Service (apps/server/src/executions)

- [x] 7.1 Create `execution-service.ts` for workflow orchestration
- [x] 7.2 Implement `startWorkflow` function (create execution, return first step)
- [x] 7.3 Implement `processStepResult` function (evaluate transition, return next step)
- [x] 7.4 Implement concurrency check (count WORKING tasks vs effectiveMaxConcurrentTasks)
- [x] 7.5 Implement idempotent step completion (dedupe by executionId + stepId + attempt)
- [x] 7.6 Add locking with `SELECT ... FOR UPDATE SKIP LOCKED` for race conditions
- [x] 7.7 Add unit tests for execution service

## 8. CLI Task Sync Fields (apps/cli)

- [x] 8.1 Add `remoteId` column to task table (nullable)
- [x] 8.2 Add `syncedAt` column to task table (nullable timestamp)
- [x] 8.3 Create Kysely migration for new columns
- [x] 8.4 Update task repository to include sync fields
- [x] 8.5 Add unit tests for task sync fields

## 9. CLI ServerSync (apps/cli/src/sync)

- [x] 9.1 Create `server-sync.ts` class with HTTP client
- [x] 9.2 Implement `authenticate()` method (POST /auth)
- [x] 9.3 Implement `syncRepo()` method (POST /repos/{id}/sync)
- [x] 9.4 Implement `syncTask()` method (POST /tasks/{id}/sync)
- [x] 9.5 Implement `markTaskReady()` method (POST /tasks/{id}/ready)
- [x] 9.6 Implement `completeStep()` method (POST /steps/{id}/complete)
- [x] 9.7 Implement `getTaskStatus()` method (GET /tasks/{id}/status)
- [x] 9.8 Implement retry with exponential backoff
- [x] 9.9 Implement request queue for offline mode
- [x] 9.10 Implement degraded mode when no API key or auth fails
- [x] 9.11 Track locally-queued READY tasks (when server returns `queued: true`)
- [x] 9.12 Implement retry for queued tasks when capacity frees (on DONE/BLOCKED/REMOVED response)
- [x] 9.13 Add unit tests for ServerSync

## 10. CLI Template Resolver (apps/cli/src/sync)

- [x] 10.1 Create `template-resolver.ts` for Handlebars placeholder resolution
- [x] 10.2 Implement worktree.path resolution
- [x] 10.3 Implement worktree.branch resolution
- [x] 10.4 Implement task.id, task.changePath resolution
- [x] 10.5 Implement step.type, step.executionId resolution
- [x] 10.6 Add unit tests for template resolution

## 11. CLI Daemon Integration (apps/cli/src/daemon)

- [x] 11.1 Integrate ServerSync into daemon startup
- [x] 11.2 Call authenticate() on daemon start (if API key configured)
- [x] 11.3 Retry queued READY tasks on daemon start
- [x] 11.4 Wire task status change events to syncTask()
- [x] 11.5 Wire markTaskReady() to return step command for executor
- [x] 11.6 Wire step completion to completeStep() and process response
- [x] 11.7 Trigger queued task retry when step completion returns DONE/BLOCKED/REMOVED
- [x] 11.8 Handle graceful shutdown
- [x] 11.9 Fix redundant `serverSync`/`injectedServerSync` fields in daemon - use single field with lazy init

### 11.10 Remove Duplicated Types from CLI (use @aop/common/protocol)

CLI sync module duplicates types that already exist in `@aop/common/protocol`. Replace with imports:

- [x] 11.10.1 Remove `TaskStatus` type definition from `server-sync.ts` - import from `@aop/common/protocol`
- [x] 11.10.2 Replace custom `MarkReadyResult` interface with `TaskReadyResponse` from protocol
- [x] 11.10.3 Replace custom `StepCompleteResult` interface with `StepCompleteResponse` from protocol
- [x] 11.10.4 Replace custom `TaskStatusResult` interface with `TaskStatusResponse` from protocol
- [x] 11.10.5 Audit all type definitions in `apps/cli/src/sync/` - remove any that duplicate `@aop/common`
- [x] 11.10.6 Update imports in consuming files (daemon, executor, etc.)
- [x] 11.10.7 Run type check to ensure no regressions

## 12. CLI Execution Model Changes (apps/cli/src/executor)

- [x] 12.1 Modify executor to accept step command from ServerSync response
- [x] 12.2 Update executor to use server-provided prompt template (resolved locally)
- [x] 12.3 Remove local workflow runner from queue processor
- [x] 12.4 Delete local prompt builder (`apps/cli/src/prompt/` if exists)
- [x] 12.5 Update execution-tracking to report via completeStep()

## 13. Dev Environment Setup

- [x] 13.1 Create `docker-compose.yml` with PostgreSQL service
- [x] 13.2 Create `scripts/dev.ts` to orchestrate all services (db, server, cli)
- [x] 13.3 Add environment variable documentation for server config
- [x] 13.4 Update README with dev setup instructions

## 14. E2E Tests

**IMPORTANT**: E2E tests MUST use real API calls, agent execution, workflow parsing etc. These are real-world use cases, NEVER mocks.

- [x] 14.1 Add E2E test for full workflow execution via server
   - [x] 14.1.1 Start the whole dev environment (`bun dev`) (not part of the test, manually start it)
   - [x] 14.1.2 Create a new test repository with a fixture task
   - [x] 14.1.3 Mark the task ready
   - [x] 14.1.5 Verify the agent starts
   - [x] 14.1.6 While the agent is running, verify the statuses of tasks and executions are correct (check data locally using the CLI, read the server database to confirm they are correct)
   - [x] 14.1.4 Wait for the task to complete
   - [x] 14.1.5 Verify the task is completed (again, check data properly, they must be in sync)
- [x] 14.3 Add E2E test for degraded mode (make sure you can manage tasks without server connection, and they are synced back to the server when the connection is restored)
- [x] 14.5 The entire E2E test suite must pass with real API calls, agent execution, workflow parsing etc. It MUST be the whole environment loaded locally and working literally end-to-end. Do not mock any components. Do not check this box until you can verify it works as expected.

## 15. Signal-Based Workflow Branching

Extend workflow transitions to support signal keywords detected in agent output, enabling multi-way branching from a single step.

- [x] 15.1 Update `WorkflowStepSchema` in `types.ts` to add optional `signals: z.array(z.string())`
- [x] 15.2 Update `TransitionSchema` to accept signal keywords and `__none__` as conditions
- [x] 15.3 Update `StepResult` interface to include optional `signal?: string` field
- [x] 15.4 Update `evaluateTransition` in `workflow-state-machine.ts` to check signal → `__none__` → success/failure
- [x] 15.5 Update `StepCompleteRequest` in `@aop/common/protocol` to include optional `signal` field
- [x] 15.6 Update `step-execution-repository.ts` to store detected signal
- [x] 15.7 Add `signal` column to `step_executions` table migration
- [x] 15.8 Update CLI `completeStep()` to accept and send signal
- [x] 15.9 Create signal detection utility in CLI (`detectSignal(output, signals)`)
- [x] 15.10 Wire signal detection into executor step completion flow
- [x] 15.11 Add unit tests for signal-based transitions in state machine
- [x] 15.12 Add unit tests for signal detection utility
- [x] 15.13 Seed "ralph-loop" workflow with iterate step and signal transitions

## 16. E2E Test: Ralph Loop Workflow

**IMPORTANT**: This E2E test MUST use real API calls, real agent execution, and real workflow parsing. NEVER mock components.

- [x] 16.1 Create `iterate.md.hbs` prompt template instructing agent to output signal keywords
- [x] 16.2 Create E2E test for ralph loop workflow execution
  - [x] 16.2.1 Start the dev environment (`bun dev`) - manual prerequisite
  - [x] 16.2.2 Create test repository with a multi-step task requiring iteration
  - [x] 16.2.3 Mark task ready, verify workflow starts with iterate step
  - [x] 16.2.4 Verify agent loops (iterate → iterate) when no signal detected
  - [x] 16.2.5 Verify agent completes when `TASK_COMPLETE` signal detected
  - [x] 16.2.6 Verify task status is DONE and execution is completed
  - [x] 16.2.7 Verify step_executions table contains signal values
- [x] 16.3 Add E2E test for signal branching to review step
  - [x] 16.3.1 Create task that triggers `NEEDS_REVIEW` signal
  - [x] 16.3.2 Verify workflow transitions iterate → review
  - [x] 16.3.3 Verify review step executes and completes workflow
- [x] 16.4 The ralph loop E2E tests must pass with real agent execution. Do not check this box until you can verify the agent successfully iterates and completes based on signal detection.
