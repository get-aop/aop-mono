# AOP Architecture

## Context

AOP (Agents Operating Platform) is a backlog manager and orchestrator for autonomous AI agents implementing software tasks. Developers manage a unified task backlog across multiple repositories, mark tasks as ready for work, and AOP dispatches agents to implement them using configurable workflows.

**Architecture**: Local CLI + Remote Backend (SaaS model)
- Local CLI runs on developer machine: watches all repos, manages task backlog, spawns agents
- Remote backend is the product IP: workflow engine, prompt library, analytics, team sync (future)
- Code and task content never leave the user's machine

**Current state**: Foundation packages exist (git-manager, llm-provider, infra). Building orchestration layer.

**Constraints**:
- Must work with existing git repositories
- Agents are external CLI processes (claude-code, opencode, etc.) - we don't control their internals
- Real-time feedback is essential for UX
- Multiple agents may run in parallel across repos, requiring isolation
- Privacy-first: code never leaves user's machine
- 1 task = 1 OpenSpec change (use `/opsx:ff` for low-friction task creation from GitHub issues)

## Goals / Non-Goals

**Goals:**
- Unified dashboard to manage task backlog across all local repositories
- Configurable workflows for different development styles (TDD, flexible, design-first)
- Safe parallel execution via git worktrees
- User controls what's ready to work vs needs refinement
- Real-time visibility into workflow progress
- Metrics collection for performance insights
- YAML-based workflow definitions

**Non-Goals:**
- Building our own AI agent (we orchestrate existing agents)
- Replacing git or GitHub (we complement their workflows)
- Multi-machine sync in MVP (future: E2EE team sync)
- Forcing a single development methodology

## Core Concepts

```
TASK = 1 OpenSpec Change
├── Has a STATUS (DRAFT, READY, WORKING, BLOCKED, DONE)
├── Belongs to a REPO
└── When WORKING, executes a WORKFLOW

WORKFLOW = Configurable Pipeline of Steps (closed-source, runs on remote)
├── User-defined sequence of steps
├── Each step has a tool/agent and config
├── Supports loops and conditions
└── Defined in YAML

STEP = Single Unit of Work
├── Type: implement, review, test, debug, brainstorm, design, custom
├── Tool: claude-code, opencode, script
└── Config: prompts, transitions, retry policy
```

## Decisions

### 1. Local CLI as Central Hub

**Choice**: The CLI application watches all registered repositories and manages the unified task backlog in SQLite. When running in daemon mode (`aop start`), it becomes a long-running process.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          USER'S MACHINE                                     │
│                                                                             │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   │
│   │   Repo A    │   │   Repo B    │   │   Repo C    │   │   Repo D    │   │
│   │  openspec/  │   │  openspec/  │   │  openspec/  │   │  openspec/  │   │
│   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘   │
│          │                 │                 │                 │           │
│          └─────────────────┴────────┬────────┴─────────────────┘           │
│                                     │                                       │
│                                     ▼                                       │
│                        ┌─────────────────────────┐                         │
│                        │      AOP CLI            │                         │
│                        │  (daemon mode)          │                         │
│                        └────────────┬────────────┘                         │
│                                     │                                       │
│                                     ▼                                       │
│                        ┌─────────────────────────┐                         │
│                        │        SQLite           │                         │
│                        │  (unified task backlog) │                         │
│                        └─────────────────────────┘                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Rationale**: Single source of truth for all tasks. User sees unified backlog regardless of which repo a task belongs to.

### 2. Task Status Model

**Choice**: Simple 5-state model focused on user control.

```
┌─────────┐       ┌─────────┐       ┌─────────┐       ┌─────────┐
│  DRAFT  │──────▶│  READY  │──────▶│ WORKING │──────▶│  DONE   │
└─────────┘       └─────────┘       └────┬────┘       └─────────┘
     ▲                 ▲                 │
     │                 │                 │ workflow fails
     │                 │                 ▼
     │                 │           ┌─────────┐
     │                 └───────────│ BLOCKED │
     │                   retry     └─────────┘
     │                                   │
     └───────────────────────────────────┘
                  needs refinement
```

