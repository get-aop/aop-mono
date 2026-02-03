## Context

AOP currently runs workflows locally (Milestone 2). The CLI picks up READY tasks, generates prompts locally, and executes agents. This milestone transitions to server-controlled orchestration where:

- Server owns workflow engine, prompt library, step coordination (closed-source IP)
- CLI becomes a "dumb executor" - receives step commands, runs agents, reports results
- Code never leaves user's machine (privacy-first)

**Current state**: CLI has local workflow runner in `queue/processor.ts` that picks READY tasks and executes them with prompts from `prompt/builder.ts`.

**Constraints**:
- Privacy: file paths, code content, task descriptions never sync to server
- Offline support: CLI must function in degraded mode without server
- Latency acceptable: agents take minutes, HTTP round-trips take milliseconds

## Goals / Non-Goals

**Goals:**
- Server controls all workflow logic (transitions, loops, retries)
- CLI syncs task state (IDs + status only) for metrics and future team sync
- REST API for simple request-response communication
- Graceful degradation when server unreachable
- Single `bun dev` command starts entire dev environment

**Non-Goals:**
- Dashboard (Milestone 4)
- Team sync / multi-user (future)
- A/B testing prompts (future - prompts loaded from files for now)
- Custom workflows per client (all clients use same workflows initially)
- Real-time push notifications (agents take minutes; polling adds no value)

## Decisions

### 1. REST API Instead of WebSockets

**Choice**: Simple HTTP request-response API instead of WebSockets.

**Why:**
- Agents take 2-10 minutes per step; real-time push adds no value
- Request volume is ~10 req/s at 1K users (one request per step completion)
- No polling needed: CLI posts step completion, server returns next step in same response
- Standard HTTP infrastructure (load balancers, caching, monitoring)
- Simpler implementation, testing, and debugging

**Alternatives considered**:
- WebSockets: Adds complexity (connection lifecycle, heartbeats, reconnection, message queuing) for theoretical real-time benefits that don't materialize when agents take minutes
- Server-Sent Events: One-way only; still need REST for CLI→Server

**Rationale**: The unit of work (agent execution) takes minutes. HTTP round-trip latency is invisible.

### 2. API Key Authentication

**Choice**: API key per user stored in CLI config (`~/.aop/config.json`).

**Alternatives considered**:
- OAuth device flow: More secure but complex for MVP
- Anonymous with hardware ID: Simpler but blocks future features (teams, billing)

**Rationale**: Familiar pattern (like Anthropic/OpenAI keys), simple to implement, supports future billing/teams.

### 3. Request-Response Flow

**Choice**: CLI posts step result → Server returns next step in same response. No polling.

**Flow:**
```
CLI                                    Server
 |                                        |
 |-- POST /tasks/{id}/ready ------------->|
 |<-------- 200 { firstStep: {...} } -----|
 |                                        |
 | [Run agent - 2-10 minutes]             |
 |                                        |
 |-- POST /steps/{id}/complete { ... } -->|
 |<-------- 200 { nextStep: {...} } ------|
 |                                        |
 | [Run agent - 2-10 minutes]             |
 |                                        |
 |-- POST /steps/{id}/complete { ... } -->|
 |<-------- 200 { status: "DONE" } -------|
```

**Rationale**: Eliminates need for polling or push notifications. One round-trip per step.

### 4. Typed Request/Response with Zod

**Choice**: TypeScript types with Zod validation at API boundaries.

**Rationale**: Readable JSON for debugging, compile-time type safety, runtime validation at boundaries.

### 5. Hybrid Database Schema

**Choice**: Server stores task/repo IDs + status (not content) for metrics. Denormalized `client_id` on all client-scoped tables.

**Alternatives considered**:
- Minimal (server tracks only executions): Loses metrics capability
- Full mirror: Privacy concern, sync complexity

**Rationale**: Enables "X tasks completed this week" metrics, future team sync (add encrypted_blob later), respects privacy.

### 6. CLI Resolves Templates Locally

**Choice**: Server sends prompts with Handlebars placeholders (`{{ worktree.path }}`), CLI substitutes local values.

**Alternatives considered**:
- CLI sends context, server resolves: Syncs file paths (privacy violation)
- Two-phase prepare/resolve: More round trips

**Rationale**: Paths never leave machine. Small, well-defined variable set.

### 6b. Signal-Based Workflow Transitions

**Choice**: Steps can define `signals` array. CLI scans agent output for these keywords and reports detected signal to server. Server uses signal for multi-way branching.

**Flow:**
```
Workflow step defines:     signals: ["TASK_COMPLETE", "NEEDS_REVIEW", "BLOCKED_EXTERNAL"]
                           transitions:
                             - condition: "TASK_COMPLETE" → __done__
                             - condition: "NEEDS_REVIEW" → review
                             - condition: "__none__" → iterate (loop back)

CLI runs agent → scans output for signals → reports signal to server
Server evaluates: signal match → __none__ match → success/failure fallback
```

