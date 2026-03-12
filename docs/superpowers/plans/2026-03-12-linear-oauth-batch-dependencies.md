# Linear OAuth Batch Dependencies Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` (if available) or `superpowers:executing-plans` to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Linear-powered `/aop:from-ticket` support with OAuth auth, batch ticket import, durable Linear-to-task linkage, and dependency-aware task execution.

**Architecture:** Linear integration lives in the local server. OAuth tokens stay in an encrypted local secret store and never enter prompts, task docs, logs, or SQLite. SQLite is the operational source of truth for imported Linear issue links and task dependency edges. Task docs mirror only minimal source metadata so reconcile can rebuild the DB if needed. The scheduler stays conservative: it does not invent a new task lifecycle, it only filters which `READY` tasks are executable.

**Tech Stack:** Bun, TypeScript, Hono, Kysely/SQLite, local encrypted secret store, Linear GraphQL OAuth 2.0 + PKCE

---

## Simplicity Rules

- Keep OAuth tokens out of SQLite. Store only encrypted secrets on disk under `~/.aop`.
- Use SQLite for operational linkage only:
  - Linear issue -> AOP task association
  - task -> task dependency edges
- Do not add a general-purpose Linear issue cache in v1.
- Do not add a new task status for dependency waiting in v1.
- Do not auto-start imported work by default.
- Use only explicit Linear `blocks` relations as hard execution dependencies.
- If an imported issue depends on a missing blocker, auto-import the blocker as a draft task.
- Treat `related`, `similar`, `duplicate`, `parent`, and `children` as context only.

## Recommended Product Defaults

- `/aop:from-ticket` is the only ticket-ingestion entrypoint.
- `/aop:from-scratch` remains idea-first and redirects existing-ticket workflows to `/aop:from-ticket`.
- `/aop:from-ticket` accepts one ref, one URL, one range, or a mixed comma-separated list.
- Batch import creates or updates draft task folders first.
- Missing Linear blockers are auto-imported as draft dependency tasks so execution edges always point to local tasks.
- After import, preserve the current product contract: ask whether to start now.
- If the user chooses to start, mark imported tasks `READY`; the scheduler only executes those whose dependencies are satisfied.
- Linear auth uses OAuth 2.0 with PKCE as the primary user flow.
- AOP ships with one shared public Linear OAuth client id, with env override for self-host/dev.
- OAuth callback uses a fixed localhost loopback redirect in v1.
- `LINEAR_API_KEY` remains available only as a CI/headless fallback.

## Data Model

### Secret storage

- Encrypted token file under `~/.aop`
- In-memory unlock for the current local-server process
- No raw secrets in SQLite, task docs, logs, SSE, or CLI output

### SQLite tables

#### `task_sources`

Purpose: durable mapping between an AOP task and its external source.

Recommended columns:
- `task_id`
- `repo_id`
- `provider` (`linear`)
- `external_id` (stable Linear issue id)
- `external_ref` (display key such as `ABC-123`)
- `external_url`
- `title_snapshot`
- `created_at`
- `updated_at`

Constraints:
- unique on (`repo_id`, `provider`, `external_id`)
- unique on (`task_id`, `provider`)
- prefer indexed text ids in v1; only add foreign keys if `tasks` creation is confirmed to live in the same migration/bootstrap path

#### `task_dependencies`

Purpose: execution ordering between tasks in the same repo.

Recommended columns:
- `task_id`
- `depends_on_task_id`
- `source` (`linear_blocks`)
- `created_at`

Constraints:
- primary key on (`task_id`, `depends_on_task_id`)
- reject self-dependencies
- prefer indexed text ids in v1; only add foreign keys if DB bootstrap ordering is explicit and tested

### Task doc mirror metadata

Task docs should mirror just enough metadata to recover linkage if SQLite is rebuilt:

```yaml
source:
  provider: linear
  id: lin_issue_123
  ref: ABC-123
  url: https://linear.app/acme/issue/ABC-123/example
dependencySources:
  - provider: linear
    id: lin_issue_120
    ref: ABC-120
```

This metadata is for recovery and operator visibility. SQLite remains the runtime source of truth.

## Dependency Semantics

- A task is executable only when:
  - task `status` is `READY`
  - all dependency edges point to tasks with `status = DONE`
