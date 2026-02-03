# V2 Protocol Migration - Session Summary

## Overview

This document summarizes the implementation of the **Lightweight Server Coordinator Migration** - migrating devsfactory from a server-centric to client-centric architecture.

### Architecture Change

```
BEFORE (v1):
Server generates prompts → Sends full prompt to client → Client executes

AFTER (v2):
Server sends task reference → Client reads from local SQLite → Client generates prompt locally
```

## What Was Implemented

### 1. Protocol Changes (`src/core/remote/protocol.ts`)

**New Message Types:**
- `job:assign:light` - Lightweight job assignment (server → agent)
- `status:update` - Status updates (agent → server)

**New Capability Fields in `AgentCapabilities`:**
```typescript
interface AgentCapabilities {
  // existing...
  hasLocalStorage?: boolean;      // Client has access to ~/.aop/aop.db
  protocolVersion?: "1" | "2";    // Protocol version supported
}
```

**New Schema: `JobAssignLightMessageSchema`:**
```typescript
{
  type: "job:assign:light",
  version: 2,
  jobId: string,
  job: { type, taskFolder, subtaskFile?, priority? },
  paths: { devsfactoryDir, worktreeCwd },
  model?, timeout?, systemPrompt?
}
```

### 2. Client Storage (`src/agent/client-storage.ts`) - NEW FILE

Provides read-only access to the shared SQLite database at `~/.aop/aop.db`.

**Key Methods:**
- `getTask(taskFolder)` - Get task by folder
- `getSubtask(taskFolder, filename)` - Get subtask
- `getPlan(taskFolder)` - Get plan
- `listSubtasks(taskFolder)` - List all subtasks in order
- `getReadySubtasks(taskFolder)` - Find subtasks with satisfied dependencies

### 3. Client Prompt Generator (`src/agent/client-prompts.ts`) - NEW FILE

Generates prompts locally using the existing template system.

**Supported Job Types:**
- `implementation` - Uses `{{subtaskPath}}`, `{{taskDir}}`
- `review` - Uses `{{subtaskPath}}`, `{{reviewPath}}`
- `planning` - Uses `{{taskPath}}`
- `completing-task` - Uses `{{taskFolder}}`, `{{devsfactoryDir}}`
- `completion-review` - Uses `{{taskFolder}}`, `{{devsfactoryDir}}`
- `conflict-solver` - Uses `{{taskFolder}}`, `{{subtaskFile}}`

### 4. Agent Config Updates (`src/agent/agent-config.ts`)

**New Config Options:**
```typescript
{
  projectName?: string;      // Enables local storage
  devsfactoryDir?: string;   // For prompt generation
}
```

**New Environment Variables:**
- `AOP_PROJECT_NAME`
- `AOP_DEVSFACTORY_DIR`

**New CLI Arguments:**
- `--project-name <name>`
- `--devsfactory-dir <path>`

### 5. AgentClient Updates (`src/agent/agent-client.ts`)

- Initializes `ClientStorage` and `ClientPromptGenerator` when `projectName` and `devsfactoryDir` are configured
- Reports v2 capabilities in `auth:hello` message
- Handles `job:assign:light` messages by generating prompts locally
- New method: `hasLocalStorage()` - Returns true if v2 is enabled

### 6. AgentDispatcher Updates (`src/core/remote/agent-dispatcher.ts`)

- Stores agent capabilities from `auth:hello` during registration
- Detects v2-capable agents and sends lightweight messages
- Falls back to v1 for legacy agents or when `devsfactoryDir` not provided
- Handles `status:update` messages and emits `statusUpdate` events

### 7. RemoteAgentRegistry Updates (`src/core/remote/remote-agent-registry.ts`)

- Extended `AgentWebSocketData` to include `capabilities` field

## Files Modified

| File | Changes |
|------|---------|
| `src/core/remote/protocol.ts` | Added v2 schemas, status:update message, capability fields |
| `src/agent/agent-client.ts` | Added storage, prompt generator, v2 message handling |
| `src/agent/agent-config.ts` | Added projectName, devsfactoryDir options |
| `src/core/remote/agent-dispatcher.ts` | Capability detection, v2 dispatch, status:update handling |
| `src/core/remote/remote-agent-registry.ts` | Added capabilities to WebSocketData |

## Files Created

| File | Purpose |
|------|---------|
| `src/agent/client-storage.ts` | Read from ~/.aop/aop.db |
| `src/agent/client-prompts.ts` | Generate prompts from templates |
| `src/agent/client-storage.test.ts` | Unit tests for ClientStorage |
| `src/agent/client-prompts.test.ts` | Unit tests for ClientPromptGenerator |
| `src/core/remote/v2-protocol.integration.test.ts` | E2E integration tests |

## Tests Added

### Unit Tests
- Protocol tests for `job:assign:light`, `status:update`, v2 capabilities
- `ClientStorage` tests for all read operations
- `ClientPromptGenerator` tests for all job types

### Integration Tests (`v2-protocol.integration.test.ts`)
- Capability negotiation
- Lightweight job dispatch to v2 agents
- Legacy v1 dispatch to non-v2 agents
- Fallback behavior when devsfactoryDir missing
- Status update handling
- Client storage SQLite operations
- Client prompt generation
- End-to-end v2 protocol lifecycle

## Backwards Compatibility

The implementation is fully backwards compatible:

1. **Protocol version in capabilities handshake** - Agents report their version
2. **Server detects client version** - Sends appropriate message format
3. **Legacy clients continue working** - Receive full prompts (v1)
4. **New clients receive lightweight messages** - Only when configured for v2

## How to Use V2 Protocol

### Starting a V2-Capable Agent

```bash
bun run src/agent/cli.ts \
  --server ws://localhost:3001 \
  --project-name myproject \
  --devsfactory-dir /path/to/project/.devsfactory
```

Or via environment variables:
```bash
export AOP_PROJECT_NAME=myproject
export AOP_DEVSFACTORY_DIR=/path/to/project/.devsfactory
bun run src/agent/cli.ts --server ws://localhost:3001
```

### Server-Side Dispatch

When dispatching jobs, include `devsfactoryDir` to enable v2:

```typescript
dispatcher.dispatch(
  job,
  prompt,  // Still required for v1 fallback
  cwd,
  { devsfactoryDir: "/path/to/.devsfactory" }
);
```

## Verification

All checks pass:
- **1232 tests pass** (67 files)
- **Lint passes** (162 files)
- **TypeScript compiles** with no errors

## Next Steps (Future Work)

1. **Phase A**: Deploy client changes, continue receiving v1 messages
2. **Phase B**: Deploy server changes, start sending v2 to capable clients
3. **Phase C**: Monitor, then optionally deprecate v1
4. Consider adding status:update emissions from client during job execution
5. Add metrics/logging to track v1 vs v2 usage

## Branch

All changes are on branch: `full-refactor-agent-integration`