**Alternatives considered**:
- Server-side output parsing: Would require syncing agent output (privacy violation)
- Binary success/failure only: Limits workflow expressiveness, can't model ralph loop

**Rationale**: Enables rich branching (done, review, blocked, retry) from single step while keeping workflow definition declarative. Privacy preserved—only signal keyword sent, not output content.

### 7. Prompts as Version-Controlled Files

**Choice**: `apps/server/src/prompts/templates/*.md.hbs` loaded at runtime.

**Alternatives considered**:
- Database storage: Enables A/B testing but complex for MVP

**Rationale**: Simple, auditable in git, add DB storage when needed.

### 8. Server-Side Concurrency Control

**Choice**: Server tracks `max_concurrent_tasks` per client (default 5). CLI can request lower limit. Server only sends step commands when client's WORKING task count is below limit.

**Rationale**: Server owns authoritative limit (enables plan-based billing tiers). CLI can cap lower for resource-constrained machines.

### 9. Optional Sync with Degraded Mode

**Choice**: CLI works without server. Task management works offline, workflows require connection.

**Rationale**: Matches architecture doc: "system works offline for task management".

---

## REST API Endpoints

### Authentication

All requests include `Authorization: Bearer <api_key>` header.

### Endpoints

#### POST /auth
Validate API key and get client info.

**Request:**
```json
{
  "requestedMaxConcurrentTasks": 3  // optional, CLI can request lower
}
```

**Response:**
```json
{
  "clientId": "client_xxx",
  "effectiveMaxConcurrentTasks": 3
}
```

#### POST /repos/{repoId}/sync
Sync repo existence to server (for metrics).

**Request:**
```json
{
  "syncedAt": "2026-02-02T10:00:00Z"
}
```

**Response:**
```json
{ "ok": true }
```

#### POST /tasks/{taskId}/sync
Sync task status to server.

**Request:**
```json
{
  "repoId": "repo_xxx",
  "status": "DRAFT",
  "syncedAt": "2026-02-02T10:00:00Z"
}
```

**Response:**
```json
{ "ok": true }
```

#### POST /tasks/{taskId}/ready
Mark task as READY and get first workflow step.

**Request:**
```json
{
  "repoId": "repo_xxx"
}
```

**Response (workflow started):**
```json
{
  "status": "WORKING",
  "execution": {
    "id": "exec_xxx",
    "workflowId": "workflow_xxx"
  },
  "step": {
    "id": "step_xxx",
    "type": "implement",
    "promptTemplate": "Implement the following task:\n\n{{ task.description }}\n\nWorktree: {{ worktree.path }}",
    "attempt": 1
  }
}
```

**Response (at capacity):**
```json
{
  "status": "READY",
  "queued": true,
  "message": "Task queued, at max concurrent tasks"
}
```

> **Queued task retry**: When CLI receives `queued: true`, it tracks the task locally as queued. When any task completes (CLI receives `taskStatus: "DONE"`, `"BLOCKED"`, or `"REMOVED"` from step completion), CLI automatically retries `POST /tasks/{taskId}/ready` for queued tasks in FIFO order. This avoids polling while ensuring queued tasks start when capacity frees up.
```

#### POST /steps/{stepId}/complete
Report step completion and get next step.

**Request:**
```json
{
  "executionId": "exec_xxx",
  "attempt": 1,
  "status": "success",
  "signal": "TASK_COMPLETE",
  "durationMs": 180000
}
```

> **Signal field**: Optional. CLI scans agent output for keywords defined in step's `signals` array and reports the first match. Server uses signal for transition evaluation before falling back to success/failure.

**Request (failure):**
```json
{
  "executionId": "exec_xxx",
  "attempt": 1,
  "status": "failure",
  "error": {
    "code": "agent_timeout",
    "message": "Agent did not complete within 300000ms"
  },
  "durationMs": 300000
}
```

**Request (aborted):**
```json
{
  "executionId": "exec_xxx",
  "attempt": 1,
  "status": "failure",
  "error": {
    "code": "aborted",
    "reason": "task_removed",
    "message": "Task was removed by user"
  },
  "durationMs": 45000
}
```

**Response (next step):**
```json
{
  "taskStatus": "WORKING",
  "step": {
    "id": "step_yyy",
    "type": "test",
    "promptTemplate": "Run tests for the implementation...",
    "attempt": 1
  }
}
```

**Response (workflow complete):**
```json
{
  "taskStatus": "DONE",
  "step": null
}
```

**Response (workflow blocked):**
```json
{
  "taskStatus": "BLOCKED",
  "step": null,
  "error": {
    "code": "max_retries_exceeded",
    "message": "Step failed after 3 attempts"
  }
}
```

#### GET /tasks/{taskId}/status
Check task status (used after network recovery).

**Response:**
```json
{
  "status": "WORKING",
  "execution": {
    "id": "exec_xxx",
    "currentStepId": "step_xxx",
    "awaitingResult": true
  }
}
```

#### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `agent_timeout` | Agent exceeded timeout |
| `agent_crash` | Agent process crashed |
| `script_failed` | Script exited non-zero |
| `aborted` | Task was aborted (see reason) |
| `max_retries_exceeded` | Step failed after max attempts |
| `prompt_not_found` | Server couldn't load prompt template |

## Abort Reasons

When `error.code` is `aborted`, the `error.reason` field indicates why:

| Reason | Description |
|--------|-------------|
| `task_removed` | User removed the task via `aop task:remove` |
| `change_files_deleted` | Change directory was deleted while task was WORKING |

---

## Server Architecture

```
apps/server/src/
  db/
    connection.ts         # Kysely + Postgres
    migrations/           # Schema migrations
    schema.ts             # Type definitions

  api/
    server.ts             # Hono HTTP server
    routes/
      auth.ts             # POST /auth
      repos.ts            # POST /repos/:id/sync
      tasks.ts            # POST /tasks/:id/sync, /tasks/:id/ready
      steps.ts            # POST /steps/:id/complete
      health.ts           # GET /health
    middleware/
      auth.ts             # API key validation

  workflows/
    engine.ts             # State machine: transitions, loops
    parser.ts             # Parse workflow definitions
    repository.ts         # Workflows table CRUD

  executions/
    repository.ts         # Executions + step_executions tables
    service.ts            # Start workflow, process step results

  prompts/
    templates/
      implement.md.hbs
      test.md.hbs
      review.md.hbs
      debug.md.hbs
    loader.ts             # Load from disk, cache

  repositories/
    client-repository.ts
    repo-repository.ts
    task-repository.ts
    execution-repository.ts
    step-execution-repository.ts