- If any dependency is `READY`, `RESUMING`, or `WORKING`, the task is waiting.
- If any dependency is `BLOCKED` or `REMOVED`, the task is not executable and should surface a terminal dependency wait reason.
- The queue must not silently convert dependency waiting into a new persisted task status in v1.
- Status APIs and SSE should expose dependency state separately from task lifecycle:
  - `dependencyState: ready | waiting | blocked`
  - `blockedByTaskIds: string[]`
  - `blockedByRefs?: string[]`

## Missing Blocker Policy

- When an imported Linear issue is blocked by another Linear issue that is not yet local, the importer should auto-import the missing blocker into the same repo.
- Auto-import only blockers required for `blocks` execution ordering.
- Auto-imported blockers should remain draft tasks unless the user later chooses to start them.
- Import results should report which tasks were requested directly and which were pulled in as dependency blockers.
- If a required blocker cannot be fetched, the original import result should return a per-ticket error and must not create a misleading executable edge.

This keeps the scheduler simple and avoids turning dependency resolution into another status machine.

## File Map

### Command docs
- Modify: `README.md`
- Modify: `.claude/commands/aop/from-ticket.md`
- Modify: `.codex/commands/aop/from-ticket.md`
- Modify: `.claude/commands/aop/from-scratch.md`
- Modify: `.codex/commands/aop/from-scratch.md`

### Local server Linear integration
- Create: `apps/local-server/src/integrations/linear/types.ts`
- Create: `apps/local-server/src/integrations/linear/oauth.ts`
- Create: `apps/local-server/src/integrations/linear/token-store.ts`
- Create: `apps/local-server/src/integrations/linear/client.ts`
- Create: `apps/local-server/src/integrations/linear/input-parser.ts`
- Create: `apps/local-server/src/integrations/linear/issue-resolver.ts`
- Create: `apps/local-server/src/integrations/linear/importer.ts`
- Create: `apps/local-server/src/integrations/linear/routes.ts`
- Create: `apps/local-server/src/integrations/linear/handlers.ts`
- Create: `apps/local-server/src/integrations/linear/store.ts`

### Local server integration wiring
- Modify: `apps/local-server/src/app.ts`
- Modify: `apps/local-server/src/context.ts`
- Modify: `packages/infra/src/aop-paths.ts`

### Task docs and reconcile
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
- Modify: `packages/common/src/protocol/index.ts`

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
  - `apps/local-server/src/task-docs/*.test.ts`
  - `apps/local-server/src/orchestrator/watcher/reconcile.test.ts`
  - `apps/local-server/src/task/repository.test.ts`
  - `apps/local-server/src/orchestrator/queue/processor.test.ts`
  - `apps/cli/src/commands/*.test.ts`
  - `apps/dashboard/src/**/*.test.tsx`
  - `e2e-tests/src/*.e2e.ts`

## External Setup

- Register a shared Linear OAuth app with read scope.
- Enable PKCE and refresh tokens.
- Pre-register the localhost callback URI.
- Add optional env overrides:
  - `AOP_LINEAR_CLIENT_ID`
  - `AOP_LINEAR_CALLBACK_BASE`

---

### Task 1: Add Linear OAuth with encrypted local token storage

**Files:**
- Create: `apps/local-server/src/integrations/linear/types.ts`
- Create: `apps/local-server/src/integrations/linear/oauth.ts`
- Create: `apps/local-server/src/integrations/linear/token-store.ts`
- Create: `apps/local-server/src/integrations/linear/handlers.ts`
- Create: `apps/local-server/src/integrations/linear/routes.ts`
- Modify: `apps/local-server/src/app.ts`
- Modify: `apps/local-server/src/context.ts`
- Modify: `packages/infra/src/aop-paths.ts`
- Test: `apps/local-server/src/integrations/linear/oauth.test.ts`
- Test: `apps/local-server/src/integrations/linear/token-store.test.ts`
- Test: `apps/local-server/src/integrations/linear/routes.test.ts`

- [x] **Step 1: Write failing tests for OAuth URL creation, callback validation, token persistence, encryption, lock/unlock, and disconnect**
- [x] **Step 2: Run the new tests to confirm they fail**
- [x] **Step 3: Implement PKCE helpers and short-lived in-memory OAuth state handling**
- [x] **Step 4: Implement encrypted token storage under `~/.aop` with no SQLite secret persistence**
- [x] **Step 5: Add routes for connect, callback, status, unlock, disconnect, and test-connection**
- [x] **Step 6: Wire the Linear integration module into app/context**
- [x] **Step 7: Run the new test files and make them pass**
- [ ] **Step 8: Commit**
```bash
git add apps/local-server/src/integrations/linear apps/local-server/src/app.ts apps/local-server/src/context.ts packages/infra/src/aop-paths.ts
git commit -m "feat: add Linear OAuth flow and encrypted token storage"
```