| Status | Description | User Action |
|--------|-------------|-------------|
| DRAFT | Change detected, needs refinement | Brainstorm, then mark Ready |
| READY | Approved for work, queued | Wait or adjust priority |
| WORKING | Workflow executing | Monitor progress |
| BLOCKED | Workflow failed | Retry, refine, or abandon |
| DONE | Successfully completed | Review and merge |

**Rationale**: User decides when a task is ready. No automatic dispatch of unclear tasks.

### 3. Configurable Workflows (YAML) - Remote/Closed-Source

**Choice**: Workflows are YAML files defining a pipeline of steps. The workflow engine runs on the remote backend (closed-source IP). Users can create custom workflows for different development styles.

**Workflow Schema:**

```yaml
# workflow.yaml
id: tdd-strict
name: Strict TDD
description: Test-first development with mandatory code review

settings:
  maxAttempts: 3        # Per-step retry limit
  concurrency: 1        # Tasks using this workflow concurrently

steps:
  - id: write-tests
    name: Write Tests
    type: implement
    tool:
      provider: claude-code
      prompt: |
        Write failing tests for: {{task.description}}
        Do NOT implement the feature yet, only write tests.
      resumable: true
    onSuccess: next
    onFailure: fail

  - id: verify-tests-fail
    name: Verify Tests Fail
    type: test
    tool:
      provider: script
      script: bun test
      timeout: 60000
    onSuccess: fail      # Tests should fail at this point
    onFailure: next

  - id: implement
    name: Implement
    type: implement
    tool:
      provider: claude-code
      prompt: |
        Implement code to make the tests pass.
        Task: {{task.description}}
      resumable: true
    onSuccess: next
    onFailure:
      goto: debug

  - id: verify-tests-pass
    name: Verify Tests Pass
    type: test
    tool:
      provider: script
      script: bun test
    onSuccess: next
    onFailure:
      loop:
        stepId: debug
        maxIterations: 3

  - id: debug
    name: Debug Failures
    type: debug
    tool:
      provider: claude-code
      prompt: |
        Tests are failing. Debug and fix.
        Error: {{lastError}}
      resumable: true
    onSuccess:
      goto: verify-tests-pass
    onFailure: fail

  - id: review
    name: Code Review
    type: review
    tool:
      provider: claude-code
      prompt: |
        Review the implementation for: {{task.description}}
        Check for bugs, style, and best practices.
    onSuccess: done
    onFailure:
      goto: implement
```

**Step Types:**

| Type | Purpose |
|------|---------|
| implement | Write/modify code |
| test | Run test suite |
| review | Code review |
| debug | Fix issues |
| brainstorm | Explore ideas |
| design | Create design docs |
| custom | User-defined |

**Transitions:**

| Transition | Meaning |
|------------|---------|
| `next` | Proceed to next step |
| `done` | Workflow complete (task → DONE) |
| `fail` | Workflow failed (task → BLOCKED) |
| `goto: stepId` | Jump to specific step |
| `loop: {stepId, maxIterations}` | Loop back with limit |

**Rationale**: YAML is human-readable and easy to edit. Workflow engine is closed-source IP on remote backend.

### 4. Example Workflows

**Simple (no review):**
```yaml
id: simple
name: Simple Implementation
steps:
  - id: implement
    name: Implement
    type: implement
    tool:
      provider: claude-code
      prompt: "Implement: {{task.description}}"
    onSuccess: done
    onFailure: fail
```

**Design-First:**
```yaml
id: design-first
name: Design First
steps:
  - id: design
    name: Create Design
    type: design
    tool:
      provider: claude-code
      prompt: "Create a design document for: {{task.description}}"
    onSuccess: next
    onFailure: fail

  - id: implement
    name: Implement
    type: implement
    tool:
      provider: claude-code
      prompt: "Implement based on the design: {{task.description}}"
    onSuccess: next
    onFailure: fail

  - id: review
    name: Review
    type: review
    tool:
      provider: claude-code
      prompt: "Review implementation against design"
    onSuccess: done
    onFailure:
      goto: implement
```

