## 1. Setup New App

- [x] 1.1 Create `apps/local-server/` directory structure
- [x] 1.2 Create `apps/local-server/package.json` with hono dependency
- [x] 1.3 Add `local-server` to workspace in root `package.json`
- [x] 1.4 Add `AOP_PORT` env var support (default: 3847, read from `process.env.AOP_PORT`)

## 2. Server Core

- [x] 2.1 Create `app.ts` with Hono app and route registration
- [x] 2.2 Implement `/api/health` endpoint (ok, service, uptime, db status, orchestrator status)
- [x] 2.3 Implement `/api/status` endpoint (repos, tasks, capacity, ready state)
- [x] 2.4 Implement `/api/refresh` endpoint (triggers reconciliation)
- [x] 2.5 Create `run.ts` entry point (Bun.serve + orchestrator init + signal handling)

## 3. Repo and Task Endpoints

- [x] 3.1 Implement `POST /api/repos` (register repo)
- [x] 3.2 Implement `DELETE /api/repos/:id` (remove repo, with force query param)
- [x] 3.3 Implement `GET /api/repos/:id/tasks` (list tasks for repo)
- [x] 3.4 Implement `POST /api/repos/:repoId/tasks/:taskId/ready` (mark task ready)
- [x] 3.5 Implement `DELETE /api/repos/:repoId/tasks/:taskId` (remove task)

## 4. Config Endpoints

- [x] 4.1 Implement `GET /api/config` (get all config)
- [x] 4.2 Implement `GET /api/config/:key` (get single config)
- [x] 4.3 Implement `PUT /api/config/:key` (set config value)
- [x] 4.5 Reorg routes to be located closer to their domain package. `/src/settings/routes.ts`, `/src/repo/routes.ts`, `/src/task/routes.ts`.
- [x] 4.6 Move all DB functionalities into the local-server, CLI should access the database via the local-server's API.
- [x] 4.7 Move all core functionalities from CLI daemon into the local-server, CLI should access the functionalities via the local-server's API. (move handlers, repositories, watcher, ticker, executor, all the services, etc. -- CLI should be a small thin layer)
- [x] 4.8 Rename `config/` to `settings/` and update route from `/api/config` to `/api/settings`. Unify naming across the codebase.

## 5. Orchestrator

- [x] 5.1 Move services initialization from CLI daemon into `local-server/orchestrator.ts`
- [x] 5.2 Implement `startOrchestrator()` that initializes watcher, ticker, processor, remote sync
- [x] 5.3 Implement `orchestrator.stop()` for graceful shutdown
- [x] 5.4 Wire SIGTERM/SIGINT handlers in `run.ts` to call orchestrator.stop() then server.stop()
- [x] 5.5 Rename `services.ts` to `orchestrator.ts` and update all references (startServices → startOrchestrator, services → orchestrator)

## 6. CLI Client Helper

- [x] 6.1 Create `commands/client.ts` with `isServerRunning()` using health check
- [x] 6.2 Add `getServerUrl()` helper that reads from `AOP_URL` env or defaults to `http://localhost:3847`
- [x] 6.3 Add `requireServer()` helper that exits with error if server not running

## 7. Update CLI Commands

All commands now require running local server - no offline fallback.

- [x] 7.1 Remove `start.ts` command (server started externally)
- [x] 7.2 Remove `stop.ts` command (server stopped externally via Ctrl+C/kill)
- [x] 7.3 Update `status.ts` to call `/api/status`, error if server not running
- [x] 7.4 Update `repo-init.ts` to call `POST /api/repos`, error if server not running
- [x] 7.5 Update `repo-remove.ts` to call `DELETE /api/repos/:id`, error if server not running
- [x] 7.6 Update `task-ready.ts` to call `/api/repos/:repoId/tasks/:taskId/ready`, error if server not running
- [x] 7.7 Update `task-remove.ts` to call `DELETE /api/repos/:repoId/tasks/:taskId`, error if server not running
- [x] 7.8 Update `config-get.ts` to call `/api/settings` endpoints, error if server not running
- [x] 7.9 Update `config-set.ts` to call `PUT /api/settings/:key`, error if server not running

## 8. Cleanup

- [x] 8.1 Remove `run.ts` command from CLI (task:run POC)
- [x] 8.2 Remove `daemon/` directory from CLI entirely
- [x] 8.3 Remove `pid-utils.ts` from CLI (no longer needed)
- [x] 8.4 Remove AOP_PORT from CLI settings types (use env var only)
- [x] 8.5 Update CLI command index to remove start/stop exports

## 9. Architecture Compliance

Ensure code follows CLAUDE.md data flow guidelines: thin entrypoints → services → repositories.

- [x] 9.1 Audit routes for repository imports - routes must NOT import repositories directly
- [x] 9.2 Create services for any routes that currently call repositories (move business logic to service layer)
- [x] 9.3 Verify all routes follow pattern: parse input → call service → return response