### Task 2: Implement Linear ticket parsing and issue resolution

**Files:**
- Create: `apps/local-server/src/integrations/linear/input-parser.ts`
- Create: `apps/local-server/src/integrations/linear/client.ts`
- Create: `apps/local-server/src/integrations/linear/issue-resolver.ts`
- Test: `apps/local-server/src/integrations/linear/input-parser.test.ts`
- Test: `apps/local-server/src/integrations/linear/client.test.ts`
- Test: `apps/local-server/src/integrations/linear/issue-resolver.test.ts`

- [x] **Step 1: Write failing tests for single refs, URLs, ranges, mixed lists, duplicate collapse, and invalid ranges**
- [x] **Step 2: Run parser and resolver tests to verify failure**
- [x] **Step 3: Implement input parsing for `ABC-123`, issue URLs, `ABC-123..ABC-130`, and mixed comma-separated input**
- [x] **Step 4: Implement Linear GraphQL reads using OAuth tokens or `LINEAR_API_KEY` fallback**
- [x] **Step 5: Normalize issue payloads into one local model with stable ids, refs, titles, urls, and `blocks` relationships**
- [x] **Step 6: Run tests and make them pass**
- [ ] **Step 7: Commit**
```bash
git add apps/local-server/src/integrations/linear
git commit -m "feat: resolve Linear tickets from refs urls and ranges"
```

### Task 3: Add SQLite-backed Linear source linkage and dependency tables

**Files:**
- Create: `apps/local-server/src/integrations/linear/store.ts`
- Modify: `apps/local-server/src/db/schema.ts`
- Modify: `apps/local-server/src/db/migrations.ts`
- Modify: `apps/local-server/src/context.ts`
- Test: `apps/local-server/src/integrations/linear/store.test.ts`
- Test: `apps/local-server/src/db/migrations.test.ts` if present, otherwise add focused migration coverage

- [x] **Step 1: Write failing tests for upserting task source links, dependency edges, uniqueness, and self-dependency rejection**
- [x] **Step 2: Run the new tests to confirm they fail**
- [x] **Step 3: Confirm how the current DB bootstrap creates `tasks`; use indexed text ids in v1 unless foreign-key-safe ordering is explicit and tested**
- [x] **Step 4: Add `task_sources` and `task_dependencies` tables with repo-scoped uniqueness on Linear external ids**
- [x] **Step 5: Implement a small store layer for upsert, lookup by Linear id/ref, edge replacement, and stale-row cleanup**
- [x] **Step 6: Keep SQLite focused on linkage and dependency state only; do not add a general issue cache**
- [x] **Step 7: Run tests and make them pass**
- [ ] **Step 8: Commit**
```bash
git add apps/local-server/src/integrations/linear/store.ts apps/local-server/src/db/schema.ts apps/local-server/src/db/migrations.ts apps/local-server/src/context.ts
git commit -m "feat: persist Linear task links and dependency edges in sqlite"
```

### Task 4: Batch-import Linear issues into task folders and source records

**Files:**
- Create: `apps/local-server/src/integrations/linear/importer.ts`
- Modify: `apps/local-server/src/task-docs/types.ts`
- Modify: `apps/local-server/src/task-docs/task.ts`
- Modify: `apps/local-server/src/task-docs/scaffold.ts`
- Modify: `apps/local-server/src/orchestrator/watcher/reconcile.ts`
- Modify: relevant local-server Linear handlers/routes
- Test: `apps/local-server/src/integrations/linear/importer.test.ts`
- Test: `apps/local-server/src/task-docs/task.test.ts`
- Test: `apps/local-server/src/orchestrator/watcher/reconcile.test.ts`

