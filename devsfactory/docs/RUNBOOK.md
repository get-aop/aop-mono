# devsfactory - Runbook:Operations Guide

This guide helps diagnose and resolve issues with devsfactory. Use it when tasks get stuck, agents misbehave, or the system needs manual intervention.

## System Health Checks

### Quick Status

**Check if orchestrator is running:**

```bash
ps aux | grep -E 'bun.*aop|bun.*cli.ts' | grep -v grep
```

**Check running agents:**

```bash
ps aux | grep -E 'claude.*stream-json' | grep -v grep
```

**Check worktree state:**

```bash
git worktree list
```

**Check task/subtask status:**

```bash
# List all tasks and their status
grep -r "^status:" .devsfactory/*/task.md

# List all subtasks for a task
grep -r "^status:" .devsfactory/{task-folder}/*.md
```

### Log Analysis

Logs are streamed to stdout with the configured format (`LOG_MODE=pretty` or `LOG_MODE=json`).

**Enable debug logging:**

```bash
DEBUG=true aop
```

**Filter agent output in logs:**

Agent output is prefixed with the agent type and subtask slug:

```
[14:32:01] implementation:add-auth [agent-2x8k4j] │ Using Read tool...
```

> **Note:** Agent logs are not currently persisted to disk files. See [issue #88](https://github.com/get-aop/aop/issues/88).

---

## Troubleshooting Scenarios

### Stuck Tasks

**Symptoms:** Task stays in INPROGRESS but no progress is made.

**Diagnosis:**

1. Check subtask statuses:

   ```bash
   grep -E "^status:" .devsfactory/{task-folder}/*.md
   ```

2. Check if any subtask is BLOCKED:

   ```bash
   grep -l "status: BLOCKED" .devsfactory/{task-folder}/*.md
   ```

3. Check if agents are running for this task:

   ```bash
   ps aux | grep claude | grep -v grep
   ```

4. Check for dependency cycles in `plan.md` — subtasks waiting on each other.

**Resolution:**

- If subtask is BLOCKED: Read the `Blockers` section in the subtask file, resolve the issue, then reset status to `PENDING` or `INPROGRESS`.
- If no agents running: Restart `aop` — reconciliation will re-evaluate and spawn agents.
- If dependency issue: Edit `plan.md` to fix dependency ordering.

---

### Stuck Subtasks

**Symptoms:** Subtask stays in one state indefinitely.

#### INPROGRESS but no agent running

The agent may have crashed or been killed.

**Resolution:**

1. Check for uncommitted work in the subtask worktree:

   ```bash
   cd .worktrees/{task-folder}--{subtask-slug}
   git status
   git diff
   ```

2. If good progress exists, you can:
   - Commit the changes manually
   - Set status to `AGENT_REVIEW`

3. If no progress or bad state:
   - Reset status to `PENDING` (will recreate worktree)
   - Or keep as `INPROGRESS` and restart `aop` (agent will analyze existing changes)

#### AGENT_REVIEW but no review happening

**Resolution:** Restart `aop` — the reconciler will enqueue a review job.

#### PENDING_MERGE but not merging

**Resolution:** Restart `aop` — the reconciler will enqueue a merge job.

#### MERGE_CONFLICT and conflict-solver failing

See [Manual Merge Conflict Resolution](#manual-merge-conflict-resolution).

---

### Restarting a Subtask (Quality Preservation)

**Problem:** Restarting an INPROGRESS subtask can degrade quality because the agent loses context of previous attempts.

**Best practice:**

1. Check existing work in the worktree before resetting:

   ```bash
   cd .worktrees/{task-folder}--{subtask-slug}
   git diff
   ```

2. If partial progress exists and is valuable:
   - Document findings in the subtask's `Context` section
   - Add notes about what was attempted and what failed
   - Keep uncommitted changes (the agent will analyze them on restart)

3. If starting completely fresh:

   ```bash
   cd .worktrees/{task-folder}--{subtask-slug}
   git checkout .  # Discard all changes
   ```

4. Reset status to `INPROGRESS` (or `PENDING` to recreate worktree).

The implementation agent will analyze uncommitted changes on startup and decide whether to continue, improve, or discard them.

---

### Server Crashes & Recovery

**Symptoms:** `aop` process died, dashboard unreachable.

**What survives restart:**

- All state in `.devsfactory/` markdown files
- Git worktrees and branches
- Committed changes in worktrees

**What's lost:**

- In-memory job queue (rebuilt from file state on startup)
- Retry counters (reset to 0)
- Active agent processes (become orphaned)

**Recovery procedure:**

1. Kill any orphaned agent processes:

   ```bash
   pkill -f 'claude.*stream-json'
   ```

2. Restart the orchestrator:

   ```bash
   aop
   ```

3. The reconciler will:
   - Scan all tasks and subtasks
   - Rebuild the job queue from current statuses
   - Resume work where it left off

**Check for orphaned worktrees:**

```bash
# List all worktrees
git worktree list

# Compare with active subtasks
ls .devsfactory/*/
```

---

### Orphaned Agent Processes

**Symptoms:** Claude processes running but orchestrator doesn't know about them.

**Diagnosis:**

```bash
# Find all claude processes
ps aux | grep -E 'claude.*stream-json' | grep -v grep

# Check process tree (shows parent)
ps -ef | grep claude
```

**Resolution:**

```bash
# Kill all orphaned agents
pkill -f 'claude.*stream-json'

# Or kill specific PID
kill {pid}
```

> **Caution:** Only kill agents if you're sure the orchestrator isn't tracking them. Check that `aop` isn't running first.

---

### Manual Merge Conflict Resolution

**Symptoms:** Subtask stuck in `MERGE_CONFLICT`, conflict-solver agent failed multiple times.

**Understanding the state:**

When a subtask merge fails, Git leaves conflict markers in the **task worktree** (not the subtask worktree). The files look like:

```
<<<<<<< HEAD
// code from task branch
=======
// code from subtask branch
>>>>>>> aop/{task-folder}--{subtask-slug}
```

**Resolution:**

1. Navigate to the task worktree:

   ```bash
   cd .worktrees/{task-folder}
   ```

2. Find conflicted files:

   ```bash
   git status
   # or
   grep -r "<<<<<<" .
   ```

3. Resolve conflicts manually in each file.

4. Stage and commit:

   ```bash
   git add .
   git commit -m "Resolve merge conflict for {subtask-slug}"
   ```

5. Update subtask status to `DONE`:

   ```bash
   # Edit .devsfactory/{task-folder}/{subtask-file}.md
   # Change: status: MERGE_CONFLICT
   # To:     status: DONE
   ```

6. Delete the subtask worktree (now merged):

   ```bash
   git worktree remove .worktrees/{task-folder}--{subtask-slug} --force
   ```

7. The orchestrator will detect the change and continue with remaining subtasks.

---

### Worktree Issues

**Symptoms:** Worktree exists but shouldn't, or missing when expected.

**List all worktrees:**

```bash
git worktree list
```

**Prune stale worktree references:**

```bash
git worktree prune
```

**Remove orphaned worktree:**

```bash
# Safe removal (fails if changes exist)
git worktree remove .worktrees/{worktree-name}

# Force removal
git worktree remove .worktrees/{worktree-name} --force
```

**Recreate missing worktree:**

Reset the subtask status to `PENDING`. The orchestrator will recreate the worktree when it transitions to `INPROGRESS`.

> **Warning:** Only delete a subtask worktree after confirming its changes are merged into the task branch. Check with `git log` in the task worktree.

---

### Queue Problems

**Symptoms:** Jobs not executing, stuck in retry, wrong execution order.

**Diagnosis:**

Enable debug mode to see queue activity:

```bash
DEBUG=true aop
```

Look for log messages like:

- `Enqueuing job: {type} for {task}/{subtask}`
- `Processing job: {type}`
- `Job failed, retrying in {ms}ms`

**Common causes:**

1. **Max concurrency reached:** Check `MAX_CONCURRENT_AGENTS` setting
2. **Job in retry backoff:** Wait for backoff to expire (up to 5 minutes)
3. **Dependencies not met:** Check subtask dependencies in `plan.md`

**Resolution:**

Restarting `aop` clears the queue and rebuilds it from file state. Retry counters reset to 0.

---

## Known Issues & Pitfalls

### Self-Hosting: Working on Dashboard UI

**Problem:** Using devsfactory to implement features on its own dashboard causes chaos.

When an agent modifies dashboard code and tries to validate by restarting the server:

- The orchestrator itself restarts
- In-memory state is lost
- Subtasks may be duplicated or lost
- The agent that triggered the restart is orphaned

**Workaround:**

1. Don't use devsfactory to work on devsfactory's dashboard while running it
2. Or run a separate orchestrator instance pointing to a different `.devsfactory` directory
3. Or develop dashboard features with manual `bun run dev` instead

### Status Value Drift

**Problem:** Agents sometimes write incorrect status values, causing subtasks to get stuck.

| Written (incorrect) | Expected (correct) |
| ------------------- | ------------------ |
| `IN_PROGRESS`       | `INPROGRESS`       |
| `REVIEW`            | `AGENT_REVIEW`     |
| `PENDING MERGE`     | `PENDING_MERGE`    |
| `in_progress`       | `INPROGRESS`       |

**Symptoms:**

- Subtask appears stuck but no agents spawn for it
- `grep "status:" .devsfactory/{task}/*.md` shows unexpected values

**Diagnosis:**

```bash
# Check for common drift patterns
grep -rE "status: (IN_PROGRESS|REVIEW|PENDING MERGE|in_progress)" .devsfactory/
```

**Resolution:**

Manually fix the status value in the frontmatter to use the exact correct value:

- `INPROGRESS` (no underscore)
- `AGENT_REVIEW` (not `REVIEW`)
- `PENDING_MERGE` (underscore, not space)

> See [issue #90](https://github.com/get-aop/aop/issues/90) for planned fix.

---

## Manual Interventions

### Editing Task/Subtask Status

All state is in YAML frontmatter. Edit directly:

```yaml
---
title: My Subtask
status: PENDING # Change this value
# ...
---
```

**Valid subtask statuses:** `PENDING`, `INPROGRESS`, `AGENT_REVIEW`, `PENDING_MERGE`, `MERGE_CONFLICT`, `DONE`, `BLOCKED`

**Valid task statuses:** `DRAFT`, `BACKLOG`, `PENDING`, `INPROGRESS`, `REVIEW`, `DONE`, `BLOCKED`

After editing, the file watcher triggers reconciliation automatically (within 100ms debounce).

### Forcing Task Completion

If a task is stuck but you want to mark it done:

1. Set all subtask statuses to `DONE`
2. Set task status to `REVIEW` (or `DONE` to skip review)
3. Manually create PR if needed:
   ```bash
   cd .worktrees/{task-folder}
   git push -u origin aop/{task-folder}
   gh pr create --title "Task: {title}" --body "..."
   ```

### Cleaning Up a Failed Task

1. Delete worktrees:

   ```bash
   # Task worktree
   git worktree remove .worktrees/{task-folder} --force

   # Subtask worktrees
   git worktree remove .worktrees/{task-folder}--* --force
   ```

2. Delete branches:

   ```bash
   git branch -D aop/{task-folder}
   git branch -D aop/{task-folder}--*
   ```

3. Archive or delete task folder:

   ```bash
   # Archive
   mv .devsfactory/{task-folder} .devsfactory/_archive/

   # Or delete
   rm -rf .devsfactory/{task-folder}
   ```

---

## Configuration Reference

| Variable                | Default        | Description                          |
| ----------------------- | -------------- | ------------------------------------ |
| `DEVSFACTORY_DIR`       | `.devsfactory` | Task definitions directory           |
| `WORKTREES_DIR`         | `.worktrees`   | Git worktrees directory              |
| `MAX_CONCURRENT_AGENTS` | `2`            | Maximum parallel agents              |
| `DASHBOARD_PORT`        | `3001`         | Web dashboard port                   |
| `DEBOUNCE_MS`           | `100`          | File watcher debounce                |
| `RETRY_INITIAL_MS`      | `2000`         | Initial retry delay                  |
| `RETRY_MAX_MS`          | `300000`       | Maximum retry delay (5 min)          |
| `RETRY_MAX_ATTEMPTS`    | `5`            | Max retries before permanent failure |
| `DEBUG`                 | `false`        | Enable debug logging                 |
| `LOG_MODE`              | `pretty`       | Log format: `pretty` or `json`       |

### Retry Backoff

Jobs use exponential backoff: `delay = RETRY_INITIAL_MS * 2^(attempt-1)`, capped at `RETRY_MAX_MS`.

Example with defaults: 2s → 4s → 8s → 16s → 32s → ... → 5min cap

After `RETRY_MAX_ATTEMPTS`, the job fails permanently and is removed from the queue.

---

## Monitoring

### Job Priority

Jobs are processed by priority (highest first):

| Job Type            | Priority | Rationale               |
| ------------------- | -------- | ----------------------- |
| `conflict-solver`   | 40       | Unblock merges          |
| `merge`             | 30       | Complete finished work  |
| `completion-review` | 25       | Finalize tasks          |
| `review`            | 20       | Unblock implementations |
| `completing-task`   | 15       | Aggregate subtasks      |
| `implementation`    | 10       | Start new work          |

**Philosophy:** Finishing work beats starting new work.

### Timing Data

Subtask frontmatter tracks execution phases:

```yaml
timing:
  implementation: 45000 # ms spent implementing
  review: 12000 # ms spent in review
  merge: 3000 # ms spent merging
  conflictSolver: 0 # ms spent resolving conflicts
```

Export timing stats:

```bash
aop stats {task-folder}
```

---

## Branch Naming

> **Note:** The codebase is being refactored from `task/` to `aop/` prefix.

| Branch Type    | Pattern                             |
| -------------- | ----------------------------------- |
| Task branch    | `aop/{task-folder}`                 |
| Subtask branch | `aop/{task-folder}--{subtask-slug}` |

Example:

- Task: `aop/add-user-auth`
- Subtask: `aop/add-user-auth--setup-jwt`