### 5. SQLite for Local State (Kysely)

**Choice**: SQLite database with Kysely query builder stores unified task backlog and execution state. 

**Query Builder**: Kysely with `kysely-bun-sqlite` dialect for Bun's native SQLite.

```typescript
import { Kysely } from 'kysely';
import { BunSqliteDialect } from 'kysely-bun-sqlite';
import { Database } from 'bun:sqlite';

export const createDb = (path: string) => {
  return new Kysely<DbSchema>({
    dialect: new BunSqliteDialect({
      database: new Database(path),
    }),
  });
};
```

**Schema:**

```sql
-- Repos being watched
CREATE TABLE repos (
  id TEXT PRIMARY KEY,            -- TypeID: repo_xxxx
  path TEXT NOT NULL UNIQUE,
  name TEXT,
  remote_origin TEXT,             -- git remote origin URL (for linking clones)
  default_workflow_id TEXT,
  max_concurrent_tasks INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Index for finding linked repos by remote origin
CREATE INDEX idx_repos_remote_origin ON repos(remote_origin);

-- Tasks (1 task = 1 openspec change)
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,            -- TypeID: task_xxxx
  repo_id TEXT NOT NULL,
  change_path TEXT NOT NULL,      -- openspec/changes/feature-x/

  status TEXT NOT NULL,           -- DRAFT, READY, WORKING, BLOCKED, DONE
  workflow_id TEXT,

  remote_id TEXT,                 -- Server-assigned ID for sync
  synced_at TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (repo_id) REFERENCES repos(id)
);

-- Workflow execution state (tracks current step, managed by remote)
CREATE TABLE executions (
  id TEXT PRIMARY KEY,            -- TypeID: exec_xxxx
  task_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,

  current_step_id TEXT,
  step_index INTEGER,
  iteration INTEGER DEFAULT 0,

  status TEXT NOT NULL,           -- running, paused, completed, failed

  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,

  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Step execution history
CREATE TABLE step_executions (
  id TEXT PRIMARY KEY,            -- TypeID: step_xxxx
  execution_id TEXT NOT NULL,
  step_id TEXT NOT NULL,

  attempt INTEGER NOT NULL,
  status TEXT NOT NULL,           -- running, success, failure

  agent_pid INTEGER,
  session_id TEXT,                -- For LLM session resume

  exit_code INTEGER,
  error TEXT,
  output_summary TEXT,

  started_at TEXT NOT NULL,
  ended_at TEXT,

  FOREIGN KEY (execution_id) REFERENCES executions(id)
);
```

**Rationale**: SQLite is embedded, fast, and perfect for local-first applications. Kysely provides type-safe queries and works with both SQLite (local) and PostgreSQL (remote).

### 6. TypeID for Identifiers

**Choice**: TypeID (type-prefixed, K-sortable identifiers) using `typeid-js` unboxed API.

```
task_01h455vb4pex5vsknk084sn02q
└─┬─┘└────────────┬────────────┘
  │               └── UUIDv7 base32 (sortable by time)
  └── Type prefix
```

**Usage:**
```typescript
import { typeidUnboxed } from 'typeid-js';

const taskId = typeidUnboxed('task');  // "task_01h455vb4pex5vsknk084sn02q"
const repoId = typeidUnboxed('repo');  // "repo_01h455vb4pex5vsknk084sn02q"
const execId = typeidUnboxed('exec');  // "exec_01h455vb4pex5vsknk084sn02q"
```

**Rationale**:
- Type-safe: can't accidentally pass a task ID where a repo ID is expected
- Sortable by creation time (UUIDv7-based)
- Self-documenting: IDs show their type
- Unboxed: plain strings at runtime, no serialization overhead

### 7. Concurrency Control