- [x] **Step 1: Write failing tests for initial import, repeated import, title changes, slug collisions, missing blockers, and dependency mirror metadata**
- [x] **Step 2: Run tests to confirm current behavior is insufficient**
- [x] **Step 3: Use SQLite `task_sources` uniqueness on Linear stable id as the canonical idempotency rule**
- [x] **Step 4: Auto-import missing blockers needed for `blocks` edges and mark them as dependency-imported draft tasks**
- [x] **Step 5: Create or update the task folder associated with each imported Linear issue**
- [x] **Step 6: Mirror minimal `source` and `dependencySources` metadata into `task.md` for recovery**
- [x] **Step 7: Update reconcile to rebuild `task_sources` and `task_dependencies` from docs when needed**
- [x] **Step 8: Report partial failures per ticket and identify dependency-imported tasks separately from requested tasks**
- [x] **Step 9: Run tests and make them pass**
- [ ] **Step 10: Commit**
```bash
git add apps/local-server/src/integrations/linear apps/local-server/src/task-docs apps/local-server/src/orchestrator/watcher/reconcile.ts
git commit -m "feat: import Linear tickets into task docs with sqlite-backed linkage"
```

### Task 5: Make task eligibility dependency-aware without changing task lifecycle

**Files:**
- Modify: `apps/local-server/src/task/repository.ts`
- Modify: `apps/local-server/src/orchestrator/queue/processor.ts`
- Modify: `apps/local-server/src/status/handlers.ts`
- Modify: `packages/common/src/types/sse-events.ts`
- Modify: `packages/common/src/protocol/index.ts`
- Test: `apps/local-server/src/task/repository.test.ts`
- Test: `apps/local-server/src/orchestrator/queue/processor.test.ts`
- Test: `e2e-tests/src/concurrency.e2e.ts`

- [x] **Step 1: Write failing tests showing dependent `READY` tasks are currently eligible too early**
- [x] **Step 2: Add tests for waiting dependencies and terminal blockers (`BLOCKED`, `REMOVED`)**
- [x] **Step 3: Update repository queries so only `READY` tasks with all dependency tasks `DONE` are executable**
- [x] **Step 4: Keep persisted task status unchanged; expose dependency state separately in status APIs and SSE**
- [x] **Step 5: Preserve existing parallelism for unrelated tasks**
- [x] **Step 6: Run unit and e2e concurrency tests**
- [ ] **Step 7: Commit**
```bash
git add apps/local-server/src/task/repository.ts apps/local-server/src/orchestrator/queue/processor.ts apps/local-server/src/status/handlers.ts packages/common/src/types/sse-events.ts packages/common/src/protocol/index.ts e2e-tests/src/concurrency.e2e.ts
git commit -m "feat: add dependency-aware task eligibility"
```

### Task 6: Add CLI and dashboard support for Linear connection and dependency visibility

**Files:**
- Modify: `apps/cli/src/main.ts`
- Create: `apps/cli/src/commands/linear-connect.ts`
- Create: `apps/cli/src/commands/linear-status.ts`
- Create: `apps/cli/src/commands/linear-unlock.ts`
- Create: `apps/cli/src/commands/linear-disconnect.ts`
- Modify: `apps/dashboard/src/views/SettingsPage.tsx`
- Modify: `apps/dashboard/src/api/client.ts`
- Test: `apps/cli/src/commands/linear-connect.test.ts`
- Test: `apps/cli/src/commands/linear-status.test.ts`
- Test: `apps/cli/src/commands/linear-unlock.test.ts`
- Test: `apps/cli/src/commands/linear-disconnect.test.ts`
- Test: `apps/dashboard/src/views/SettingsPage.test.tsx`
- Test: `apps/dashboard/src/api/client.test.ts`

- [x] **Step 1: Write failing tests for connect, disconnected, locked, unlocked, and disconnect states**
- [x] **Step 2: Add tests for safe passphrase prompting and status output without leaking secrets**
- [x] **Step 3: Add tests for dependency wait visibility in dashboard and client parsing**
- [x] **Step 4: Implement CLI connect/status/unlock/disconnect commands**
- [x] **Step 5: Replace raw credential-style settings UX with a Linear connection section**
- [x] **Step 6: Show dependency wait context where available**
- [x] **Step 7: Run tests and make them pass**
- [ ] **Step 8: Commit**
```bash
git add apps/cli/src/main.ts apps/cli/src/commands/linear-*.ts apps/cli/src/commands/linear-*.test.ts apps/dashboard/src/views/SettingsPage.tsx apps/dashboard/src/api/client.ts apps/dashboard/src/**/*.test.ts*
git commit -m "feat: add Linear auth and dependency visibility to cli and dashboard"
```

### Task 7: Update `/aop:from-ticket` and `/aop:from-scratch` docs

