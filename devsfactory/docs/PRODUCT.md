# AOP v1.0 - Cloud Orchestrator + Chat Experience

## Project Specification

**Date**: 2026-01-28
**Milestone**: v1.0
**Epics**: Cloud Orchestrator, Chat Experience
**GitHub Issues**: #58-#76

---

## Table of Contents

1. [Vision](#1-vision)
2. [Architecture Overview](#2-architecture-overview)
3. [Current System Analysis](#3-current-system-analysis)
4. [Target Architecture](#4-target-architecture)
5. [Epic 1: Cloud Orchestrator](#5-epic-1-cloud-orchestrator)
6. [Epic 2: Chat Experience](#6-epic-2-chat-experience)
7. [Foundation Work](#7-foundation-work)
8. [WebSocket Protocol Specification](#8-websocket-protocol-specification)
9. [Database Schema](#9-database-schema)
10. [Dependency Graph](#10-dependency-graph)
11. [Monorepo Structure](#11-monorepo-structure)
12. [Technology Decisions](#12-technology-decisions)
13. [Cost Analysis](#13-cost-analysis)
14. [Security Considerations](#14-security-considerations)
15. [Issue Tracker](#15-issue-tracker)

---

## 1. Vision

AOP (Agents Operating Platform) is an AI-powered orchestration system that coordinates multiple Claude CLI agents to decompose, implement, review, and merge software tasks autonomously. Today it runs entirely on the user's local machine. v1.0 evolves it into a client-server architecture that:

1. **Protects intellectual property** by moving orchestration logic and prompt templates to a cloud server
2. **Provides a browser-based chat experience** for interactive task planning with Claude
3. **Enables continuous improvement** by serving prompt templates from the cloud (update without CLI releases)
4. **Costs zero in AI** -- all LLM calls use the user's Claude subscription locally

### What Is Your Actual IP

```
+---------------------------------------------------------------------+------------------------------+
|                    Actually Valuable (your moat)                     |      Not That Valuable       |
+---------------------------------------------------------------------+------------------------------+
| How you decompose tasks into subtasks                                | Individual execution prompts |
| Orchestration state machine -- priority ordering, when to spawn what | Git worktree mechanics       |
| Multi-attempt review loop with escalation                            | File parsing                 |
| Recovery logic -- what to do when agents crash                       | Dashboard UI                 |
| Quality evaluation heuristics                                        | Template syntax              |
| The system working as a coordinated whole                            | Any single component         |
+---------------------------------------------------------------------+------------------------------+
```

### Key Insight: Your Orchestrator Uses Zero AI

Every function in the orchestration path is pure deterministic logic:

```
reconcile()                          <-- no AI, just function calls
  -> refreshState()                  <-- reads markdown files
  -> transitionReadyTasks()          <-- if status == PENDING -> INPROGRESS
  -> transitionReadySubtasks()       <-- if deps satisfied -> INPROGRESS
  -> producer.produceFromState()     <-- switch(status) -> enqueue job

AI calls happen ONLY in AgentRunner.spawn() -- and that stays local.
```

This means the cloud server runs pure code. No GPUs. No API bills. ~$50/month VPS.

---

## 2. Architecture Overview

```
+-------------------------------------------------------------+
|  LOCAL (user's machine, user's Claude subscription)          |
|                                                              |
|  +------------+  +--------------+  +-------------------+     |
|  | CLI (aop)  |  | AgentRunner  |  | Git / Worktrees   |     |
|  | login,     |  | (claude CLI) |  | (unchanged)       |     |
|  | start      |  | impl, review |  |                   |     |
|  +-----+------+  +------^-------+  +---------^---------+     |
|        |                |                    |               |
|  +-----v----------------+--------------------+-----------+   |
|  | WorkerClient (WebSocket)                              |   |
|  | - Receives: { jobId, prompt, cwd }                    |   |
|  | - Reports:  { jobId, exitCode, timing }               |   |
|  | - Sends:    state changes, file events                |   |
|  +---------------------------+---------------------------+   |
|                              |                               |
|  +---------------------------+---------------------------+   |
|  | ChatSession Manager                                   |   |
|  | - Bidirectional Claude CLI streaming                  |   |
|  | - NDJSON stdin/stdout protocol                        |   |
|  +-------------------------------------------------------+   |
|                              |                               |
|  +---------------------------+---------------------------+   |
|  | Dashboard (React + WebSocket)                         |   |
|  | - Task creation form                                  |   |
|  | - Chat UI for planning                                |   |
|  | - Plan review and approval                            |   |
|  | - Agent monitoring                                    |   |
|  +-------------------------------------------------------+   |
+------------------------------+-------------------------------+
                               | WSS (encrypted)
+------------------------------v-------------------------------+
|  CLOUD (your server -- NO AI, NO LLM, just code)             |
|                                                              |
|  +------------------+  +------------------+                  |
|  | Orchestrator     |  | Prompt Templates |                  |
|  | (state machine)  |  | (static .md      |                  |
|  | Pure code.       |  |  files, served   |                  |
|  | Zero AI calls.   |  |  on demand)      |                  |
|  +------------------+  +------------------+                  |
|  +------------------+  +------------------+                  |
|  | State Store      |  | Auth (Clerk)     |                  |
|  | (PostgreSQL)     |  | + Billing        |                  |
|  +------------------+  +------------------+                  |
|  +------------------+                                        |
|  | Analytics        |  <-- cost: ~$50/mo server              |
|  | (usage, metrics) |      NOT $1000s/mo in API calls        |
|  +------------------+                                        |
+--------------------------------------------------------------+
```

### What's Protected

- Orchestration logic (state machine, priority, recovery) -- fully in cloud
- Prompt templates -- never stored locally, fetched per-execution then discarded
- Task decomposition strategy -- cloud-side only
- Quality evaluation -- cloud-side only

### What's NOT Protected

- Assembled prompts during execution -- visible to user for the duration of the Claude CLI call
- But this is ephemeral and is the least valuable part (same as Claude Code, Cursor, Windsurf)

### Precision Impact: ZERO

Agents still run locally with full code access. No indexing, no summarization, no lossy compression. The agent reads actual files in the worktree.

---

## 3. Current System Analysis

### 3.1 System Flow

```
State Change (File watcher or reconciliation)
        |
        v
Producer analyzes state
        |
        +-- If task PENDING & dependencies satisfied
        |     -> Create TaskWorktree, transition to INPROGRESS
        |
        +-- If subtask PENDING & dependencies satisfied
        |     -> Create SubtaskWorktree, transition to INPROGRESS
        |
        +-- Check subtask status:
           +-- INPROGRESS     -> Enqueue "implementation" job
           +-- AGENT_REVIEW   -> Enqueue "review" job
           +-- PENDING_MERGE  -> Enqueue "merge" job
           +-- MERGE_CONFLICT -> Enqueue "conflict-solver" job
           +-- Plan INPROGRESS (all subtasks DONE) -> Enqueue "completing-task"
        |
        v
JobQueue stores jobs
        |
        v
JobWorker dequeues job
        |
        v
Handler executes job
        +-- Register agent in registry
        +-- Spawn Claude CLI with prompt
        +-- Capture output & log
        +-- Wait for exit
        +-- Unregister agent
        +-- Update subtask status based on result
        |
        v
Job completion triggers reconciliation -> Cycle repeats
```

### 3.2 Status State Machines

**Task Status Flow:**

```
DRAFT -> BACKLOG -> PENDING -> INPROGRESS -> BLOCKED/REVIEW -> DONE
```

**Subtask Status Flow:**

```
PENDING -> INPROGRESS -> AGENT_REVIEW -> PENDING_MERGE -> DONE
                                              |
                                       MERGE_CONFLICT -> DONE (via conflict-solver)
```

**Plan Status Flow:**

```
INPROGRESS -> AGENT_REVIEW -> BLOCKED/REVIEW
```

### 3.3 Core Interfaces (Abstraction Points for Cloud Split)

The system uses two key interfaces that enable swapping local implementations for cloud implementations:

**JobQueue Interface** provides methods for:

- Enqueue/dequeue jobs
- Acknowledge or reject (nack) completed jobs
- Peek at queue, check size, check if job exists

**AgentRegistry Interface** provides methods for:

- Register/unregister running agents
- Query agents by job ID, task folder, or subtask
- List all agents, count running agents

**Current local implementations:** `MemoryQueue` and `MemoryAgentRegistry` (in-memory).
These are already injected via constructor options -- swapping for cloud implementations requires zero changes to the Orchestrator.

### 3.4 Job Types and Handlers

| Job Type          | Handler Class           | What It Does                   |
| ----------------- | ----------------------- | ------------------------------ |
| implementation    | ImplementationHandler   | Code the subtask using TDD     |
| review            | ReviewHandler           | Review code, document findings |
| merge             | MergeHandler            | Merge subtask into task branch |
| conflict-solver   | ConflictSolverHandler   | Resolve git merge conflicts    |
| completing-task   | CompletingTaskHandler   | Verify all subtasks complete   |
| completion-review | CompletionReviewHandler | Final review of completed task |

### 3.5 Prompt Templates

Each agent type has a corresponding prompt template:

| Template          | Function                    | Variables                  |
| ----------------- | --------------------------- | -------------------------- |
| implementation    | getImplementationPrompt()   | subtaskPath, taskDir       |
| review            | getReviewPrompt()           | subtaskPath, reviewPath    |
| completing-task   | getCompletingTaskPrompt()   | taskFolder, devsfactoryDir |
| completion-review | getCompletionReviewPrompt() | taskFolder, devsfactoryDir |
| conflict-solver   | getConflictSolverPrompt()   | taskFolder, subtaskFile    |
| planning          | getPlanningPrompt()         | taskPath                   |

All use `getTemplate(name, variables)` to load markdown templates and fill variables.

### 3.6 Agent Execution

The AgentRunner spawns Claude CLI processes:

1. Builds the command via the provider's `buildCommand()`
2. Spawns a Bun subprocess with stdout/stderr pipes
3. Streams output via `parseStreamJson()` for real-time monitoring
4. Logs output to files
5. Emits events: `started`, `output`, `completed`

### 3.7 Dashboard (Current)

- **Server**: Bun HTTP + WebSocket via `DashboardServer`
- **Frontend**: React + Zustand state management
- **WebSocket Events**: `state`, `taskChanged`, `subtaskChanged`, `agentStarted`, `agentOutput`, `agentCompleted`, `jobFailed`, `jobRetrying`
- **REST API**: State retrieval, status updates, PR creation, diff viewing

### 3.8 Configuration

The system is configured via environment variables with sensible defaults:

| Config                   | Default      | Description                    |
| ------------------------ | ------------ | ------------------------------ |
| maxConcurrentAgents      | 3            | Max parallel agent processes   |
| devsfactoryDir           | .devsfactory | Task/subtask markdown location |
| worktreesDir             | .worktrees   | Git worktree location          |
| debounceMs               | 100          | File watcher debounce          |
| retryBackoff.initialMs   | 2000         | Initial retry delay            |
| retryBackoff.maxMs       | 300000       | Max retry delay                |
| retryBackoff.maxAttempts | 5            | Max retry attempts             |

---

## 4. Target Architecture

### 4.1 Component Mapping: Current -> Target

| Current Component   | Target Location                     | Package                     | Changes Needed     |
| ------------------- | ----------------------------------- | --------------------------- | ------------------ |
| Orchestrator class  | Cloud                               | apps/backend                | Read from DB       |
| JobProducer         | Cloud                               | apps/backend                | Move as-is         |
| JobWorker           | Split: scheduling cloud, exec local | apps/backend + orchestrator | Moderate refactor  |
| MemoryQueue         | Cloud (PostgreSQL)                  | packages/db                 | Swap via interface |
| MemoryAgentRegistry | Cloud (PostgreSQL)                  | packages/db                 | Swap via interface |
| AgentRunner         | Local                               | packages/orchestrator       | Unchanged          |
| handlers.ts         | Split: decision cloud, exec local   | apps/backend + orchestrator | Key refactor       |
| src/templates/\*.md | Versioned in git, served from cloud | packages/prompts            | Auditable history  |
| src/prompts/\*.ts   | Prompt assembly                     | packages/prompts            | assembler.ts       |
| DashboardServer     | Local + cloud sync                  | packages/orchestrator       | Add WS upstream    |
| DevsfactoryWatcher  | Local (sends events to cloud)       | packages/orchestrator       | Add forwarding     |
| parser/             | Part of orchestrator                | packages/orchestrator       | Merged in          |
| git.ts              | Extracted as primitives             | packages/git                | Clean API          |
| providers/          | LLM provider implementations        | packages/llm-providers      | Renamed            |
| Shared interfaces   | Pure types (zero deps)              | packages/common             | Extract types      |
| DB layer (Kysely)   | Database operations                 | packages/db                 | New package        |

### 4.2 The Key Refactor: handlers.ts

```
CURRENT (all local):
  JobWorker.process(job)
    -> Handler.execute(job)
      -> spawnAgent({ type, taskFolder, subtaskFile, cwd })
        -> getPromptForJob(...)  // LOCAL template
        -> agentRunner.spawn()   // LOCAL execution

NEW (split):
  Cloud:
    Orchestrator decides next job
    -> assemblePrompt(job, templates, state)  // CLOUD template + assembly
    -> send { jobId, assembledPrompt, cwd } to local worker via WS

  Local:
    WorkerClient receives { jobId, assembledPrompt, cwd }
    -> agentRunner.spawn({ prompt: assembledPrompt, cwd, provider })
    -> report { jobId, exitCode, output } back to cloud
```

### 4.3 Full Execution Flow (Cloud + Local)

```
1. User runs `aop start --mode cloud`
   -> WorkerClient connects to cloud via WSS
   -> Sends API key + project manifest (file tree, package.json)
   -> Cloud validates via Clerk, registers worker

2. User creates task via browser UI
   -> Dashboard form collects: title, description, requirements, criteria
   -> POST /api/tasks/create creates task.md locally
   -> DevsfactoryWatcher detects new file
   -> WorkerClient sends state_sync to cloud

3. Cloud Orchestrator sees: task PENDING, no plan.md
   -> Enqueues "planning" job
   -> Fetches planning.md template
   -> Fills variables: {{taskPath}}, {{taskDir}}
   -> Sends to local: { jobId, prompt: assembledPrompt, cwd }

4. Local WorkerClient receives job
   -> AgentRunner.spawn("claude", prompt, cwd)    <-- user's Claude
   -> Planning agent reads task.md, explores codebase
   -> Creates subtask files + plan.md
   -> Reports back: { jobId, exitCode: 0 }

5. User reviews plan in browser
   -> Plan review UI shows subtasks, dependency graph
   -> User approves -> task transitions to PENDING
   -> state_sync to cloud

6. Cloud Orchestrator sees: subtask 001 PENDING, deps satisfied
   -> Transitions to INPROGRESS
   -> Fetches implementation.md template
   -> Fills variables, dispatches to worker

7. Implementation agent runs locally, completes
   -> status -> AGENT_REVIEW
   -> Cloud dispatches review job
   -> Review agent runs, passes
   -> status -> PENDING_MERGE
   -> Cloud dispatches merge job
   -> Merge succeeds -> DONE

8. Cloud sees all subtasks DONE
   -> Triggers completing-task agent
   -> Final verification
   -> Task -> DONE
   -> Dashboard shows completion
```

---

## 5. Epic 1: Cloud Orchestrator

### 5.1 Scope

Move the deterministic orchestration logic to a cloud server while keeping all AI execution local on the user's machine.

### 5.2 Components

**Cloud Server (apps/backend/):**

- Hono HTTP server with Bun runtime
- WebSocket server for worker connections
- PostgreSQL for state, jobs, agents (via @aop/db)
- Clerk for authentication
- Prompt assembly (via @aop/prompts)

**Database Layer (@aop/db):**

- Kysely type-safe query builder
- PostgresJobQueue (implements JobQueue interface)
- PostgresAgentRegistry (implements AgentRegistry interface)
- SQL migrations

**Prompt Templates (@aop/prompts):**

- Markdown templates versioned in git (auditable)
- Variable definitions per template
- Assembler: template + variables → final prompt
- Served from cloud, source of truth in codebase

**Git Operations (@aop/git):**

- Low-level git primitives (worktree, branch, merge, commit)
- Clean TypeScript API over git commands
- Used by @aop/orchestrator for worktree strategy

**LLM Providers (@aop/llm-providers):**

- Provider interface for LLM implementations
- Claude CLI provider (spawns claude command locally)
- Claude API provider (future, for cloud-side operations)

**Local Worker (@aop/orchestrator/worker-client.ts):**

- WebSocket client connecting to cloud
- Receives assembled prompts, spawns AgentRunner
- Reports results and state changes back
- Reconnection with exponential backoff

### 5.3 Cloud Server Routes

| Method | Endpoint                    | Description                   |
| ------ | --------------------------- | ----------------------------- |
| GET    | /health                     | Health check                  |
| POST   | /api/auth/login             | Clerk auth flow               |
| GET    | /api/templates              | List prompt templates (admin) |
| PUT    | /api/templates/:type        | Update template (admin)       |
| GET    | /api/projects/:id/state     | Get project state             |
| GET    | /api/projects/:id/analytics | Get analytics                 |
| WS     | /ws                         | Worker connection endpoint    |

### 5.4 Issue Breakdown

| Issue | Title                                           | Depends On         |
| ----- | ----------------------------------------------- | ------------------ |
| #61   | Scaffold apps/backend with Bun + Hono           | #58                |
| #60   | PostgreSQL schema and data layer (packages/db)  | #58, #61           |
| #62   | Integrate Clerk authentication                  | #61                |
| #64   | Move orchestration logic to cloud server        | #61, #60           |
| #63   | Cloud-side prompt template serving and assembly | #61, #60           |
| #65   | Implement local WorkerClient                    | #59, #62           |
| #67   | State sync: local filesystem events to cloud    | #59, #65           |
| #66   | Integration testing: cloud + local worker e2e   | #64, #63, #65, #67 |
| #68   | Deploy cloud orchestrator server                | all above          |

---

## 6. Epic 2: Chat Experience

### 6.1 Scope

Add a browser-based interactive chat experience for task planning, plus a task creation form and plan review UI.

### 6.2 Chat Architecture

```
Browser (chat UI)          Backend                    Claude CLI process
     |                        |                            |
     |  "Add authentication"  |                            |
     | ---------------------> |  write to stdin  -------> |
     |                        |                            |
     |                        |  read from stdout:         |
     |  "What auth method     | <--------------------------|
     |   do you prefer?"      |                            |
     | <--------------------- |                            |
     |                        |                            |
     |  "JWT with refresh"    |                            |
     | ---------------------> |  write to stdin  -------> |
     |                        |                            |
     |                        |  ...Claude creates files...|
     |                        | <--- tool_use events       |
     |  [streaming activity]  |                            |
     | <--------------------- |                            |
     |                        |                            |
     |                        | <--- result                |
     |  "Plan ready! Review?" |                            |
     | <--------------------- |                            |
```

### 6.3 Claude CLI Bidirectional Streaming

Claude CLI supports bidirectional NDJSON streaming with flags:

- `--input-format stream-json` -- accept NDJSON on stdin
- `--output-format stream-json` -- emit NDJSON on stdout

This enables a full multi-turn chat experience through a single long-running process.

### 6.4 Chat Session States

```
STARTING -> ACTIVE -> ENDED
               |
               v
            PAUSED -> ACTIVE (resume)
               |
               v
            ENDED (timeout)

ACTIVE -> ERROR -> ENDED (crash)
```

### 6.5 User Flows

**Flow 1: Form + Automatic Planning (v1 UX)**

```
+-------------------------------------------+
|  New Task                                  |
|                                            |
|  Title:        [________________________]  |
|  Description:  [________________________]  |
|  Requirements: [________________________]  |
|  Criteria:     [________________________]  |
|  Priority:     [high v]                    |
|                                            |
|            [Create & Plan]                 |
+-------------------------------------------+
         |
         v
   Backend creates task.md (no AI)
         |
         v
   Orchestrator sees PENDING task without plan.md
         |
         v
   Spawns planning agent (non-interactive)
         |
         v
   Plan created. Dashboard shows for review.
   User approves -> orchestrator picks up.
```

**Flow 2: Chat + Interactive Planning (v2 UX)**

```
+---------------------------------------------------+
|  AOP Planning Assistant                            |
|                                                    |
|  You: I want to add user authentication            |
|                                                    |
|  AOP: What authentication method do you prefer?    |
|       - JWT with refresh tokens                    |
|       - Session-based with cookies                 |
|       - OAuth2 with external provider              |
|                                                    |
|  You: JWT with refresh tokens                      |
|                                                    |
|  AOP: Got it. Should I also add:                   |
|       - Password reset flow?                       |
|       - Email verification?                        |
|       - Rate limiting on login?                    |
|                                                    |
|  You: All of them                                  |
|                                                    |
|  AOP: Creating plan with 7 subtasks...             |
|       [check] task.md created                      |
|       [check] 7 subtask files created              |
|       [check] plan.md with dependency graph        |
|                                                    |
|  [Review Plan]  [Start Execution]                  |
|                                                    |
|  [________________________________] [Send]         |
+---------------------------------------------------+
```

### 6.6 Issue Breakdown

| Issue | Title                                                      | Depends On |
| ----- | ---------------------------------------------------------- | ---------- |
| #71   | ChatSession manager for bidirectional Claude CLI streaming | --         |
| #69   | WebSocket chat routing in DashboardServer                  | #71        |
| #70   | Task creation form UI in dashboard                         | --         |
| #72   | Planning agent job type for task decomposition             | --         |
| #75   | Chat UI component for interactive planning                 | #69, #70   |
| #73   | Plan review UI for approving generated subtasks            | #72, #70   |
| #74   | Chat session lifecycle management                          | #71, #69   |
| #76   | Integration testing: chat experience e2e                   | all above  |

---

## 7. Foundation Work

### 7.1 Shared Types Package (#58)

Extract into `@aop/common` (zero runtime dependencies):

- Interfaces: `JobQueue`, `AgentRegistry`
- Job types: `Job`, `JobType`, `JobStatus`, `JobResult`
- Domain types: `Task`, `Subtask`, `Plan`, `TaskStatus`, `SubtaskStatus`
- WebSocket message types (new, defined in #59)
- Config types

### 7.2 WebSocket Protocol Spec (#59)

Unified protocol for both cloud-worker and chat communication. See Section 8.

### 7.3 Git Package (NEW)

Extract into `@aop/git`:

- Worktree operations (add, remove, list, prune)
- Branch operations (create, delete, checkout, list)
- Merge operations (merge, abort, conflict detection)
- Commit operations (create, amend)
- Status operations (get, isClean, diff)

### 7.4 Prompts Package (NEW)

Create `@aop/prompts`:

- Markdown templates in `src/templates/*.md`
- Variable definitions per template type
- Assembler function: template + variables → final prompt
- Templates versioned in git for auditability

### 7.5 LLM Providers Package (NEW)

Create `@aop/llm-providers`:

- Provider interface for LLM implementations
- Claude CLI provider (current, spawns local claude command)
- Claude API provider (future, for cloud-side if needed)

---

## 8. WebSocket Protocol Specification

### 8.1 Message Envelope

All messages use a common envelope with:

- **type** -- message discriminator
- **payload** -- type-specific data
- **timestamp** -- ISO 8601
- **correlationId** -- for request/response pairing (optional)

### 8.2 Cloud-Worker Messages

| Message Type | Direction        | Description                                    |
| ------------ | ---------------- | ---------------------------------------------- |
| auth         | worker -> cloud  | Handshake with API key and project manifest    |
| auth_result  | cloud -> worker  | Success/failure response with worker ID        |
| heartbeat    | worker -> cloud  | Keep-alive with active job count               |
| pong         | cloud -> worker  | Heartbeat response with server time            |
| job_dispatch | cloud -> worker  | Job assignment with assembled prompt and cwd   |
| job_accept   | worker -> cloud  | Worker accepts the job                         |
| job_reject   | worker -> cloud  | Worker rejects the job (at capacity, etc.)     |
| job_result   | worker -> cloud  | Job completion with exit code, timing, output  |
| agent_output | worker -> cloud  | Streaming agent output for dashboard display   |
| state_sync   | worker -> cloud  | File state changes (task/subtask/plan updates) |
| error        | either direction | Error with code, message, and context          |

### 8.3 Chat Messages (browser <-> backend)

| Message Type  | Direction          | Description                                       |
| ------------- | ------------------ | ------------------------------------------------- |
| chat_start    | browser -> backend | Start new session with optional context           |
| chat_started  | backend -> browser | Session created, returns sessionId                |
| chat_message  | browser -> backend | User sends message to session                     |
| chat_response | backend -> browser | Streaming assistant response (incremental chunks) |
| chat_tool_use | backend -> browser | Tool use events (Read, Write, Edit, Bash, etc.)   |
| chat_end      | either direction   | End session (user, completed, timeout, or error)  |
| error         | either direction   | Error with code, message, and context             |

---

## 9. Database Schema

### 9.1 Entity-Relationship Overview

```
users (Clerk-managed)
  |
  +--< projects
        |
        +--< jobs
        |     |
        |     +--< agents
        |
        +--< task_state
        |
        +--< prompt_templates (global, not per-project)
```

### 9.2 Tables

| Table            | Purpose                                       | Key Fields                                                                      |
| ---------------- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| users            | User accounts (synced from Clerk)             | clerk_id, email, name                                                           |
| projects         | Registered repos                              | user_id, name, repo_url, config                                                 |
| jobs             | Job queue (replaces MemoryQueue)              | type, status, task_folder, subtask_file, priority, payload, attempts, worker_id |
| agents           | Running agents (replaces MemoryAgentRegistry) | job_id, type, task_folder, worker_id, pid, status, exit_code                    |
| task_state       | Cached task/subtask state from workers        | path, entity_type, status, content_hash                                         |
| prompt_templates | Versioned prompt templates (global)           | type, version, content, is_active                                               |

### 9.3 Job Queue Dequeue Pattern

Uses PostgreSQL's `SELECT ... FOR UPDATE SKIP LOCKED` pattern for reliable concurrent dequeuing:

- Atomically claims the next pending job
- Prevents double-processing by multiple workers
- Supports priority ordering

---

## 10. Dependency Graph

### 10.1 Foundation -> Epics

```
#58 Extract common types (@aop/common)
 |
 +---> #61 Scaffold apps/backend   ---> #60 PostgreSQL schema (@aop/db)
 |     |                               |
 |     +---> #62 Clerk auth            +---> #64 Orchestration logic
 |     |                               +---> #63 Prompt serving (@aop/prompts)
 |     +---> #60 (also depends)
 |
 +---> #59 WebSocket protocol spec
       |
       +---> #65 WorkerClient    ---> #67 State sync
       |     (@aop/orchestrator)       |
       +---> #69 WS chat routing       +---> #66 Integration tests (cloud)
                                              |
                                              +---> #68 Deploy
```

### 10.2 Chat Experience Dependencies

```
#71 ChatSession manager (independent)
 |
 +---> #69 WS chat routing
 |      |
 |      +---> #75 Chat UI
 |      +---> #74 Session lifecycle
 |
#70 Task creation form (independent)
 |
 +---> #75 Chat UI
 +---> #73 Plan review UI
 |
#72 Planning agent (independent)
 |
 +---> #73 Plan review UI
 |
 +---> #76 Integration tests (chat)
```

### 10.3 Suggested Implementation Order

**Week 1 -- Foundation + Parallel Starts:**

1. #58 Extract common types (@aop/common)
2. #59 WebSocket protocol spec
3. #NEW Extract git primitives (@aop/git)
4. #NEW Create prompts package (@aop/prompts)
5. #71 ChatSession manager (@aop/orchestrator) - parallel, no deps
6. #70 Task creation form (apps/dashboard) - parallel, no deps
7. #72 Planning agent (@aop/orchestrator) - parallel, no deps

**Week 2 -- Cloud Infrastructure:**

8. #61 Scaffold apps/backend with Hono
9. #60 PostgreSQL schema (@aop/db with Kysely)
10. #62 Clerk auth
11. #69 WebSocket chat routing

**Week 3 -- Core Logic:**

12. #64 Move orchestration logic to apps/backend
13. #63 Prompt template serving (from @aop/prompts)
14. #65 WorkerClient (@aop/orchestrator)
15. #75 Chat UI (apps/dashboard)
16. #73 Plan review UI (apps/dashboard)

**Week 4 -- Integration + Deploy:**

17. #67 State sync
18. #74 Session lifecycle
19. #66 Integration tests (cloud)
20. #76 Integration tests (chat)
21. #68 Deploy

---

## 11. Monorepo Structure

The monorepo uses Bun workspaces with a clear separation between **apps** (deployable entry points) and **packages** (shared libraries). Turborepo can be added later if build caching becomes necessary.

### 11.1 Directory Layout

```
aop/
+-- apps/
|   +-- cli/                          # Local CLI entry point
|   |   +-- src/
|   |   |   +-- cli.ts                # Command definitions (login/logout/whoami/start --mode)
|   |   |   +-- commands/
|   |   |   |   +-- start.ts
|   |   |   |   +-- login.ts
|   |   |   |   +-- logout.ts
|   |   |   |   +-- whoami.ts
|   |   |   +-- index.ts
|   |   +-- package.json              # @aop/cli
|   |   +-- tsconfig.json
|   |
|   +-- dashboard/                    # React frontend
|   |   +-- src/
|   |   |   +-- components/
|   |   |   |   +-- App.tsx
|   |   |   |   +-- TaskForm.tsx      # Task creation form
|   |   |   |   +-- ChatPanel.tsx     # Chat UI
|   |   |   |   +-- PlanReview.tsx    # Plan review/approval
|   |   |   |   +-- ChatBubble.tsx    # Message bubble component
|   |   |   |   +-- ToolActivity.tsx  # Tool use indicator
|   |   |   +-- hooks/
|   |   |   |   +-- useWebSocket.ts   # Extended with chat message types
|   |   |   |   +-- useChat.ts        # Chat session hook
|   |   |   +-- store.ts              # Zustand state (extended with chat)
|   |   |   +-- api.ts                # REST API client
|   |   |   +-- main.tsx
|   |   +-- package.json              # @aop/dashboard
|   |   +-- tsconfig.json
|   |
|   +-- backend/                      # Backend server (cloud orchestrator)
|   |   +-- src/
|   |   |   +-- index.ts              # Hono server entry point
|   |   |   +-- routes/
|   |   |   |   +-- health.ts
|   |   |   |   +-- auth.ts           # Clerk webhook handlers
|   |   |   |   +-- templates.ts      # Template management (admin)
|   |   |   |   +-- projects.ts       # Project state + analytics
|   |   |   +-- ws/
|   |   |   |   +-- handler.ts        # WebSocket connection manager
|   |   |   |   +-- protocol.ts       # Message parsing/routing
|   |   |   +-- services/
|   |   |       +-- orchestrator.ts   # Cloud orchestrator
|   |   |       +-- producer.ts       # Cloud job producer
|   |   +-- package.json              # @aop/backend
|   |   +-- tsconfig.json
|   |   +-- Dockerfile
|   |   +-- docker-compose.yml
|   |
|   +-- vscode/                       # VS Code extension (v1.1+)
|       +-- src/
|       |   +-- extension.ts          # Extension entry point
|       |   +-- tools/                # Developer tools
|       |   +-- providers/            # TreeView providers
|       |   +-- views/                # WebView providers
|       +-- webview-ui/               # React app for WebViews
|       +-- package.json              # @aop/vscode
|       +-- tsconfig.json
|
+-- packages/
|   +-- common/                       # Pure types (zero runtime deps)
|   |   +-- src/
|   |   |   +-- interfaces/           # JobQueue, AgentRegistry
|   |   |   +-- types/                # Job, Task, Subtask, Config
|   |   |   +-- ws/                   # WebSocket message types
|   |   |   +-- index.ts
|   |   +-- package.json              # @aop/common
|   |   +-- tsconfig.json
|   |
|   +-- git/                          # Git operations (primitives)
|   |   +-- src/
|   |   |   +-- worktree.ts           # Worktree CRUD
|   |   |   +-- branch.ts             # Branch operations
|   |   |   +-- merge.ts              # Merge + conflict detection
|   |   |   +-- commit.ts             # Commit operations
|   |   |   +-- status.ts             # Status, diff, clean check
|   |   |   +-- remote.ts             # Push, pull, fetch
|   |   |   +-- types.ts              # Git-specific types
|   |   |   +-- executor.ts           # Shell command executor (Bun.$)
|   |   |   +-- index.ts
|   |   +-- package.json              # @aop/git
|   |   +-- tsconfig.json
|   |
|   +-- prompts/                      # Prompt templates (auditable in git)
|   |   +-- src/
|   |   |   +-- templates/
|   |   |   |   +-- implementation.md
|   |   |   |   +-- review.md
|   |   |   |   +-- planning.md
|   |   |   |   +-- completing-task.md
|   |   |   |   +-- conflict-solver.md
|   |   |   |   +-- completion-review.md
|   |   |   +-- variables.ts          # Variable definitions per template
|   |   |   +-- assembler.ts          # Template + variables -> prompt
|   |   |   +-- index.ts
|   |   +-- package.json              # @aop/prompts
|   |   +-- tsconfig.json
|   |
|   +-- orchestrator/                 # Orchestration logic
|   |   +-- src/
|   |   |   +-- orchestrator.ts       # State machine, reconciliation
|   |   |   +-- agent-runner.ts       # Agent spawning
|   |   |   +-- worker-client.ts      # WebSocket client to cloud
|   |   |   +-- chat-session.ts       # Bidirectional Claude streaming
|   |   |   +-- dashboard-server.ts   # Local dashboard server with chat routing
|   |   |   +-- watcher.ts            # File watcher with state sync forwarding
|   |   |   +-- config.ts             # Config with cloud settings
|   |   |   +-- producer/
|   |   |   +-- worker/
|   |   |   |   +-- handlers.ts       # Job handlers (extended with PlanningHandler)
|   |   |   +-- local/                # MemoryQueue, MemoryRegistry (preserved)
|   |   |   +-- parser/               # Markdown file parsing
|   |   |   |   +-- task-parser.ts
|   |   |   |   +-- subtask-parser.ts
|   |   |   |   +-- plan-parser.ts
|   |   |   +-- worktree-strategy.ts  # AOP-specific git worktree strategy
|   |   +-- package.json              # @aop/orchestrator
|   |   +-- tsconfig.json
|   |
|   +-- db/                           # Database layer (Kysely)
|   |   +-- src/
|   |   |   +-- schema.ts             # Kysely table definitions
|   |   |   +-- migrations/           # SQL migrations
|   |   |   +-- queue.ts              # PostgresJobQueue
|   |   |   +-- registry.ts           # PostgresAgentRegistry
|   |   |   +-- templates.ts          # Template repository
|   |   |   +-- index.ts
|   |   +-- package.json              # @aop/db
|   |   +-- tsconfig.json
|   |
|   +-- llm-providers/                # LLM providers
|   |   +-- src/
|   |   |   +-- types.ts              # Provider interface, response types
|   |   |   +-- claude/
|   |   |   |   +-- claude-cli.ts     # Claude CLI provider (spawns claude command)
|   |   |   |   +-- claude-api.ts     # Claude API provider (future, for cloud-side)
|   |   |   |   +-- index.ts
|   |   |   +-- index.ts
|   |   +-- package.json              # @aop/llm-providers
|   |   +-- tsconfig.json
|   |
|   +-- ui/                           # Shared React components
|       +-- src/
|       |   +-- ChatBubble.tsx
|       |   +-- ToolActivity.tsx
|       |   +-- PlanGraph.tsx
|       |   +-- index.ts
|       +-- package.json              # @aop/ui
|       +-- tsconfig.json
|
+-- e2e-tests/                        # E2E tests for cloud + chat
+-- package.json                      # Workspace root
+-- bunfig.toml                       # Bun configuration
+-- tsconfig.base.json                # Shared TypeScript config
+-- biome.json
```

### 11.2 Package Summary

| Package              | Purpose                                        | Dependencies                        |
| -------------------- | ---------------------------------------------- | ----------------------------------- |
| `@aop/common`        | Pure types, interfaces                         | None (zero runtime deps)            |
| `@aop/git`           | Git primitives (worktree, branch, merge)       | common                              |
| `@aop/prompts`       | Prompt templates + assembler                   | common                              |
| `@aop/llm-providers` | LLM provider implementations                   | common                              |
| `@aop/orchestrator`  | Orchestration logic, parser, worktree strategy | common, git, prompts, llm-providers |
| `@aop/db`            | PostgreSQL via Kysely                          | common                              |
| `@aop/ui`            | Shared React components                        | common                              |

### 11.3 Package Dependencies

```
                              @aop/common (pure types)
                                      ▲
              ┌───────────┬───────────┼───────────┬───────────┐
              │           │           │           │           │
          @aop/git   @aop/prompts  @aop/db  @aop/llm-providers  @aop/ui
              ▲           ▲           ▲           ▲
              │           │           │           │
              └─────┬─────┴─────┬─────┘           │
                    │           │                 │
               @aop/orchestrator ◄────────────────┘
                    ▲
        ┌───────────┼───────────┐
        │           │           │
    @aop/cli    @aop/backend   @aop/vscode
        │           │           │
        └─────┬─────┴─────┬─────┘
              │           │
         @aop/dashboard   │
              │           │
              └───► @aop/ui
```

### 11.3 Workspace Configuration

**Root package.json:**

```json
{
  "name": "aop",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "bun run --filter './apps/*' dev",
    "build": "bun run --filter '*' build",
    "build:cli": "bun run --filter @aop/cli build",
    "build:cloud": "bun run --filter @aop/backend build",
    "build:dashboard": "bun run --filter @aop/dashboard build",
    "test": "bun run --filter '*' test",
    "test:e2e": "bun run --filter e2e-tests test",
    "lint": "biome check .",
    "typecheck": "bun run --filter '*' typecheck"
  }
}
```

---

## 12. Technology Decisions

| Decision        | Choice           | Rationale                                   |
| --------------- | ---------------- | ------------------------------------------- |
| Cloud runtime   | Bun              | Same as local CLI, share code and types     |
| Cloud framework | Hono             | Lightweight, native Bun + WebSocket support |
| Database        | PostgreSQL       | Handles queue, registry, auth, analytics    |
| Query Builder   | Kysely           | Type-safe, lightweight, good Bun support    |
| Auth            | Clerk            | Plug-and-play, API key management           |
| Frontend state  | Zustand          | Already in use, extend for chat state       |
| Monorepo        | Bun workspaces   | Already using Bun, native workspace support |
| Deployment      | Railway / Fly.io | Bun-compatible, managed Postgres available  |
| CI/CD           | GitHub Actions   | Already using GitHub, natural fit           |

---

## 13. Cost Analysis

| Component                     | Your Cost         | Who Pays for AI            |
| ----------------------------- | ----------------- | -------------------------- |
| Cloud server (orchestration)  | ~$20-50/month VPS | N/A (no AI)                |
| PostgreSQL (managed)          | ~$5-10/month      | N/A                        |
| Prompt template storage       | Negligible        | N/A (static data)          |
| Clerk auth                    | Free tier (10K)   | N/A                        |
| Task planning (brainstorming) | $0                | User's Claude subscription |
| Implementation agents         | $0                | User's Claude subscription |
| Review agents                 | $0                | User's Claude subscription |
| All other agents              | $0                | User's Claude subscription |
| **TOTAL**                     | **~$50/month**    | User pays their own Claude |

### Future AI Features (not needed for v1)

If you later want cloud-side AI (auto-decompose, quality prediction):

- **Option 1**: Use Haiku (~$0.001 per task). 10K tasks/month = $10.
- **Option 2**: User brings their own API key.
- **Option 3**: Include AI budget in subscription tiers.

---

## 14. Security Considerations

### 14.1 Data Flow

**What goes to the cloud:**

- Task creation intention (not the task description itself, that's local)
- Subtask statuses (PENDING, INPROGRESS, DONE, etc.)
- Timing metrics (how long agents take)
- Error reports (exit codes, failure reasons)
- Project manifest (file tree, package.json -- NOT code)

**What stays local:**

- Users tasks and subtasks descriptions (we only receive ids to orchestrate)
- User's source code (never leaves their machine)
- Git repositories and worktrees
- Claude CLI conversations
- Agent execution output
- API keys for Claude (user's subscription)

### 14.2 Authentication

- Clerk manages user sessions and API keys
- WebSocket connections authenticated via API key in handshake
- All cloud endpoints protected by Clerk middleware
- API keys stored in `~/.aop/config.json` (user's machine only)

### 14.3 Transport Security

- All WebSocket connections use WSS (TLS encrypted)
- Cloud server HTTPS only
- No sensitive data in URL parameters

### 14.4 Prompt Visibility

Assembled prompts are visible to the user during Claude CLI execution (via `ps aux` or process inspection). This is an accepted trade-off:

- Same as Claude Code, Cursor, Windsurf -- all have visible prompts
- The assembled prompt is the least valuable part of the IP
- The orchestration system that coordinates everything is the real moat

---

## 15. Issue Tracker

### Foundation

| Issue                                           | Title                                                    | Status |
| ----------------------------------------------- | -------------------------------------------------------- | ------ |
| [#58](https://github.com/get-aop/aop/issues/58) | Extract common types into packages/common                | Open   |
| [#59](https://github.com/get-aop/aop/issues/59) | Define WebSocket protocol spec for cloud-worker and chat | Open   |

### Cloud Orchestrator

| Issue                                           | Title                                           | Status |
| ----------------------------------------------- | ----------------------------------------------- | ------ |
| [#61](https://github.com/get-aop/aop/issues/61) | Scaffold apps/backend with Bun + Hono           | Open   |
| [#60](https://github.com/get-aop/aop/issues/60) | PostgreSQL schema and data layer (packages/db)  | Open   |
| [#62](https://github.com/get-aop/aop/issues/62) | Integrate Clerk authentication                  | Open   |
| [#64](https://github.com/get-aop/aop/issues/64) | Move orchestration logic to cloud server        | Open   |
| [#63](https://github.com/get-aop/aop/issues/63) | Cloud-side prompt template serving and assembly | Open   |
| [#65](https://github.com/get-aop/aop/issues/65) | Implement local WorkerClient                    | Open   |
| [#67](https://github.com/get-aop/aop/issues/67) | State sync: local filesystem events to cloud    | Open   |
| [#66](https://github.com/get-aop/aop/issues/66) | Integration testing: cloud + local worker e2e   | Open   |
| [#68](https://github.com/get-aop/aop/issues/68) | Deploy cloud orchestrator server                | Open   |

### Chat Experience

| Issue                                           | Title                                                      | Status |
| ----------------------------------------------- | ---------------------------------------------------------- | ------ |
| [#71](https://github.com/get-aop/aop/issues/71) | ChatSession manager for bidirectional Claude CLI streaming | Open   |
| [#69](https://github.com/get-aop/aop/issues/69) | WebSocket chat routing in DashboardServer                  | Open   |
| [#70](https://github.com/get-aop/aop/issues/70) | Task creation form UI in dashboard                         | Open   |
| [#72](https://github.com/get-aop/aop/issues/72) | Planning agent job type for task decomposition             | Open   |
| [#75](https://github.com/get-aop/aop/issues/75) | Chat UI component for interactive planning                 | Open   |
| [#73](https://github.com/get-aop/aop/issues/73) | Plan review UI for approving generated subtasks            | Open   |
| [#74](https://github.com/get-aop/aop/issues/74) | Chat session lifecycle management                          | Open   |
| [#76](https://github.com/get-aop/aop/issues/76) | Integration testing: chat experience e2e                   | Open   |
