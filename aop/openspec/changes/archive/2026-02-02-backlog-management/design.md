## Context

Milestone 1 validated the core loop: one task, one agent, manual execution via `aop run <path>`. The CLI exists with basic commands, SQLite/Kysely database, and integration with git-manager and llm-provider packages.

This design covers Milestone 2: multi-repo task tracking with a daemon that watches for changes, manages a unified backlog, and auto-executes tasks from a queue.

**Constraints:**
- Local-first: all state in SQLite at `~/.aop/aop.sqlite`
- Privacy: code never leaves user's machine
- Daemon runs as single long-lived process
- Local workflow runner is throwaway (server takes over in M3)

## Goals / Non-Goals

**Goals:**
- Register and track multiple repositories
- Detect OpenSpec changes automatically via file watching
- Unified task backlog across all repos
- Auto-execute READY tasks respecting concurrency limits
- Resume WORKING tasks on daemon restart
- Configurable settings (polling intervals, timeouts, concurrency)

**Non-Goals:**
- Server sync (Milestone 3)
- Dashboard (Milestone 4)
- Multi-step workflows (server owns this)
- YAML workflow parsing

## Decisions

### 1. Database Location

**Choice:** Single SQLite database at `~/.aop/aop.sqlite`

**Rationale:** Unified backlog requires single source of truth across all repos. Standard pattern (like `~/.config/gh/`). Survives repo deletions.

### 2. Daemon Architecture

**Choice:** Single-process daemon with PID file at `~/.aop/aop.pid`

```
┌─────────────────────────────────────────────────────────────────┐
│                         AOP Daemon                              │
│                    (aop start / aop stop)                       │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ File Watcher│  │   Queue     │  │   Workflow Executor     │ │
│  │ + Ticker    │  │  Processor  │  │   (fake, throwaway)     │ │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘ │
│         │                │                     │               │
│         ▼                ▼                     ▼               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    SQLite Database                          ││
│  │  repos | tasks | executions | step_executions | settings    ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**Lifecycle:**
- `aop start` → write PID to `~/.aop/aop.pid`, log to `~/.aop/aop.log`
- `aop stop` → read PID file, send SIGTERM, wait for graceful exit

**Rationale:** Simple lifecycle, expected UX for CLI daemons, prevents duplicate instances.

### 3. File Watcher + Polling

**Choice:** Bun's native `fs.watch` + polling ticker for reconciliation

- **Native watcher:** Real-time detection of `openspec/changes/` events
- **Polling ticker:** Configurable interval (default 30s) scans all repos and reconciles with DB
- **Debouncing:** 500ms debounce on watcher events for rapid file writes

**Task detection:**
```
New directory: openspec/changes/add-auth/
  → INSERT task (status: DRAFT) ON CONFLICT DO NOTHING

Directory deleted:
  → UPDATE status = 'REMOVED' WHERE status != 'WORKING'
```

**Rationale:** Native watcher for responsiveness, polling as safety net for dropped events. Idempotent DB operations prevent race conditions between watcher and ticker.

### 4. Task Status Transitions

```
         ┌──────────────────────────────────────────┐
         │                                          │
         ▼                                          │
┌─────────────┐    user     ┌─────────────┐  daemon  ┌─────────────┐
│    DRAFT    │────────────▶│    READY    │─────────▶│   WORKING   │
└─────────────┘  task:ready └─────────────┘  auto    └──────┬──────┘
       ▲                                                    │
       │                         success ┌─────────────┐    │
       │                        ┌────────│    DONE     │◀───┤
       │                        │        └─────────────┘    │
       │                        │                           │
       │              ┌─────────────┐    failure            │
       └──────────────│   BLOCKED   │◀──────────────────────┘
            retry     └─────────────┘
```

| Transition | Trigger |
|------------|---------|
| → DRAFT | Watcher detects new change directory |
| DRAFT → READY | User runs `aop task:ready <task>` |
| READY → WORKING | Daemon auto-picks when capacity available |
| WORKING → DONE | Agent completes successfully |
| WORKING → BLOCKED | Agent fails or times out |
| BLOCKED → DRAFT | User retries |

**Rationale:** Auto-execute from queue is the target UX. User controls what's ready via explicit `task:ready` command.

### 5. Concurrency Model

**Choice:** Global limit AND per-repo limit (both must allow)

```
Global limit: max_concurrent_tasks = 3
Repo A limit: max_concurrent_tasks = 2
Repo B limit: max_concurrent_tasks = 1

Current: Repo A has 1 WORKING, Repo B has 1 WORKING (global: 2)

