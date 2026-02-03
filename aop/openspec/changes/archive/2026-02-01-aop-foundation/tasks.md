## 1. Shared Types (packages/common)

- [x] 1.1 Create `packages/common` package with package.json and tsconfig
- [x] 1.2 Implement Task type with 5-state Status enum (DRAFT, READY, WORKING, BLOCKED, DONE)
- [x] 1.3 Export types from index.ts

## 2. Infrastructure (packages/infra)

- [x] 2.1 Add `typeid-js` dependency to packages/infra
- [x] 2.2 Create typeid.ts with helper functions for generating typed IDs
- [x] 2.3 Add unit tests for TypeID helpers

## 3. Git Manager Extension

- [x] 3.1 Add ApplyResult type and error types (ApplyConflictError, DirtyWorkingDirectoryError, NoChangesError)
- [x] 3.2 Implement `applyWorktree` function in git-manager
- [x] 3.3 Add unit tests for applyWorktree scenarios

## 4. CLI Database (apps/cli)

- [x] 4.1 Create `apps/cli` package structure with package.json and tsconfig
- [x] 4.2 Add dependencies: kysely, kysely-bun-sqlite, handlebars
- [x] 4.3 Create db/connection.ts with Kysely + Bun SQLite setup
- [x] 4.4 Create db/schema.ts with tasks table type definitions
- [x] 4.5 Create db/migrations.ts with tasks table migration

## 5. Task Domain (apps/cli)

- [x] 5.1 Create tasks/types.ts importing from packages/common
- [x] 5.2 Create tasks/store.ts with CRUD operations (create, get, update, list)
- [x] 5.3 Add unit tests for task store

## 6. Prompt Templates

- [x] 6.1 Create templates/prompts directory structure
- [x] 6.2 Create naive-implement.md.hbs template with proposal/design/tasks/specs sections
- [x] 6.3 Create prompt/builder.ts with Handlebars rendering logic
- [x] 6.4 Add unit tests for prompt builder

## 7. CLI Commands

- [x] 7.1 Create main.ts CLI entry point with command routing
- [x] 7.2 Implement commands/run.ts (parse path, create task, create worktree, build prompt, spawn agent)
- [x] 7.3 Implement commands/apply.ts (look up task, call git-manager applyWorktree)
- [x] 7.4 Implement commands/status.ts (show task status)
- [x] 7.5 Add CLI binary to package.json (bin: "aop")

## 8. E2E Test Setup

- [x] 8.1 Create e2e-tests directory with package.json
- [x] 8.2 Create e2e-tests/utils.ts with helpers (createTempRepo, copyFixture, cleanup)
- [x] 8.3 Create fixture: e2e-tests/fixtures/cli-greeting-command/proposal.md
- [x] 8.4 Create fixture: e2e-tests/fixtures/cli-greeting-command/design.md
- [x] 8.5 Create fixture: e2e-tests/fixtures/cli-greeting-command/tasks.md

## 9. E2E Tests

**IMPORTANT**: E2E tests MUST use real agents. These are real-world use cases, NEVER mocks.

- [x] 9.1 Create e2e-tests/run.test.ts testing full aop run flow (real agent spawned, real code generated)
- [x] 9.2 Create e2e-tests/apply.test.ts testing aop apply flow (real agent output applied to worktree)
- [x] 9.3 Verify all E2E tests pass with real agent execution
- [x] 9.4 Configure test scripts to separate unit tests from E2E tests (`bun test` runs unit tests only, `bun test:e2e` runs E2E tests)

## 10. E2E Test Comprehensive Verification

**IMPORTANT**: E2E tests must verify task status via CLI commands, not just file existence.

- [x] 10.1 Add `--json` flag to `aop status` command for machine-readable output
- [x] 10.2 Update run.e2e.ts to verify task status is DONE by calling `aop status cli-greeting-command --json`
- [x] 10.3 Update apply.e2e.ts to verify task status before and after apply via `aop status --json`
- [x] 10.4 Verify all enhanced E2E tests pass
