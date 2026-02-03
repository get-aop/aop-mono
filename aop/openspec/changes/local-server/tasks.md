## 1. Setup New App

- [ ] 1.1 Create `apps/local-server/` directory structure
- [ ] 1.2 Create `apps/local-server/package.json` with hono dependency
- [ ] 1.3 Add `local-server` to workspace in root `package.json`
- [ ] 1.4 Add `AOP_PORT` env var support (default: 3847, read from `process.env.AOP_PORT`)

## 2. Server Core

- [ ] 2.1 Create `app.ts` with Hono app and route registration
- [ ] 2.2 Implement `/api/health` endpoint (ok, service, uptime, db status, services status)
- [ ] 2.3 Implement `/api/status` endpoint (repos, tasks, capacity, ready state)
- [ ] 2.4 Implement `/api/refresh` endpoint (triggers reconciliation)
- [ ] 2.5 Create `run.ts` entry point (Bun.serve + services init + signal handling)

## 3. Repo and Task Endpoints

- [ ] 3.1 Implement `POST /api/repos` (register repo)
- [ ] 3.2 Implement `DELETE /api/repos/:id` (remove repo, with force query param)
- [ ] 3.3 Implement `GET /api/repos/:id/tasks` (list tasks for repo)
- [ ] 3.4 Implement `POST /api/repos/:repoId/tasks/:taskId/ready` (mark task ready)
- [ ] 3.5 Implement `DELETE /api/repos/:repoId/tasks/:taskId` (remove task)

## 4. Config Endpoints

- [ ] 4.1 Implement `GET /api/config` (get all config)
- [ ] 4.2 Implement `GET /api/config/:key` (get single config)
- [ ] 4.3 Implement `PUT /api/config/:key` (set config value)

## 5. Background Services

- [ ] 5.1 Move services initialization from CLI daemon into `local-server/services.ts`
- [ ] 5.2 Implement `startServices()` that initializes watcher, ticker, processor
- [ ] 5.3 Implement `services.stop()` for graceful shutdown
- [ ] 5.4 Wire SIGTERM/SIGINT handlers in `run.ts` to call services.stop() then server.stop()

## 6. CLI Client Helper

- [ ] 6.1 Create `commands/client.ts` with `isServerRunning()` using health check
- [ ] 6.2 Add `getServerUrl()` helper that reads from `AOP_URL` env or defaults to `http://localhost:3847`
- [ ] 6.3 Add `requireServer()` helper that exits with error if server not running

## 7. Update CLI Commands

All commands now require running local server - no offline fallback.

- [ ] 7.1 Remove `start.ts` command (server started externally)
- [ ] 7.2 Remove `stop.ts` command (server stopped externally via Ctrl+C/kill)
- [ ] 7.3 Update `status.ts` to call `/api/status`, error if server not running
- [ ] 7.4 Update `repo-init.ts` to call `POST /api/repos`, error if server not running
- [ ] 7.5 Update `repo-remove.ts` to call `DELETE /api/repos/:id`, error if server not running
- [ ] 7.6 Update `task-ready.ts` to call `/api/repos/:repoId/tasks/:taskId/ready`, error if server not running
- [ ] 7.7 Update `task-remove.ts` to call `DELETE /api/repos/:repoId/tasks/:taskId`, error if server not running
- [ ] 7.8 Update `config-get.ts` to call `/api/config` endpoints, error if server not running
- [ ] 7.9 Update `config-set.ts` to call `PUT /api/config/:key`, error if server not running

## 8. Cleanup

- [ ] 8.1 Remove `run.ts` command from CLI (task:run POC)
- [ ] 8.2 Remove `daemon/` directory from CLI entirely
- [ ] 8.3 Remove `pid-utils.ts` from CLI (no longer needed)
- [ ] 8.4 Remove AOP_PORT from CLI settings types (use env var only)
- [ ] 8.5 Update CLI command index to remove start/stop exports

## 9. Unit and Integration Tests

- [ ] 9.1 Add unit tests for server endpoints (health, status, repos, tasks, config)
- [ ] 9.2 Add integration tests for CLI commands with server running
- [ ] 9.3 Add test for graceful shutdown (SIGTERM waits for executing tasks)

## 10. Dev Environment Setup

- [ ] 10.1 Update `scripts/dev.ts` to orchestrate local server initialization alongside other services
- [ ] 10.2 Add environment variable documentation for local server config (AOP_PORT, AOP_URL)
- [ ] 10.3 Update README with local server setup instructions

## 12. Documentation

- [ ] 12.1 Update ARCHITECTURE.md to reflect new `apps/local-server/` structure and CLI as HTTP client
- [ ] 12.2 Update README.md with local server startup instructions and breaking changes
- [ ] 12.3 Add example systemd/launchd service files for running local server as a service
- [ ] 12.4 Document migration path from old daemon to new local server architecture

## 11. E2E Tests

**CRITICAL: Do NOT mark tasks complete until E2E tests pass. E2E tests MUST use real API calls, real agent execution, real workflow parsing. These are real-world use cases - NEVER use mocks. The entire environment must be running locally and working literally end-to-end.**

- [ ] 11.1 Update existing E2E tests for full workflow execution via internal server
- [ ] 11.2 Verify entire E2E test suite passes with real API calls, agent execution, workflow parsing - NO MOCKS. Do not check this until verified working.