**Choice**: User-configurable at repo and workflow level.

```yaml
# Per-repo setting (in CLI config)
repos:
  - path: /Users/dev/project-a
    max_concurrent_tasks: 2      # 2 tasks can run simultaneously

# Per-workflow setting (in workflow.yaml)
settings:
  concurrency: 1                 # Only 1 task using this workflow at a time
```

**Rationale**: Some repos/workflows need serialization (e.g., shared resources), others can parallelize.

### 8. Remote Server Role

**Choice**: Remote server provides workflow engine (closed-source), prompt library, and analytics. Does not see code.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          REMOTE SERVER                                      │
│                                                                             │
│  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐        │
│  │ Workflow Engine  │   │  Prompt Library  │   │    PostgreSQL    │        │
│  │  (closed-source) │   │  (per step type) │   │   (analytics)    │        │
│  └──────────────────┘   └──────────────────┘   └──────────────────┘        │
│                                                                             │
│  What syncs TO remote:          What syncs FROM remote:                    │
│  • Task IDs, status, timestamps • Workflow definitions                     │
│  • Metrics (timing, pass rates) • Prompt templates                         │
│  • Error types (not content)    • Step commands                            │
│                                                                             │
│  What NEVER syncs:                                                          │
│  • Code, diffs, file paths                                                 │
│  • Task descriptions/content                                               │
│  • Review comments                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Rationale**: Privacy-first. Workflow engine is closed-source IP. Code never leaves user's machine.

### 9. Dashboard Interactions

**Choice**: Dashboard communicates with CLI daemon via local API. Status changes sync to remote.

```
User clicks "Mark Ready" in Dashboard
         │
         ▼
┌─────────────────┐
│ Dashboard (UI)  │
└────────┬────────┘
         │ POST /tasks/{id}/ready
         ▼
┌─────────────────┐
│ CLI (API)       │
└────────┬────────┘
         │ 1. Update SQLite
         │ 2. Sync to remote
         ▼
┌─────────────────┐
│ Remote Server   │
└────────┬────────┘
         │ ACK
         ▼
Dashboard shows updated status
```

**Rationale**: Local-first. Remote sync is secondary, system works offline.

### 10. Sync Ownership Model

**Choice**: All task states sync to remote, but state transitions have clear ownership to resolve conflicts.

**State Ownership:**

| Transition | Owner | Rationale |
|------------|-------|-----------|
| Task created (→ DRAFT) | Local | User creates tasks on their machine |
| DRAFT → READY | Local | User intent - "this is ready for work" |
| READY → WORKING | Remote | Remote picks up task, starts workflow |
| Execution state (step, iteration) | Remote | Workflow engine owns execution |
| WORKING → DONE/BLOCKED | Remote | Workflow engine determines outcome |
| BLOCKED → DRAFT | Local | User intent - "needs refinement" |

**Sync Protocol:**

```
LOCAL → REMOTE:
  "task_xxx exists, status=DRAFT"
  "task_xxx now READY" (user marked ready)
  "task_xxx now DRAFT" (user moved BLOCKED→DRAFT for refinement)

REMOTE → LOCAL:
  "task_xxx now WORKING, step 2/5"
  "task_xxx now DONE"
  "task_xxx now BLOCKED, error: tests failed"
```

