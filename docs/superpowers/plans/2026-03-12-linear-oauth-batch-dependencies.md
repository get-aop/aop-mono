# Linear OAuth Batch Dependencies Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full Linear-powered `/aop:from-ticket` support with OAuth auth, batch ticket import, explicit dependency graphing, and dependency-aware orchestrator execution.

**Architecture:** Linear integration lives in the local server so secrets and tokens never enter slash-command prompts or task docs. `/aop:from-ticket` resolves one or many Linear issues into task folders, writes dependency metadata, and marks tasks ready. The orchestrator enforces execution order from explicit Linear `blocks` relations while preserving existing parallel execution for unrelated tasks.

**Tech Stack:** Bun, TypeScript, Hono, Kysely/SQLite, local encrypted secret store, Linear GraphQL OAuth 2.0 + PKCE

---

## Recommended Product Defaults

- `/aop:from-ticket` is the only ticket-ingestion entrypoint.
- `/aop:from-scratch` remains idea-first and redirects existing-ticket workflows to `/aop:from-ticket`.
- Linear auth uses OAuth 2.0 with PKCE as the primary user flow.
- AOP ships with one shared public Linear OAuth client id.
- OAuth callback uses a fixed localhost loopback redirect.
- OAuth tokens are stored in a cross-platform encrypted local secret store under `~/.aop`.
- `LINEAR_API_KEY` remains available only as a CI/headless fallback.
- Hard task dependencies come only from Linear `blocks` relations.
- Linear `related`, `similar`, `duplicate`, and `parent/children` are imported as context only, not scheduler gates.
- Existing `max_concurrent_tasks` remains the main parallelism control.

## File Map

### Command and skill docs
- Modify: `.claude/commands/aop/from-ticket.md`
- Modify: `.codex/commands/aop/from-ticket.md`
- Modify: `.claude/commands/aop/from-scratch.md`
- Modify: `.codex/commands/aop/from-scratch.md`

### Local server Linear integration
- Create: `apps/local-server/src/integrations/linear/types.ts`
- Create: `apps/local-server/src/integrations/linear/oauth.ts`
- Create: `apps/local-server/src/integrations/linear/token-store.ts`
- Create: `apps/local-server/src/integrations/linear/session-store.ts`
- Create: `apps/local-server/src/integrations/linear/client.ts`
- Create: `apps/local-server/src/integrations/linear/input-parser.ts`
- Create: `apps/local-server/src/integrations/linear/issue-resolver.ts`
- Create: `apps/local-server/src/integrations/linear/dependency-graph.ts`
- Create: `apps/local-server/src/integrations/linear/handlers.ts`
- Create: `apps/local-server/src/integrations/linear/routes.ts`

### Local server integration wiring
- Modify: `apps/local-server/src/app.ts`
- Modify: `apps/local-server/src/context.ts`
- Modify: `packages/infra/src/aop-paths.ts`

### Task docs and metadata
- Modify: `apps/local-server/src/task-docs/types.ts`
- Modify: `apps/local-server/src/task-docs/task.ts`
- Modify: `apps/local-server/src/task-docs/scaffold.ts`
- Modify: `apps/local-server/src/orchestrator/watcher/reconcile.ts`

### Database and scheduling
- Modify: `apps/local-server/src/db/schema.ts`
- Modify: `apps/local-server/src/db/migrations.ts`
- Modify: `apps/local-server/src/task/repository.ts`
- Modify: `apps/local-server/src/orchestrator/queue/processor.ts`
- Modify: `apps/local-server/src/status/handlers.ts`
- Modify: `packages/common/src/types/sse-events.ts`
- Modify: `packages/common/src/protocol/index.ts` if dependency status needs wire exposure

### CLI
- Modify: `apps/cli/src/main.ts`
- Create: `apps/cli/src/commands/linear-connect.ts`
- Create: `apps/cli/src/commands/linear-status.ts`
- Create: `apps/cli/src/commands/linear-unlock.ts`
- Create: `apps/cli/src/commands/linear-disconnect.ts`

### Dashboard
- Modify: `apps/dashboard/src/views/SettingsPage.tsx`
- Modify: `apps/dashboard/src/api/client.ts`

### Tests
- Modify/Create tests under:
  - `apps/local-server/src/integrations/linear/*.test.ts`
  - `apps/local-server/src/settings/*.test.ts` if auth metadata appears in settings UX
  - `apps/local-server/src/task-docs/*.test.ts`
  - `apps/local-server/src/task/repository.test.ts`
  - `apps/local-server/src/orchestrator/queue/processor.test.ts`
  - `apps/cli/src/commands/*.test.ts`
  - `apps/dashboard/src/**/*.test.tsx`
  - `e2e-tests/src/*.e2e.ts`