Can start in Repo A? ✓ (1 < 2) AND ✓ (2 < 3) → YES
Can start in Repo B? ✗ (1 = 1) → NO
```

**Queue ordering:** FIFO by `ready_at` timestamp. First task marked READY gets picked first.

**Rationale:** Per-repo limits prevent heavy repos from hogging resources. Global limit caps total agent load. This is production code (not throwaway).

### 6. Queue Processor

```typescript
async function processQueue() {
  const pollInterval = await getSetting('queue_poll_interval_secs'); // default 1s

  while (running) {
    const globalWorking = await countWorkingTasks();
    const globalMax = await getSetting('max_concurrent_tasks');

    if (globalWorking >= globalMax) {
      await sleep(pollInterval * 1000);
      continue;
    }

    // Find next READY task where repo also has capacity
    const task = await findNextExecutableTask(); // FIFO, respects repo limits

    if (task) {
      executeTask(task); // non-blocking
    }

    await sleep(pollInterval * 1000);
  }
}
```

### 7. Workflow Executor (Throwaway)

**Choice:** Single-step fake executor using `ClaudeCodeProvider.run()` with streaming output.

```typescript
async function executeTask(task: Task) {
  // 1. Mark WORKING
  await updateTaskStatus(task.id, 'WORKING');

  // 2. Create execution + step records
  const execId = typeid('exec');
  const stepId = typeid('step');
  await insertExecution({ execId, taskId: task.id, status: 'running' });
  await insertStepExecution({ stepId, execId, status: 'running' });

  // 3. Create/reuse worktree
  const worktree = await gitManager.createWorktree(task.id, 'main');

  // 4. Render prompt from template
  const prompt = await renderTemplate('naive-implement.md.hbs', {
    changeName: task.change_path,
    proposal: await readArtifact('proposal.md'),
    design: await readArtifact('design.md'),
    tasks: await readArtifact('tasks.md'),
    specs: await readSpecs(),
  });

  // 5. Run agent with streaming output
  const provider = new ClaudeCodeProvider();
  const timeoutMs = (await getSetting('agent_timeout_secs')) * 1000; // default 30m
  let lastActivity = Date.now();
  const logFile = `~/.aop/logs/${task.id}.jsonl`;

  const result = await provider.run({
    prompt,
    cwd: worktree.path,
    onOutput: (data) => {
      // Stream to log file
      appendToFile(logFile, JSON.stringify(data) + '\n');

      // Reset activity timer (timeout based on inactivity, not total time)
      lastActivity = Date.now();

      // Could also: update DB with progress, check for signals, etc.
    },
  });

  // 6. Update step with session ID
  await updateStepExecution(stepId, { sessionId: result.sessionId });

  // 7. Update status based on exit code
  const success = result.exitCode === 0;
  await updateStepExecution(stepId, {
    status: success ? 'success' : 'failure',
    exitCode: result.exitCode,
  });
  await updateTaskStatus(task.id, success ? 'DONE' : 'BLOCKED');
}
```

**Timeout handling:** Based on inactivity (time since last output), not total duration. A task that's actively producing output won't timeout. Separate watchdog checks `lastActivity` and kills the process if stale.

**Note:** This function gets deleted in M3 when server takes over workflow execution.

### 8. Daemon Restart / Resume

**Choice:** Auto-resume WORKING tasks on daemon restart

```typescript
async function resumeWorkingTasks() {
  const workingTasks = await getTasksByStatus('WORKING');

  for (const task of workingTasks) {
    const step = await getLatestStepExecution(task.id);

    if (step?.agent_pid && isProcessAlive(step.agent_pid)) {
      // Reattach monitoring to existing agent
      monitorAgent(task, step);
    } else {
      // Agent died - respawn execution
      executeTask(task);
    }
  }
}
```

**Rationale:** No user intervention required. Daemon crash is transparent - tasks continue or restart automatically.

### 9. CLI Commands

| Command | Description |
|---------|-------------|
| `aop start` | Start daemon, write PID file, begin watching |
| `aop stop` | Send SIGTERM to daemon via PID file |
| `aop status` | Show daemon state + tasks grouped by repo |
| `aop repo:init` | Register current directory as repo |
| `aop repo:remove [path]` | Unregister repo (fails if WORKING tasks unless --force) |
| `aop task:ready <task>` | Mark task READY for execution |
| `aop task:run <task>` | Manual execute (bypass queue/limits) |
| `aop config:get [key]` | Show config value(s) |
| `aop config:set <key> <value>` | Update config |
| `aop task:remove <task>` | Remove task (aborts if WORKING) |

**Status output:**
```
Daemon: running (pid 12345)
Global capacity: 1/3 working

my-project (/home/user/my-project) [1/2 working]
  task_abc123  WORKING  add-user-auth
  task_def456  READY    fix-login-bug
  task_ghi789  DRAFT    refactor-api

other-repo (/home/user/other-repo) [0/1 working]
  task_jkl012  DONE     update-readme