**Conflict Resolution:**
- Execution-related state: Remote wins (it's running the workflow)
- User-intent state: Local wins (user decisions take precedence)
- Timestamp comparison only within same owner category

**Failure Handling:**
- Local queues failed syncs, retries with exponential backoff
- If offline for extended period, warn user: "N tasks pending sync"
- On reconnect, reconcile using ownership rules above

**Rationale**: Clear ownership boundaries prevent split-brain scenarios. All states sync for visibility (analytics, dashboard), but transitions are authoritative based on who owns that state change.

### 11. REST API Communication

**Choice**: Simple request-response HTTP API instead of WebSockets.

**Why REST over WebSockets:**
- Agents take 2-10 minutes per step; real-time push adds no value
- Request volume is ~10 req/s at 1K users (one request per step completion)
- Standard HTTP infrastructure (load balancers, caching, monitoring)
- Simpler implementation, testing, and debugging

**Flow:**
```
CLI completes step → POST /steps/{id}/complete
                  ← 200 { nextStep: {...} }  (or { status: "DONE" })

CLI runs agent (2-10 minutes)

CLI completes step → POST /steps/{id}/complete
                  ← 200 { nextStep: {...} }
```

**Error Handling:**
- HTTP retry with exponential backoff on network failures
- Idempotent step completion (server deduplicates by execution_id + step_id + attempt)
- Running agent continues regardless of network state

**Rationale**: WebSockets add complexity for theoretical real-time benefits that don't materialize when agents take minutes per step. REST is simpler to implement, test, and operate.

### 12. File Watcher Scope

**Choice**: Watch only `openspec/changes/` directories, not entire repositories.

```
Watched:    /repo/openspec/changes/**/*
Not watched: /repo/src/**, /repo/node_modules/**, etc.
```

**Events:**
- New change directory created → create DRAFT task
- Change directory deleted → remove task (if not WORKING)
- Artifact files modified → update task metadata

**Rationale**: Minimal resource usage. Only openspec artifacts matter for task detection.

### 13. Brainstorming Integration (Future)

**Idea**: Dashboard can launch brainstorming sessions for DRAFT tasks.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Task: "Add user authentication"                           Status: DRAFT   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [Brainstorm]  [Mark Ready]  [Archive]                                     │
│                                                                             │
│  Clicking "Brainstorm" could:                                              │
│  • Open chat interface with task context                                   │
│  • Launch agent session for exploration                                    │
│  • Generate proposal/design artifacts                                      │
│                                                                             │
│  UX TBD - capturing the concept for future implementation                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          REMOTE SERVER                                      │
│                                                                             │
│  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐        │
│  │ Workflow Engine  │   │  Prompt Library  │   │    PostgreSQL    │        │
│  │ (closed-source)  │   │  (per step type) │   │    (Kysely)      │        │
│  └────────┬─────────┘   └────────┬─────────┘   └────────┬─────────┘        │
│           │                      │                      │                   │
│           └──────────────────────┴──────────────────────┘                   │
│                                  │                                          │
│                            REST API                                         │
│                                  │                                          │
└──────────────────────────────────┼──────────────────────────────────────────┘
                                   │
                                   │  • POST step results, GET next step
                                   │  • Sync task status
                                   │  • Report metrics
                                   │
┌──────────────────────────────────┼──────────────────────────────────────────┐
│                          LOCAL CLI                                          │
│                                   │                                          │
│  ┌────────────────────────────────┴───────────────────────────────────┐     │
│  │                    SQLite (Kysely + Bun)                           │     │
│  │  ┌─────────┐  ┌─────────┐  ┌───────────┐  ┌────────────────────┐  │     │
│  │  │  repos  │  │  tasks  │  │executions │  │  step_executions   │  │     │
│  │  └─────────┘  └─────────┘  └───────────┘  └────────────────────┘  │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│                                                                             │
│  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐        │
│  │   File Watcher   │   │   Step Runner    │   │   LLM Provider   │        │
│  │  (all repos)     │──▶│ (execute steps)  │──▶│  (run agents)    │        │
│  └──────────────────┘   └──────────────────┘   └──────────────────┘        │
│                                  │                      │                   │
│                                  ▼                      ▼                   │
│                         ┌──────────────────┐   ┌──────────────────┐        │
│                         │   Git Manager    │   │  Script Runner   │        │
│                         │  (worktrees)     │   │  (bun test etc)  │        │
│                         └──────────────────┘   └──────────────────┘        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Code Organization

**Principle**: Organize by domain (vertical slices), not by layer. Extract to packages only when there are 2+ consumers.

**Data Access Pattern**: thin entrypoints → domain handlers → repositories
- Commands are thin wrappers (parse args, call handler, format output)
- Handlers contain domain logic, receive `CommandContext`, never call `getDatabase()`
- Repositories provide data access, each domain has its own
- Only `main.ts` creates the database connection and injects context

```
apps/
  cli/                        # CLI + local daemon
    src/
      db/                     # SQLite infrastructure
        connection.ts         # Kysely + Bun SQLite setup
        migrations.ts         # Schema migrations
        test-utils.ts         # createTestDb(), createTestContext()
      context.ts              # CommandContext type + factory
      repos/                  # Domain: repository management
        types.ts
        repository.ts         # Data access layer
        handlers.ts           # initRepo(), removeRepo()
      tasks/                  # Domain: task backlog
        types.ts
        repository.ts         # Data access layer
        handlers.ts           # runTask(), applyTask(), markTaskReady(), removeTask()
        detector.ts           # Detect tasks from openspec files
        resolve.ts            # Task resolution helpers
      settings/               # Domain: settings
        types.ts
        repository.ts         # Data access layer
        handlers.ts           # getSetting(), setSetting()
      status/                 # Domain: status display
        handlers.ts           # getStatus()
      watcher/                # Domain: file system watching
        index.ts
        events.ts
      executions/             # Domain: execution tracking
        types.ts
        repository.ts         # Data access layer
      commands/               # CLI commands (thin wrappers)
        run.ts                # aop run → calls runTask()
        apply.ts              # aop apply → calls applyTask()
        status.ts             # aop status → calls getStatus()
        repo-init.ts          # aop init → calls initRepo()
        repo-remove.ts        # aop repo remove → calls removeRepo()
        config-get.ts         # aop config get → calls getSetting()
        config-set.ts         # aop config set → calls setSetting()
        task-ready.ts         # aop task ready → calls markTaskReady()
        task-remove.ts        # aop task remove → calls removeTask()
      api/                    # Local HTTP API for dashboard
        server.ts
        routes.ts
      sync/                   # Remote sync
        ws-client.ts
        sync.ts
      main.ts                 # Entry point, creates context, dispatches commands

  server/                     # Remote backend (closed source)
    src/
      db/                     # PostgreSQL infrastructure (Kysely)
        connection.ts
        migrations.ts
      workflows/              # Domain: workflow engine (the IP)
        types.ts              # Workflow YAML schema types (server-only)
        engine.ts
        parser.ts
        validator.ts
      prompts/                # Domain: prompt library
        templates.ts
      analytics/              # Domain: metrics
        metrics.ts
      api/                    # REST API
        server.ts
        routes.ts
      main.ts

  dashboard/                  # React UI

packages/
  common/                     # Lean: only types shared between CLI and Server
    src/
      types/
        task.ts               # Task, Status types
        protocol.ts           # REST API types
      index.ts
  git-manager/                # Git worktree lifecycle
  llm-provider/               # Agent spawning (ClaudeCode, etc.)
  infra/                      # Shared infrastructure
    src/
      logger.ts               # Logging
      typeid.ts               # TypeID generation helpers
```

## Build Milestones

Structured for early validation. Each milestone delivers usable functionality.

### Milestone 1: One Task, One Agent, Manual

**Goal**: Validate core loop (agent + worktree + task completion) end-to-end.

**Scope**:
- `packages/common`: Task, Status types
- `packages/infra`: Add TypeID helpers (move from common)
- `apps/cli/src/db`: Kysely + SQLite connection and migrations
- `apps/cli/src/tasks`: Task domain (types + store, manual add)
- `apps/cli/src/commands`: Basic commands (`aop run <change-path>`)
- Integration: git-manager + llm-provider (already exist)

**What works**:
```bash
aop run ./my-repo/openspec/changes/add-auth
# → Creates worktree (.worktrees/add-auth/)
# → Spawns agent with task context
# → Agent implements
# → Reports success/failure
# → Worktree persists for user review

aop apply <task-id>           # User reviews, then applies
# → Applies changes from worktree to main repo working directory
# → User can review diff, commit manually
# → Worktree persists (cleanup via dashboard later)
```

**Not yet**: No watcher, no repos table, no server, no dashboard. Single repo, single task, manual trigger.

**Validation**: Can an agent complete a real task in an isolated worktree?

---

### Milestone 2: Backlog Management

**Goal**: Multi-repo task tracking with local workflow execution.

**Scope**:
- `apps/cli/src/repos`: Repo domain (register, list, remove)
- `apps/cli/src/watcher`: File watcher for `openspec/changes/`
- `apps/cli/src/tasks`: Task detector (auto-create from changes)
- `apps/cli/src/executions`: Execution tracking
- `apps/cli/src/commands`: Full CLI (`init`, `start`, `stop`, `status`, `list`, `run`)
- Local workflow runner (temporary, will be replaced by server)

**What works**:
```bash
aop init                      # Register current repo
aop start                     # Start daemon, watch for changes
aop list                      # See unified backlog across repos
aop run task_xxx              # Execute task with local workflow
```

**Not yet**: No server, no remote sync, no dashboard. Workflows defined locally.

**Validation**: Can we manage a backlog across multiple repos? Is the UX right?

**Note**: Local workflow runner is throwaway code. Keep it minimal.

---

### Milestone 3: Remote Orchestration

**Goal**: Server-controlled workflows (the product).

**Scope**:
- `apps/server/src/db`: PostgreSQL + Kysely
- `apps/server/src/workflows`: Engine, parser, validator
- `apps/server/src/prompts`: Prompt library
- `apps/server/src/api`: REST API server
- `apps/cli/src/sync`: HTTP client, state sync
- `packages/common`: Protocol message types

**What works**:
```bash
aop start                     # Daemon connects to server
# User marks task READY
# → CLI syncs to server
# → Server sends step commands
# → CLI executes agents
# → Workflow completes
```

**Delete**: Local workflow runner from Milestone 2.

**Validation**: Does the remote orchestration model work? Latency acceptable?

---

### Milestone 4: Dashboard

**Goal**: Visual task management.

**Scope**:
- `apps/dashboard`: React UI
- `apps/cli/src/api`: HTTP API for dashboard
- Task list view (all repos, filterable)
- Task detail + workflow progress
- Actions: Mark ready, retry, abandon

**What works**: User can manage backlog visually instead of CLI-only.

---

### Milestone 5: Polish

**Goal**: Production readiness.

**Scope**:
- Brainstorming integration (DRAFT → exploration)
- Code review UI
- Merge flow (squash to PR branch, push)
- Error handling, edge cases
- Documentation

## Risks / Trade-offs

**[CLI complexity]** → Keep domains isolated. Each domain folder is self-contained.

**[Workflow YAML errors]** → Strong validation on remote. Clear error messages with line numbers.

**[SQLite corruption]** → Use WAL mode, regular backups, graceful shutdown handling.

**[Remote unavailable]** → CLI works offline for task management. Workflow execution requires remote.

**[Agent failures]** → Configurable retry limits. BLOCKED status requires human decision.

**[Worktree accumulation]** → Worktrees persist indefinitely (even after `aop apply`). No automatic cleanup to prevent data loss. Dashboard (Milestone 4) will provide explicit cleanup UI for stale worktrees.

**[Agent escaping worktree]** → Agents can run arbitrary git commands and may escape isolation. Mitigation: require trunk branch protection (GitHub/GitLab). Active enforcement deferred to `agent-sandbox-guardrails` change.

**[Remote workflow engine latency]** → Step transitions require remote round-trip. Accepted tradeoff for monetization protection. Agents run locally (minutes), so step transition latency (milliseconds) is acceptable.

**[Workflow paused when offline]** → If network is down mid-workflow, CLI retries step completion POST with exponential backoff. Running agent continues regardless. Workflow resumes when network returns. Simple HTTP retry is more robust than WebSocket reconnection logic.