## External Setup

- Register a shared Linear OAuth app with `read` scope.
- Enable PKCE and refresh tokens.
- Pre-register the fixed localhost callback URI.
- Add optional env overrides for self-host/dev:
  - `AOP_LINEAR_CLIENT_ID`
  - callback base override if needed

---

### Task 1: Add Linear OAuth and encrypted token storage

**Files:**
- Create: `apps/local-server/src/integrations/linear/types.ts`
- Create: `apps/local-server/src/integrations/linear/oauth.ts`
- Create: `apps/local-server/src/integrations/linear/token-store.ts`
- Create: `apps/local-server/src/integrations/linear/session-store.ts`
- Create: `apps/local-server/src/integrations/linear/handlers.ts`
- Create: `apps/local-server/src/integrations/linear/routes.ts`
- Modify: `apps/local-server/src/app.ts`
- Modify: `apps/local-server/src/context.ts`
- Modify: `packages/infra/src/aop-paths.ts`
- Test: `apps/local-server/src/integrations/linear/oauth.test.ts`
- Test: `apps/local-server/src/integrations/linear/token-store.test.ts`
- Test: `apps/local-server/src/integrations/linear/routes.test.ts`

- [ ] **Step 1: Write failing tests for OAuth URL creation, callback validation, token persistence, and secret encryption**
- [ ] **Step 2: Run the new tests to confirm they fail**
- [ ] **Step 3: Implement PKCE helpers, OAuth state handling, token exchange types, and encrypted token storage**
- [ ] **Step 4: Add routes for connect, callback, status, unlock, disconnect, and test-connection**
- [ ] **Step 5: Wire the Linear integration module into local server app/context**
- [ ] **Step 6: Run the new test files and make them pass**
- [ ] **Step 7: Commit**
```bash
git add apps/local-server/src/integrations/linear apps/local-server/src/app.ts apps/local-server/src/context.ts packages/infra/src/aop-paths.ts
git commit -m "feat: add Linear OAuth flow and encrypted token storage"
```

### Task 2: Implement Linear ticket input parsing and issue resolution

**Files:**
- Create: `apps/local-server/src/integrations/linear/input-parser.ts`
- Create: `apps/local-server/src/integrations/linear/client.ts`
- Create: `apps/local-server/src/integrations/linear/issue-resolver.ts`
- Test: `apps/local-server/src/integrations/linear/input-parser.test.ts`
- Test: `apps/local-server/src/integrations/linear/client.test.ts`
- Test: `apps/local-server/src/integrations/linear/issue-resolver.test.ts`

- [ ] **Step 1: Write failing tests for single refs, URLs, ranges, mixed lists, duplicate collapse, and invalid ranges**
- [ ] **Step 2: Run the parser/resolver tests to verify failure**
- [ ] **Step 3: Implement input parsing for `ABC-123`, issue URLs, `ABC-123..ABC-130`, and mixed comma-separated input**
- [ ] **Step 4: Implement Linear GraphQL client calls for issue lookup using OAuth access tokens or env fallback**
- [ ] **Step 5: Normalize issue payloads into a local ticket model including relations and metadata**
- [ ] **Step 6: Run tests and make them pass**
- [ ] **Step 7: Commit**
```bash
git add apps/local-server/src/integrations/linear
git commit -m "feat: resolve Linear tickets from refs urls and ranges"
```

### Task 3: Build dependency graphing from explicit Linear relations

**Files:**
- Create: `apps/local-server/src/integrations/linear/dependency-graph.ts`
- Test: `apps/local-server/src/integrations/linear/dependency-graph.test.ts`

- [ ] **Step 1: Write failing tests for independent issues, blocking chains, branching graphs, and cycles**
- [ ] **Step 2: Run the dependency graph tests to confirm they fail**
- [ ] **Step 3: Implement graph building using only explicit `blocks` relations as hard dependencies**
- [ ] **Step 4: Treat `related`, `similar`, `duplicate`, and `parent/children` as informational metadata only**
- [ ] **Step 5: Add readable cycle detection errors**
- [ ] **Step 6: Run tests and make them pass**
- [ ] **Step 7: Commit**
```bash
git add apps/local-server/src/integrations/linear/dependency-graph.ts apps/local-server/src/integrations/linear/dependency-graph.test.ts
git commit -m "feat: derive task ordering from Linear blocking relations"
```

### Task 4: Extend `/aop:from-ticket` docs for Linear batch workflows