```

---

## CLI Sync Module

```
apps/cli/src/sync/
  server-sync.ts          # HTTP client wrapper
  template-resolver.ts    # Resolve prompt placeholders
```

### ServerSync

```typescript
// apps/cli/src/sync/server-sync.ts
export interface ServerSync {
  // Authentication
  authenticate(): Promise<AuthResult>;

  // Sync operations
  syncRepo(repoId: string): Promise<void>;
  syncTask(taskId: string, status: TaskStatus): Promise<void>;

  // Workflow operations
  markTaskReady(taskId: string, repoId: string): Promise<ReadyResult>;
  completeStep(stepId: string, result: StepResult): Promise<StepCompletionResult>;

  // Recovery
  getTaskStatus(taskId: string): Promise<TaskStatusResult>;
}

export const createServerSync = (config: {
  serverUrl: string;
  apiKey: string;
}): ServerSync => {
  // Implementation using fetch()
};
```

### Degraded Mode

| Feature | Online | Offline (degraded) |
|---------|--------|-------------------|
| Task detection (watcher) | Yes | Yes |
| Task status: DRAFT↔READY | Yes | Yes (queued for sync) |
| Workflow execution | Yes | No (tasks stay READY) |
| `aop status` | Shows connection state | "offline, N pending" |

---

## Configuration

### Environment Variables

```bash
# CLI
AOP_SERVER_URL=https://api.aop.dev   # REST API server
AOP_API_KEY=aop_xxxx                  # Optional, enables sync

# Server
DATABASE_URL=postgres://aop:aop@localhost:5432/aop
PORT=3000
```

---

## Developer Experience

### `bun dev` Command

Single command starts everything:

```bash
bun dev
# 1. Starts docker-compose (Postgres)
# 2. Waits for Postgres healthy
# 3. Runs server migrations
# 4. Starts apps/server with hot reload
# 5. Starts apps/cli daemon with hot reload
# 6. Ctrl+C shuts down all gracefully
```

---

## Migration from Milestone 2

### Code to Delete

- Local workflow runner (queue picks READY, runs locally)
- `apps/cli/src/prompt/` - prompts move to server

### Code to Modify

- `apps/cli/src/daemon/daemon.ts` - add ServerSync
- `apps/cli/src/queue/processor.ts` - process step commands, not READY tasks
- `apps/cli/src/executor/` - receive commands from server, not generate prompts
- `apps/cli/src/tasks/` - respect sync ownership for status transitions

### New Code

- `apps/server/` - entire server application
- `apps/cli/src/sync/` - ServerSync HTTP client
- `packages/common/src/protocol/` - Zod schemas, request/response types

---

## Risks / Trade-offs

**[Workflow paused when offline]** → Accepted trade-off. CLI retries with exponential backoff. Agent continues running regardless. Workflow resumes when network returns.

**[Server is single point of failure for workflows]** → Accepted for MVP. CLI still manages tasks offline. Future: multi-region deployment.

**[Template variable mismatch]** → CLI and server must agree on variable names. Mitigated by Zod schema validation and shared types in `packages/common`.

**[API key leaked]** → Keys can be revoked via future dashboard. Seed different test keys per environment.

---

## Open Questions

1. **Workflow seeding**: How do we populate initial workflows in server DB? Migration script or separate seed command?

2. **API key generation**: For MVP, seed test key. When do we build key generation UI?

3. **Rate limiting**: Should server rate-limit API calls? (Probably yes, defer to implementation)