```

### 10. Database Schema

```sql
-- Settings (key-value config)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Defaults
INSERT INTO settings VALUES ('max_concurrent_tasks', '1');
INSERT INTO settings VALUES ('watcher_poll_interval_secs', '30');
INSERT INTO settings VALUES ('queue_poll_interval_secs', '1');
INSERT INTO settings VALUES ('agent_timeout_secs', '1800'); -- 30 minutes

-- Registered repositories
CREATE TABLE repos (
  id TEXT PRIMARY KEY,              -- repo_xxxx
  path TEXT NOT NULL UNIQUE,
  name TEXT,
  remote_origin TEXT,
  max_concurrent_tasks INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Tasks (1:1 with openspec changes)
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,              -- task_xxxx
  repo_id TEXT NOT NULL REFERENCES repos(id),
  change_path TEXT NOT NULL,
  worktree_path TEXT,
  status TEXT NOT NULL,             -- DRAFT, READY, WORKING, BLOCKED, DONE, REMOVED
  ready_at TEXT,                    -- for FIFO ordering
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(repo_id, change_path)
);

-- Workflow executions
CREATE TABLE executions (
  id TEXT PRIMARY KEY,              -- exec_xxxx
  task_id TEXT NOT NULL REFERENCES tasks(id),
  status TEXT NOT NULL,             -- running, completed, failed, aborted
  started_at TEXT NOT NULL,
  completed_at TEXT
);

-- Step-level tracking (agent resume)
CREATE TABLE step_executions (
  id TEXT PRIMARY KEY,              -- step_xxxx
  execution_id TEXT NOT NULL REFERENCES executions(id),
  agent_pid INTEGER,
  session_id TEXT,
  status TEXT NOT NULL,             -- running, success, failure, aborted
  exit_code INTEGER,
  error TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
```

### 11. Configuration Settings

| Key | Default | Description |
|-----|---------|-------------|
| `max_concurrent_tasks` | 1 | Global limit on WORKING tasks |
| `watcher_poll_interval_secs` | 30 | Seconds between reconciliation scans |
| `queue_poll_interval_secs` | 1 | Seconds between queue checks |
| `agent_timeout_secs` | 1800 | Inactivity timeout before killing agent (30m) |

## Risks / Trade-offs

**[Daemon crashes mid-execution]** → On restart, auto-resume WORKING tasks. Reattach if agent alive, respawn if dead. No user intervention required.

**[Agent hangs forever]** → `agent_timeout_secs` setting (default 30m inactivity). Timeout based on time since last output, not total duration. Active agents won't timeout. Daemon kills stale agent, marks task BLOCKED.

**[SQLite corruption]** → Use WAL mode. Daemon handles SIGTERM gracefully (flush + close).

**[Watcher misses events]** → Polling ticker (30s) reconciles state. Idempotent DB ops prevent duplicates.

**[Repo deleted while tasks exist]** → `repo:remove` fails if tasks are WORKING unless `--force` flag is used. With `--force`, aborts all working tasks first. Orphaned tasks shown in status with warning.

**[Race between watcher and ticker]** → Idempotent DB operations. INSERT ON CONFLICT DO NOTHING, UPDATE with status guard. No mutex needed.

### 12. Abort/Force Remove Operations

**Choice:** Graceful abort with SIGTERM → SIGKILL escalation (no automatic worktree cleanup)

```typescript
async function abortTask(taskId: string) {
  const task = await getTask(taskId);
  const step = await getLatestStepExecution(taskId);

  // 1. Kill agent process if running
  if (step?.agent_pid && isProcessAlive(step.agent_pid)) {
    process.kill(step.agent_pid, 'SIGTERM');
    await sleep(3000); // Wait 3s for graceful shutdown
    if (isProcessAlive(step.agent_pid)) {
      process.kill(step.agent_pid, 'SIGKILL');
    }
  }

  // 2. Update statuses
  await updateTaskStatus(taskId, 'REMOVED');
  if (step) {
    await updateStepExecution(step.id, { status: 'aborted' });
  }
  if (step?.execution_id) {
    await updateExecution(step.execution_id, { status: 'aborted' });
  }

  // NOTE: Worktree is NOT automatically removed - user must clean up manually
  // to avoid risk of losing uncommitted work
}
```

**CLI Commands:**

| Command | Behavior |
|---------|----------|
| `aop task:remove <task>` | If WORKING: abort agent. Any status: mark REMOVED. Worktree preserved. |
| `aop task:remove <task> --force` | Skip confirmation prompt for WORKING tasks |
| `aop repo:remove [path] --force` | Abort all WORKING tasks for repo, then remove repo |

**Execution Status Values:** running, completed, failed, **aborted**

**Worktree Handling:** Worktrees are intentionally NOT removed on abort to prevent accidental loss of uncommitted work. Users must manually clean up worktrees via `git worktree remove`.

**Rationale:** Users need ability to clean up stuck or unwanted tasks. Graceful SIGTERM allows agent to save state, SIGKILL ensures termination. Worktrees preserved to protect user's work.