## 10. Unit and Integration Tests

- [x] 10.1 Add unit tests for server endpoints (health, status, repos, tasks, settings)
- [x] 10.2 Add integration tests for CLI commands with server running
- [x] 10.3 Add test for graceful shutdown (SIGTERM waits for executing tasks)

## 11. Dev Environment Setup

- [x] 11.1 Update `scripts/dev.ts` to orchestrate local server initialization alongside other services
- [x] 11.2 Add environment variable documentation for local server config (AOP_PORT, AOP_URL)
- [x] 11.3 Update README with local server setup instructions

## 12. Documentation

- [x] 12.1 Update ARCHITECTURE.md to reflect new `apps/local-server/` structure and CLI as HTTP client
- [x] 12.2 Update README.md with local server startup instructions and breaking changes
- [x] 12.3 Add example systemd/launchd service files for running local server as a service
- [x] 12.4 Document migration path from old daemon to new local server architecture

## 13. E2E Tests

**CRITICAL: Do NOT mark tasks complete until E2E tests pass. E2E tests MUST use real API calls, real agent execution, real workflow parsing. These are real-world use cases - NEVER use mocks. The entire environment must be running locally and working literally end-to-end.**

- [x] 13.1 Update existing E2E tests for full workflow execution via local server
- [x] 13.2 Verify entire E2E test suite passes with real API calls, agent execution, workflow parsing - NO MOCKS. Do not check this until verified working.

## 14. Apply Command Migration

Convert apply command to use local server API instead of direct repository access.

- [x] 14.0 Cleanup any task repository/db logic
- [x] 14.1 Add `POST /api/repos/:repoId/tasks/:taskId/apply` endpoint to local-server
- [x] 14.2 Move `applyTask` handler logic from CLI to `local-server/src/task/handlers.ts`
- [x] 14.3 Add task resolution endpoint `GET /api/tasks/resolve/:identifier` to resolve task by id/name/index
- [x] 14.4 Update CLI `apply.ts` command to call server API via `requireServer()` pattern
- [x] 14.5 Remove `tasks/handlers/apply.ts` from CLI (logic moved to server)
- [x] 14.6 Remove `tasks/resolve.ts` from CLI (use server's resolve endpoint)
- [x] 14.7 Add tests for new apply endpoint and resolve endpoint

## 15. Consolidate Executions into Executor

Move executions repository and types into executor module (vertical slice organization).

- [x] 15.1 Move `executions/repository.ts` to `executor/execution-repository.ts`
- [x] 15.2 Move `executions/types.ts` to `executor/execution-types.ts` (merge with existing types.ts if needed)
- [x] 15.3 Update all imports referencing executions module
- [x] 15.4 Remove empty `executions/` directory
- [x] 15.5 Move `executions/repository.test.ts` to `executor/execution-repository.test.ts`

## 16. Reorganize Orchestrator Module

Create `orchestrator/` folder and consolidate related modules under it.

- [x] 16.1 Create `orchestrator/` directory structure
- [x] 16.2 Move `orchestrator.ts` to `orchestrator/orchestrator.ts`
- [x] 16.3 Move `sync/` to `orchestrator/sync/`
- [x] 16.4 Move `watcher/` to `orchestrator/watcher/`
- [x] 16.5 Move `queue/` to `orchestrator/queue/`
- [x] 16.6 Create `orchestrator/index.ts` that exports orchestrator functions
- [x] 16.7 Update all imports referencing moved modules
- [x] 16.8 Move `orchestrator.test.ts` to `orchestrator/orchestrator.test.ts`

## 17. Code Coverage Fixes

Coverage threshold failing - add tests for uncovered code in local-server.

- [x] 17.1 Add tests for `executor/abort.ts` (0% function coverage, 8.65% line coverage)
- [x] 17.2 Add tests for `executor/executor.ts` (0% function coverage, 6.69% line coverage)
- [x] 17.3 Add tests for `repo/handlers.ts` (70% function coverage, 37.08% line coverage - uncovered: lines 27-53, 66, 76, 81, 87-96, 112-127)
- [x] 17.4 Add tests for `repo/routes.ts` (83.33% function coverage, 64.41% line coverage - uncovered: lines 9-27, 47-48)
- [x] 17.5 Add tests for `task/repository.ts` (75% function coverage, 55.46% line coverage - uncovered: lines 30, 34-42, 51-57, 69, 92, 118, 138-170)
- [x] 17.6 Add tests for `task/resolve.ts` (66.67% function coverage, 42.86% line coverage - uncovered: lines 29-44)
- [x] 17.7 Add tests for `db/connection.ts` (50% function coverage, 94.44% line coverage)
- [x] 17.8 Verify `bun test:coverage` passes with no threshold failures