**Files:**
- Modify: `.claude/commands/aop/from-ticket.md`
- Modify: `.codex/commands/aop/from-ticket.md`
- Modify: `.claude/commands/aop/from-scratch.md`
- Modify: `.codex/commands/aop/from-scratch.md`

- [ ] **Step 1: Update `/aop:from-ticket` docs to accept refs, URLs, ranges, and mixed lists**
- [ ] **Step 2: Document the auth prerequisites and fallback behavior**
- [ ] **Step 3: Document parallel task drafting plus dependency-aware execution behavior**
- [ ] **Step 4: Add a redirect note in `/aop:from-scratch` for existing Linear tickets**
- [ ] **Step 5: Review for consistency across `.claude` and `.codex` copies**
- [ ] **Step 6: Commit**
```bash
git add .claude/commands/aop/from-ticket.md .codex/commands/aop/from-ticket.md .claude/commands/aop/from-scratch.md .codex/commands/aop/from-scratch.md
git commit -m "docs: define Linear batch import behavior for from-ticket"
```

### Task 5: Persist Linear source metadata and task dependencies

**Files:**
- Modify: `apps/local-server/src/task-docs/types.ts`
- Modify: `apps/local-server/src/task-docs/task.ts`
- Modify: `apps/local-server/src/task-docs/scaffold.ts`
- Modify: `apps/local-server/src/db/schema.ts`
- Modify: `apps/local-server/src/db/migrations.ts`
- Modify: `apps/local-server/src/orchestrator/watcher/reconcile.ts`
- Test: `apps/local-server/src/task-docs/task.test.ts`
- Test: `apps/local-server/src/orchestrator/watcher/reconcile.test.ts`

- [ ] **Step 1: Write failing tests for parsing source metadata and task dependency frontmatter**
- [ ] **Step 2: Run tests to verify current code ignores these fields**
- [ ] **Step 3: Extend task docs to store Linear source metadata and task-level dependencies**
- [ ] **Step 4: Add DB columns/tables for task source identity and dependency edges**
- [ ] **Step 5: Update reconcile logic to sync metadata and dependency edges from disk into DB**
- [ ] **Step 6: Add duplicate protection for repeated Linear issue imports**
- [ ] **Step 7: Run tests and make them pass**
- [ ] **Step 8: Commit**
```bash
git add apps/local-server/src/task-docs apps/local-server/src/db apps/local-server/src/orchestrator/watcher/reconcile.ts
git commit -m "feat: persist Linear task metadata and dependency edges"
```

### Task 6: Make the scheduler dependency-aware

**Files:**
- Modify: `apps/local-server/src/task/repository.ts`
- Modify: `apps/local-server/src/orchestrator/queue/processor.ts`
- Modify: `apps/local-server/src/status/handlers.ts`
- Modify: `packages/common/src/types/sse-events.ts`
- Modify: `packages/common/src/protocol/index.ts` if needed
- Test: `apps/local-server/src/task/repository.test.ts`
- Test: `apps/local-server/src/orchestrator/queue/processor.test.ts`
- Test: `e2e-tests/src/concurrency.e2e.ts`

- [ ] **Step 1: Write failing tests showing blocked dependents are currently eligible too early**
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Update task eligibility queries so `READY` tasks execute only when all dependency tasks are `DONE`**
- [ ] **Step 4: Preserve existing global parallelism for unrelated tasks**
- [ ] **Step 5: Expose dependency wait reasons in status responses/events**
- [ ] **Step 6: Run unit and e2e concurrency tests**
- [ ] **Step 7: Commit**
```bash
git add apps/local-server/src/task/repository.ts apps/local-server/src/orchestrator/queue/processor.ts apps/local-server/src/status/handlers.ts packages/common/src/types/sse-events.ts packages/common/src/protocol/index.ts e2e-tests/src/concurrency.e2e.ts
git commit -m "feat: hold dependent tasks until upstream work completes"
```

### Task 7: Add CLI commands for Linear auth lifecycle

**Files:**
- Modify: `apps/cli/src/main.ts`
- Create: `apps/cli/src/commands/linear-connect.ts`
- Create: `apps/cli/src/commands/linear-status.ts`
- Create: `apps/cli/src/commands/linear-unlock.ts`
- Create: `apps/cli/src/commands/linear-disconnect.ts`
- Test: `apps/cli/src/commands/linear-connect.test.ts`
- Test: `apps/cli/src/commands/linear-status.test.ts`
- Test: `apps/cli/src/commands/linear-unlock.test.ts`
- Test: `apps/cli/src/commands/linear-disconnect.test.ts`

