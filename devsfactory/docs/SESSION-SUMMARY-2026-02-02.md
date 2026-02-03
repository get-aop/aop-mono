# Session Summary - 2026-02-02

## Overview

This session focused on cleaning up the architecture naming and documentation for the AOP (Agent Orchestration Platform) distributed system.

---

## Update: Stateless Server Implemented

Since this summary was created, the server has been refactored to be truly stateless/lightweight:

- Server-side SQLite usage removed from the `aop server` path
- New in-memory state store + coordinator that derives state from agent snapshots/deltas
- Protocol updated to v1.1.0 with `state:request`, `state:snapshot`, and `state:delta`
- Agent now publishes state snapshots/deltas from local storage
- Server CLI now requires a secret (remote agents are the only mode)

---

## Changes Made

### 1. Renamed DashboardServer → AopServer

The main server component was incorrectly named "DashboardServer" when it's actually the core AOP server that handles orchestration, agent connections, and API endpoints.

**Files renamed:**
- `src/core/dashboard-server.ts` → `src/core/aop-server.ts`
- `src/core/dashboard-server.test.ts` → `src/core/aop-server.test.ts`

**Classes/interfaces renamed:**
- `DashboardServer` → `AopServer`
- `DashboardServerOptions` → `AopServerOptions`

**Files updated with new imports:**
- `src/core/index.ts`
- `src/commands/server.ts`
- `src/cli.ts`
- `scripts/test-remote-agent.ts`

### 2. Consolidated Type Definitions

Moved shared interfaces to `src/types/index.ts`:
- `ProjectScanResult`
- `OrchestratorLike`
- `DraftStorageLike`
- `BrainstormManagerLike`

`aop-server.ts` now imports and re-exports these for backward compatibility.

### 3. Fixed README Architecture Diagram

**Before (incorrect):**
- Showed "Claude Code Agents" inside the server box
- Showed SQLite DB on server side

**After (correct):**
- Server is lightweight (orchestrator + WebSocket endpoints only)
- Agents run on user machines with local Claude Code execution
- SQLite DB is on agent machines, not server
- Clear separation between server (coordination) and agents (execution)

### 4. Updated Storage Documentation

Clarified that `~/.aop/aop.db` is agent-side storage, not server-side:
- Agents read task data locally
- Server only sends lightweight job references
- No server round-trips for task data

---

## What Works ✅

1. **All tests pass** - 1229 tests across 67 files
2. **TypeScript compiles cleanly** - No type errors
3. **CLI commands functional:**
   - `aop server` - Starts the AopServer
   - `aop dashboard` - Starts dashboard client
   - `aop agent` - Connects as remote agent
4. **Naming is now correct:**
   - `AopServer` - Main server (orchestrator + API)
   - `DashboardClientServer` - Local UI proxy (serves dashboard to browser)

---

## What Needs Attention ⚠️

### Architecture Mismatch: Code vs Documentation

The README now describes the **intended** distributed architecture:
- Server (cloud): Lightweight, no database, just coordination
- Agents (user machines): Local SQLite + codebase + Claude Code

**Resolved:** The server no longer uses SQLite or local task storage. State is derived from agent snapshots/deltas in memory.

### Potential Refactoring Needed

To achieve the lightweight server architecture:

1. **Server should only track:**
   - Connected agents and their capabilities
   - Job assignments (which agent is working on what)
   - Status updates (received from agents)
   - In-memory or Redis-based state (not SQLite)

2. **Agents should:**
   - Have full task data in local SQLite
   - Generate prompts locally (already implemented via `ClientPromptGenerator`)
   - Send status updates to server
   - Stream output back to server

3. **Protocol changes needed:**
   - Server broadcasts state from agent status updates, not from local SQLite
   - Task creation could go through agents (they write to local SQLite)
   - Server becomes a pure message broker/coordinator

---

## File Changes Summary

| File | Change |
|------|--------|
| `src/core/dashboard-server.ts` | Renamed to `aop-server.ts`, class renamed to `AopServer` |
| `src/core/dashboard-server.test.ts` | Renamed to `aop-server.test.ts`, updated references |
| `src/core/index.ts` | Updated export from `aop-server` |
| `src/commands/server.ts` | Updated import to use `AopServer` |
| `src/cli.ts` | Restored `server` command |
| `src/types/index.ts` | Added shared interfaces |
| `scripts/test-remote-agent.ts` | Updated imports, fixed `AgentClient` config |
| `README.md` | Fixed architecture diagram, updated storage docs |

---

## Commands Reference

```bash
# Start AOP server (runs orchestrator + API)
aop server --secret <your-secret>

# Start dashboard (local UI, connects to server)
aop dashboard --server http://<server-ip>:3001

# Start agent (connects to server, executes Claude Code locally)
aop agent --server ws://<server-ip>:3001/api/agents --secret <your-secret>
```

---

## Next Steps (if pursuing lightweight server)

Completed as of the stateless server update described above.

---

## Test Results

```
1229 pass
0 fail
2621 expect() calls
Ran 1229 tests across 67 files. [87.63s]
```

All existing functionality preserved after renaming.
