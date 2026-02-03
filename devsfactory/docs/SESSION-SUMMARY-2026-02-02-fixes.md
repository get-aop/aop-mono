# Session Summary - 2026-02-02

## Fixes Applied

### 1. TypeScript Lint Errors (Committed & Pushed)
- Added `job-scheduler` to `LogCategory` type in `src/infra/logger.ts`
- Fixed `FileSink` stdin handling in `src/core/dashboard-client-server.ts` (use `.write()` directly instead of `.getWriter()`)
- Added type casts for event handlers in `src/core/server-coordinator.ts`
- Removed unused `expect` import in `e2e-tests/orchestrator.e2e.test.ts`

**Commit:** `6a309b6` - "fix: resolve TypeScript lint errors"

### 2. Agent State Sync (Not Committed)
- **File:** `src/agent/agent-client.ts`
- **Issue:** Agent wasn't syncing tasks from `.devsfactory` to SQLite before publishing state
- **Fix:** Added `syncDevsfactoryToSQLite()` call after authentication, before starting the state publisher

### 3. Dashboard Project Listing (Not Committed)
- **File:** `src/core/dashboard-client-server.ts`
- **Issue:** Dashboard client was proxying `/api/projects` to the stateless server, which returned "Project listing not configured"
- **Fix:** Added local `handleListProjects()` handler that reads projects from local registry

---

## Architecture Clarification

### Server (`aop server`)
- Stateless coordinator
- Accepts agent connections via WebSocket at `/api/agents`
- Broadcasts state updates to dashboard clients
- Does NOT know about projects or tasks directly

### Agent (`aop agent`)
- Runs on the machine where the project lives
- Connects to server with `--project-name` and `--devsfactory-dir`
- Syncs tasks from `.devsfactory` → SQLite → publishes to server
- Executes jobs assigned by the server

### Dashboard Client (`aop dashboard`)
- Runs locally on your machine
- Proxies WebSocket/API to the remote server
- Handles local operations like `aop create-task`
- Lists projects from local registry (not from server)

### Typical Setup
```
Terminal 1 (Server):     aop server --secret <secret>
Terminal 2 (Agent):      aop agent --server ws://localhost:3001/api/agents --secret <secret> --project-name <name> --devsfactory-dir .devsfactory
Terminal 3 (Dashboard):  aop dashboard --server http://localhost:3001
Browser:                 http://localhost:3002
```

---

## Still Has Problems / TODO

### 1. Project Selection in Dashboard
- Projects show in dropdown but selecting doesn't load tasks
- May need to verify WebSocket state sync from server to dashboard client

### 2. Agent Status Display
- Dashboard shows "Agent: disconnected" even when agent is connected
- The "Connect" button is for local agents, not remote agents
- Need UI to show remote agent status

### 3. Task Creation via UI
- Endpoint exists (`/api/tasks/create-cli`) but needs project to be registered and selected
- User needs to run `aop init` in project directory to register it

### 4. Port Conflicts
- Server defaults to 3001 but often falls back to 3003/3004 due to OrbStack using 3001
- Consider using a different default port or better port-in-use messaging

### 5. SQLite UNIQUE Constraint (Fixed & Committed)
- **File:** `src/core/sqlite/project-store.ts`
- **Issue:** `ensureProjectRecord` checked for existing project by name only, but DB has UNIQUE constraint on path
- **Fix:** Check both name AND path before inserting
- **Commit:** `c9bd5ee`

### 6. Close/Resume Mechanism - CONFIRMED WORKING
The close/resume pattern for AskUserQuestion works correctly:
- `-p` mode with `stdin: "ignore"` causes AskUserQuestion to be permission denied
- Question is extracted from `permission_denials` in the result
- Session file is modified with user's answer
- Resume with `--resume <session-id>` continues correctly

Example successful flow:
```
[DEBUG] Initial result:
  status: waiting_for_input
  hasQuestion: true
  toolUseId: toolu_01M46ZNMHN7RUsUVsC54gPPo

[DEBUG] Resume loop iteration 1
❓ Claude needs your input
Select (1-3): 2
[DEBUG] User answer: {"answers":{"Status":"No, review first"}}

[DEBUG] Resume result:
  status: completed
```

---

## Commands Reference

```bash
# Kill processes on ports
for port in 3001 3002 3003 3004 3005; do
  lsof -ti :$port | xargs kill -9 2>/dev/null
done

# Start server
aop server --secret "your-secret"

# Start agent (from project directory)
aop agent --server ws://localhost:3001/api/agents --secret "your-secret" \
    --project-name my-project --devsfactory-dir .devsfactory

# Start dashboard
aop dashboard --server http://localhost:3001

# Register a project
cd /path/to/project
aop init

# Create a task (CLI)
aop create-task "task description"
```