- [ ] **Step 1: Write failing tests for command registration and server interaction**
- [ ] **Step 2: Run the CLI tests to verify failure**
- [ ] **Step 3: Implement commands for connect, status, unlock, and disconnect**
- [ ] **Step 4: Add safe passphrase prompting and status output without exposing secrets**
- [ ] **Step 5: Run CLI tests and make them pass**
- [ ] **Step 6: Commit**
```bash
git add apps/cli/src/main.ts apps/cli/src/commands/linear-*.ts apps/cli/src/commands/linear-*.test.ts
git commit -m "feat: add CLI controls for Linear OAuth"
```

### Task 8: Add dashboard UX for Linear connection management

**Files:**
- Modify: `apps/dashboard/src/views/SettingsPage.tsx`
- Modify: `apps/dashboard/src/api/client.ts`
- Create tests as needed under `apps/dashboard/src`
- Test: `apps/dashboard/src/views/SettingsPage.test.tsx`
- Test: `apps/dashboard/src/api/client.test.ts`

- [ ] **Step 1: Write failing tests for connected, disconnected, locked, and error states**
- [ ] **Step 2: Run dashboard tests to verify failure**
- [ ] **Step 3: Replace raw credential-style UX with a Linear connection section**
- [ ] **Step 4: Add actions for connect, unlock, test connection, and disconnect**
- [ ] **Step 5: Show workspace/user metadata and dependency-wait task context where relevant**
- [ ] **Step 6: Run dashboard tests and make them pass**
- [ ] **Step 7: Commit**
```bash
git add apps/dashboard/src/views/SettingsPage.tsx apps/dashboard/src/api/client.ts apps/dashboard/src/**/*.test.ts*
git commit -m "feat: add dashboard UX for Linear connection management"
```

### Task 9: Integrate batch import flow with task creation

**Files:**
- Modify relevant local-server integration handlers/routes
- Modify slash-command docs only if wording needs refinement
- Test: integration tests around import/batch creation
- Test: e2e import scenarios

- [ ] **Step 1: Write failing tests for batch import result handling and duplicate protection**
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement batch import flow that resolves all tickets, drafts tasks, writes dependencies, triggers reconcile, and marks tasks ready**
- [ ] **Step 4: Ensure partial failures are reported per ticket**
- [ ] **Step 5: Ensure imported tasks are created idempotently by Linear source id**
- [ ] **Step 6: Run integration tests and make them pass**
- [ ] **Step 7: Commit**
```bash
git add apps/local-server/src/integrations/linear .claude/commands/aop/from-ticket.md .codex/commands/aop/from-ticket.md
git commit -m "feat: import Linear ticket batches into dependency-aware tasks"
```

### Task 10: Final verification and live smoke test

**Files:**
- Review all touched files
- Test: repo-wide relevant suites

- [ ] **Step 1: Run targeted unit and integration tests**
Run: `bun test apps/local-server apps/cli apps/dashboard`
Expected: PASS

- [ ] **Step 2: Run typecheck**
Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Run build**
Run: `bun run build`
Expected: PASS

- [ ] **Step 4: Run e2e**
Run: `bun run test:e2e`
Expected: PASS

- [ ] **Step 5: Perform live smoke test against a real Linear workspace**
- Connect via OAuth
- Import one ref
- Import one range
- Confirm unrelated tasks start in parallel
- Confirm blocked tasks remain waiting until upstream tasks are `DONE`

- [ ] **Step 6: Commit**
```bash
git add .
git commit -m "feat: ship Linear OAuth batch import with dependency-aware execution"
```

## Verification

- [ ] OAuth connect, unlock, disconnect, and test-connection work locally
- [ ] No raw tokens or secrets appear in logs, task docs, or API responses
- [ ] `/aop:from-ticket` accepts refs, URLs, ranges, and mixed inputs
- [ ] Duplicate and invalid inputs fail clearly
- [ ] Task docs persist Linear source identity and dependency metadata
- [ ] Reconcile syncs dependency edges into the database
- [ ] Scheduler runs unrelated tasks in parallel
- [ ] Scheduler holds dependent tasks until upstream tasks are `DONE`
- [ ] CLI and dashboard both expose reliable Linear connection UX
- [ ] `bun test`, `bun run typecheck`, `bun run build`, and `bun run test:e2e` all pass

## Suggested Branch

`feat/linear-oauth-batch-dependencies`

## Notes

- Current repo state already has working parallel execution controlled by `max_concurrent_tasks`; the main execution change is dependency-aware eligibility, not a new concurrency system.
- The highest-risk integration detail is the shared OAuth app redirect strategy; fixed loopback callback registration is the safest path for v1.
- Use only explicit Linear `blocks` relations for hard task ordering in v1 to keep behavior deterministic and trustworthy.