**Files:**
- Modify: `README.md`
- Modify: `.claude/commands/aop/from-ticket.md`
- Modify: `.codex/commands/aop/from-ticket.md`
- Modify: `.claude/commands/aop/from-scratch.md`
- Modify: `.codex/commands/aop/from-scratch.md`

- [x] **Step 1: Document refs, URLs, ranges, and mixed lists**
- [x] **Step 2: Document OAuth prerequisites and `LINEAR_API_KEY` fallback**
- [x] **Step 3: Document auto-imported blocker behavior and how those tasks are reported**
- [x] **Step 4: Preserve the current user-facing contract: create tasks first, then ask whether to start**
- [x] **Step 5: Document that starting imported tasks may still leave some tasks waiting on dependencies**
- [x] **Step 6: Add a redirect note in `/aop:from-scratch` for existing Linear tickets**
- [x] **Step 7: Update `README.md` so product docs match the command docs**
- [x] **Step 8: Review `.claude`, `.codex`, and `README.md` for consistency**
- [ ] **Step 9: Commit**
```bash
git add README.md .claude/commands/aop/from-ticket.md .codex/commands/aop/from-ticket.md .claude/commands/aop/from-scratch.md .codex/commands/aop/from-scratch.md
git commit -m "docs: define Linear import and dependency behavior for from-ticket"
```

### Task 8: Final verification and live smoke test

**Files:**
- Review all touched files
- Test: repo-wide relevant suites

- [x] **Step 1: Run targeted unit and integration tests**
Run: `bun test apps/local-server apps/cli apps/dashboard`
Expected: PASS

- [x] **Step 2: Run typecheck**
Run: `bun run typecheck`
Expected: PASS

- [x] **Step 3: Run build**
Run: `bun run build`
Expected: PASS

- [ ] **Step 4: Run e2e**
Run: `bun run test:e2e`
Expected: PASS
Current status: `automatic-handoff.e2e.ts` still hangs in the existing Codex-driven cleanup/review flow after creating the expected file change, so full-suite e2e remains blocked outside the Linear-specific implementation.

- [ ] **Step 5: Perform a live smoke test against a real Linear workspace**
- Connect via OAuth
- Import one ref
- Import one mixed batch
- Re-import the same ticket and confirm idempotent behavior
- Confirm missing blockers are auto-imported as draft dependency tasks
- Confirm unrelated tasks start in parallel when marked `READY`
- Confirm dependents stay non-executable until upstream tasks are `DONE`
- Confirm a dependency in `BLOCKED` or `REMOVED` surfaces a blocked wait reason

- [ ] **Step 6: Commit**
```bash
git add .
git commit -m "feat: ship Linear OAuth import with sqlite linkage and dependency-aware execution"
```

## Verification

- [ ] OAuth connect, unlock, disconnect, and test-connection work locally
- [ ] No raw tokens or secrets appear in logs, task docs, API responses, CLI output, or SQLite
- [ ] `/aop:from-ticket` accepts refs, URLs, ranges, and mixed inputs
- [ ] Duplicate imports are idempotent by repo + provider + Linear stable issue id
- [ ] Missing blockers are auto-imported as draft dependency tasks
- [ ] Task docs mirror minimal source metadata for recovery
- [ ] Reconcile can rebuild `task_sources` and `task_dependencies` from task docs
- [ ] Scheduler runs unrelated `READY` tasks in parallel
- [ ] Scheduler does not execute dependent tasks until upstream tasks are `DONE`
- [ ] Dependency waiting and terminal dependency blockers are visible in status responses/events
- [ ] CLI and dashboard expose reliable Linear connection UX
- [ ] `bun test`, `bun run typecheck`, `bun run build`, and `bun run test:e2e` all pass

## Suggested Branch

`feat/linear-oauth-batch-dependencies`

## Notes

- SQLite-backed `task_sources` is the right v1 boundary. It gives durable idempotency without making task folder names or titles act as identity.
- Keeping tokens outside SQLite is safer and cleaner for local users. Secrets and operational linkage have different risk profiles and should not share storage.
- Mirroring minimal Linear provenance in `task.md` is worth the small extra complexity because it allows reconcile to recover from a rebuilt local DB.
- Auto-importing missing blockers keeps dependency edges local and executable without introducing placeholder external dependencies.
- Until DB bootstrap ownership is clearer, v1 should favor indexed text ids plus strong store-level tests over optimistic foreign-key assumptions.
- Keeping dependency state derived instead of inventing another persisted task status is the simplest way to stay compatible with the current scheduler and UI.
