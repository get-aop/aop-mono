# V2 Protocol E2E Tests - Implementation Summary

## Overview

E2E tests for the v2 remote agent protocol. These tests use **real components only** - no mocks.

**Key principle**: E2E tests mirror the real application. Integration tests (in `src/core/remote/v2-protocol.integration.test.ts`) can use mocks.

## Files Created

| File | Purpose | Status |
|------|---------|--------|
| `e2e-tests/v2-protocol.e2e.test.ts` | E2E test file with real components | ✅ Working |
| `e2e-tests/fixtures/v2-protocol-task/task.md` | Test fixture - INPROGRESS task | ✅ Working |
| `e2e-tests/fixtures/v2-protocol-task/plan.md` | Test fixture - APPROVED plan | ✅ Working |
| `e2e-tests/fixtures/v2-protocol-task/001-test-subtask.md` | Test fixture - PENDING subtask | ✅ Working |

## Test Results - 7/7 Pass

All tests use **real components**:
- Real `DashboardServer` with WebSocket
- Real `AgentClient` connecting over WebSocket
- Real `AgentDispatcher` handling protocol
- Real Claude Code CLI execution

| Test | Status | What It Tests |
|------|--------|---------------|
| `v2 agent connects and authenticates with real WebSocket` | ✅ Pass | Real WebSocket connection, auth handshake, v2 capability advertisement |
| `v2 agent receives lightweight job and generates prompt locally` | ✅ Pass | `job:assign:light` dispatch, local prompt generation, job execution |
| `v1 agent receives full prompt (fallback when no v2 config)` | ✅ Pass | Fallback to `job:assign` with full prompt for v1 agents |
| `multiple agents can connect and dispatcher tracks them` | ✅ Pass | Multi-agent support, dispatcher tracking |
| `agent disconnect is handled gracefully` | ✅ Pass | Clean disconnect, event emission, agent count updates |
| `dispatcher events are emitted correctly during job lifecycle` | ✅ Pass | Event flow: jobDispatched → jobOutput → jobCompleted |
| `job with invalid job type fails gracefully` | ✅ Pass | Error handling when prompt generation fails |

## What Works

### ✅ Real WebSocket Connections
- `DashboardServer` starts on random port (`port: 0`)
- `AgentClient` connects via `ws://localhost:{port}/api/agents`
- Full auth handshake (challenge → response → success)

### ✅ V2 Protocol Flow
- Agent advertises `hasLocalStorage: true` and `protocolVersion: "2"`
- Dispatcher sends `job:assign:light` (no prompt in message)
- Client generates prompt locally using `ClientPromptGenerator`
- Job executes with local Claude Code CLI

### ✅ V1 Fallback
- Agent without `projectName`/`devsfactoryDir` gets `protocolVersion: "1"`
- Dispatcher sends `job:assign` with full prompt
- Fallback works transparently

### ✅ Error Handling
- Invalid job type → prompt generation fails → `jobFailed` event
- Agent disconnect → job fails with "disconnected" error
- All errors propagate through the real event system

## CI vs Local

| Environment | Behavior |
|-------------|----------|
| **CI** (`process.env.CI` set) | All E2E tests **skipped** - Claude Code not available |
| **Local** | All E2E tests **run** - uses local Claude Code CLI |

```bash
# Local (runs all tests)
bun test ./e2e-tests/v2-protocol.e2e.test.ts

# CI simulation (skips E2E)
CI=true bun test ./e2e-tests/v2-protocol.e2e.test.ts
```

## Test Architecture

### No Mocks
The E2E tests do NOT mock:
- ❌ No mock WebSocket
- ❌ No mock AgentClient
- ❌ No mock AgentDispatcher
- ❌ No mock Claude Code

### Real Components Used
```
┌─────────────────────────────────────────────────────────────────┐
│                         E2E Test                                │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    WebSocket    ┌──────────────────────────┐ │
│  │ AgentClient  │◄───────────────►│ DashboardServer          │ │
│  │              │                 │  └─ AgentDispatcher      │ │
│  │ - Connects   │                 │     └─ RemoteAgentRegistry│ │
│  │ - Auths      │                 │                          │ │
│  │ - Runs jobs  │                 │                          │ │
│  └──────────────┘                 └──────────────────────────┘ │
│         │                                                       │
│         ▼                                                       │
│  ┌──────────────┐                                               │
│  │ Claude Code  │ ◄─── Real CLI process                        │
│  │ CLI          │                                               │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
```

### Test Isolation
- Each test gets fresh `tempDir`, `dbPath`, `db`, `devsfactoryDir`
- Server uses `port: 0` (OS assigns available port)
- `afterEach` cleans up all resources

## Running

```bash
# Run all E2E tests (local only, ~3-4 min)
bun test ./e2e-tests/v2-protocol.e2e.test.ts

# Run specific test
bun test ./e2e-tests/v2-protocol.e2e.test.ts -t "v2 agent connects"

# Verbose output
DEBUG=true bun test ./e2e-tests/v2-protocol.e2e.test.ts
```

## Test Output Example

```
 7 pass
 0 fail
 40 expect() calls
Ran 7 tests across 1 file. [210.09s]
```

## Related Files

| File | Role |
|------|------|
| `src/core/dashboard-server.ts` | WebSocket server |
| `src/core/remote/agent-dispatcher.ts` | v2 dispatch logic |
| `src/agent/agent-client.ts` | Client-side v2 handling |
| `src/agent/client-prompts.ts` | Local prompt generation |
| `src/core/remote/v2-protocol.integration.test.ts` | Integration tests (can use mocks) |
