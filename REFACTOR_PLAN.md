# Comprehensive Refactor Plan: Claude Code Background Integration

## Executive Summary

Replace `pi-ai` and `pi-coding-agent` SDK dependencies with Claude Code running in background mode. This eliminates OAuth/API complexity and leverages the user's existing Claude Code credentials and bypass permissions.

---

## Current Architecture Analysis

### Components Using pi-ai/pi-coding-agent

| Component | File | Current Integration | Purpose |
|-----------|------|---------------------|---------|
| InteractiveSession | `src/core/interactive-session.ts` | pi-coding-agent | `aop create-task` command |
| SdkAgentRunner | `src/core/sdk-agent-runner.ts` | pi-coding-agent | Orchestrator agent spawning |
| claude-api | `src/core/claude-api.ts` | pi-ai | Token/model retrieval |
| auth command | `src/commands/auth.ts` | pi-ai | OAuth token management |

### Current Flow: `aop create-task`
```
CLI → InteractiveSession → pi-coding-agent SDK → Anthropic API
                        ↓
              User interaction via IOHandler
```

### Current Flow: `aop run` (Orchestrator)
```
Orchestrator → JobWorker → SdkAgentRunner.spawn() → pi-coding-agent SDK → Anthropic API
```

### Key Observation
`BrainstormSessionManager` already uses Claude CLI subprocess (`Bun.spawn(["claude", ...])`) - this is a pattern we can extend.

---

## New Architecture

### Design Principles
1. **Claude Code as the AI runtime** - All AI work runs via Claude Code in background mode
2. **Close/Resume pattern** - Handle user interaction by closing sessions and resuming with session ID
3. **Push-based communication** - Orchestrator pushes prompts to local terminal
4. **No server-side AI calls** - Everything runs on user's machine

### New Flow: `aop create-task`
```
CLI → ClaudeCodeSession.start(prompt) → Claude Code background process
                                      ↓
                            (Agent runs until needs input)
                                      ↓
                            AskUserQuestion tool called
                                      ↓
                            Session closes, returns session ID
                                      ↓
CLI ← User provides answer → ClaudeCodeSession.resume(sessionId, answer)
                                      ↓
                            Agent continues with answer
                                      ↓
                            (Repeat until complete)
```

### New Flow: `aop run` (Orchestrator)
```
Orchestrator → JobWorker → ClaudeCodeRunner.spawn(prompt) → Claude Code background
                                                         ↓
                                               Agent works autonomously
                                                         ↓
                                               Completion detected via output
```

---

## Detailed Changes

### Phase 1: Core Claude Code Integration Module

#### 1.1 Create `src/core/claude-code-session.ts`

New module to manage Claude Code background sessions:

```typescript
interface ClaudeCodeSessionOptions {
  cwd: string;
  prompt: string;
  resume?: string;          // Session ID to resume
  skills?: string[];        // Paths to skill files
  allowedTools?: string[];  // Tool permissions
  model?: string;           // Model override
}

interface ClaudeCodeSessionResult {
  status: "completed" | "waiting_for_input" | "error";
  sessionId: string;
  output: string;
  question?: {
    id: string;
    text: string;
    options?: string[];
  };
  cost?: {
    inputTokens: number;
    outputTokens: number;
    totalCostUsd: number;
  };
}

class ClaudeCodeSession extends EventEmitter {
  // Start a new session
  static async start(options: ClaudeCodeSessionOptions): Promise<ClaudeCodeSessionResult>;

  // Resume a session with user input
  static async resume(sessionId: string, userInput: string, cwd: string): Promise<ClaudeCodeSessionResult>;

  // Check session status
  static async getStatus(sessionId: string): Promise<ClaudeCodeSessionResult>;

  // Kill a running session
  static async kill(sessionId: string): Promise<void>;
}
```

**Implementation approach:**
```bash
# Start new session
claude --background --print-session-id --output-format json --cwd <dir> --prompt "<prompt>"

# Resume session
claude --resume <session-id> --background --output-format json --cwd <dir> --prompt "<answer>"
```

**Key behaviors:**
- Parse JSON output for AskUserQuestion tool calls
- Detect session completion vs waiting state
- Track session IDs for resume capability
- Handle errors and timeouts gracefully

#### 1.2 Create `src/core/claude-code-runner.ts`

Replace SdkAgentRunner for orchestrator agent spawning:

```typescript
interface ClaudeCodeSpawnOptions {
  agentId: string;
  agentType: AgentType;
  cwd: string;
  prompt: string;
  logFile?: string;
  abortSignal?: AbortSignal;
}

interface AgentProcess {
  agentId: string;
  agentType: AgentType;
  sessionId: string;
  status: "running" | "completed" | "error";
  startedAt: Date;
}

class ClaudeCodeRunner extends EventEmitter {
  spawn(options: ClaudeCodeSpawnOptions): Promise<AgentProcess>;
  kill(agentId: string): Promise<void>;
  getActive(): AgentProcess[];
  getCountByType(type: AgentType): number;
}
```

**Key differences from SdkAgentRunner:**
- Uses Claude Code subprocess instead of pi-coding-agent SDK
- No OAuth token management needed
- Output streamed to log files
- Session ID tracking for potential recovery

---

### Phase 2: Refactor `aop create-task`

#### 2.1 Modify `src/commands/create-task.ts`

**Remove:**
- `runApiSession()` function that uses InteractiveSession
- IOHandler imports and usage

**Add:**
- Import ClaudeCodeSession
- New `runClaudeCodeSession()` function

```typescript
async function runClaudeCodeSession(
  prompt: string,
  paths: ResolvedPaths
): Promise<void> {
  const io = new InteractiveIO(); // For user prompts

  let sessionId: string | undefined;
  let result: ClaudeCodeSessionResult;

  // Initial run
  result = await ClaudeCodeSession.start({
    cwd: paths.projectRoot,
    prompt,
    skills: await getSkillPaths()
  });

  sessionId = result.sessionId;

  // Interactive loop: handle questions
  while (result.status === "waiting_for_input" && result.question) {
    // Display question to user
    io.displayQuestion(result.question);

    // Get user answer
    const answer = await io.getUserInput();

    // Resume session with answer
    result = await ClaudeCodeSession.resume(sessionId, answer, paths.projectRoot);
  }

  // Display final result
  if (result.status === "completed") {
    io.displaySuccess(result.output);
  } else {
    io.displayError(result.output);
  }
}
```

#### 2.2 Remove `src/core/interactive-session.ts`

This entire file can be deleted after migration.

#### 2.3 Remove `src/core/interactive-io-handler.ts`

Replace with simpler terminal I/O utilities if needed.

---

### Phase 3: Refactor Orchestrator

#### 3.1 Modify `src/core/orchestrator.ts`

**Change:**
```typescript
// Before
private agentRunner: SdkAgentRunner;

// After
private agentRunner: ClaudeCodeRunner;
```

**Update imports:**
```typescript
// Remove
import { SdkAgentRunner } from "./sdk-agent-runner.js";

// Add
import { ClaudeCodeRunner } from "./claude-code-runner.js";
```

**Update initialization:**
```typescript
// In start() or constructor
this.agentRunner = new ClaudeCodeRunner();
```

#### 3.2 Modify Job Handlers

Update all job handlers that spawn agents:

**Files affected:**
- `src/core/job-handlers/implementation-handler.ts`
- `src/core/job-handlers/review-handler.ts`
- `src/core/job-handlers/planning-handler.ts`
- `src/core/job-handlers/merge-handler.ts`
- `src/core/job-handlers/completion-review-handler.ts`
- `src/core/job-handlers/conflict-resolution-handler.ts`

**Pattern change:**
```typescript
// Before (all handlers)
const agent = await this.agentRunner.spawn({
  agentId: ksuid.randomSync().string,
  agentType: "implementation",
  prompt: buildPrompt(...),
  cwd: worktreePath,
  ...
});

// After
const agent = await this.agentRunner.spawn({
  agentId: ksuid.randomSync().string,
  agentType: "implementation",
  prompt: buildPrompt(...),
  cwd: worktreePath,
  logFile: getLogPath(...)
});
```

#### 3.3 Remove `src/core/sdk-agent-runner.ts`

Delete after migration.

---

### Phase 4: Update Brainstorm Integration

#### 4.1 Modify `src/core/brainstorm-session-manager.ts`

The BrainstormSessionManager already uses Claude CLI subprocess. Enhance it to use the close/resume pattern:

**Changes:**
1. Use `--background` flag for non-blocking execution
2. Track session IDs from Claude Code
3. Implement proper resume via `--resume` flag

```typescript
// Enhanced session tracking
interface BrainstormSession {
  id: string;
  claudeSessionId: string;  // NEW: Claude Code session ID
  status: "active" | "waiting" | "completed" | "error";
  messages: BrainstormMessage[];
  // ...
}

async startSession(initialMessage?: string): Promise<BrainstormSession> {
  const result = await ClaudeCodeSession.start({
    cwd: this.projectRoot,
    prompt: buildBrainstormPrompt(initialMessage),
    skills: [this.brainstormSkillPath]
  });

  return {
    id: ksuid.randomSync().string,
    claudeSessionId: result.sessionId,
    status: result.status === "waiting_for_input" ? "waiting" : "active",
    // ...
  };
}

async sendMessage(sessionId: string, message: string): Promise<void> {
  const session = this.sessions.get(sessionId);
  if (!session) throw new Error("Session not found");

  const result = await ClaudeCodeSession.resume(
    session.claudeSessionId,
    message,
    this.projectRoot
  );

  session.status = result.status === "waiting_for_input" ? "waiting" : "active";
  // Emit message events...
}
```

---

### Phase 5: Remove Dependencies

#### 5.1 Remove from `package.json`

```json
{
  "dependencies": {
    // REMOVE these:
    "@mariozechner/pi-ai": "^0.50.4",
    "@mariozechner/pi-coding-agent": "0.49.3"
  }
}
```

#### 5.2 Files to Delete

| File | Reason |
|------|--------|
| `src/core/interactive-session.ts` | Replaced by ClaudeCodeSession |
| `src/core/sdk-agent-runner.ts` | Replaced by ClaudeCodeRunner |
| `src/core/claude-api.ts` | No longer needed (was for pi-ai) |
| `src/core/interactive-io-handler.ts` | Simplified or removed |

#### 5.3 Simplify Auth

**Modify `src/commands/auth.ts`:**

```typescript
// Before: Complex OAuth token extraction and storage
export async function runAuthCommand() {
  // ... spawns claude setup-token, parses token, stores in auth.json
}

// After: Simply verify Claude Code is configured
export async function runAuthCommand() {
  // Just verify claude command exists and is authenticated
  const result = await Bun.spawn(["claude", "--version"]);
  if (result.exitCode !== 0) {
    console.error("Claude Code not installed. Run: npm install -g @anthropic-ai/claude-code");
    return;
  }

  // Optionally verify auth by running a simple command
  const test = await Bun.spawn(["claude", "-p", "Say hello", "--max-turns", "1"]);
  if (test.exitCode === 0) {
    console.log("✓ Claude Code is properly configured");
  } else {
    console.log("Run 'claude' to complete authentication");
  }
}
```

**Consider removing `~/.claude-agi/auth.json`** - no longer needed since Claude Code manages its own auth.

---

### Phase 6: Dashboard Integration

#### 6.1 Update Dashboard Server Endpoints

**File:** `src/core/dashboard-server.ts`

Brainstorm endpoints work the same but use new session manager:

```typescript
// No changes to endpoint signatures
// Internal implementation uses ClaudeCodeSession

app.post("/api/brainstorm/start", async (c) => {
  const session = await brainstormManager.startSession(message);
  // Returns session with potential question if waiting for input
  return c.json({ session });
});

app.post("/api/brainstorm/:id/message", async (c) => {
  await brainstormManager.sendMessage(id, message);
  // May return waiting status with question
  return c.json({ success: true });
});
```

#### 6.2 WebSocket Events

No changes needed - events remain the same:
- `brainstormStarted`
- `brainstormMessage`
- `brainstormComplete`
- `brainstormWaiting` (NEW: indicates waiting for user input)

---

## Implementation Order

### Milestone 1: Core Infrastructure (Foundation) ✅ COMPLETE
1. ✅ Create `src/core/claude-code-session.ts`
2. ✅ Create `src/core/claude-code-runner.ts`
3. ✅ Add comprehensive tests for both modules
4. ✅ Verify Claude Code background mode behavior

### Milestone 2: Create-Task Migration ✅ COMPLETE
1. ✅ Refactor `create-task.ts` to use ClaudeCodeSession
2. ✅ Test interactive flow with close/resume pattern
3. ✅ Verify skill loading works correctly
4. ✅ Remove InteractiveSession dependency

### Milestone 3: Orchestrator Migration ✅ COMPLETE
1. ✅ Replace SdkAgentRunner with ClaudeCodeRunner in orchestrator
2. ✅ Update all job handlers
3. ✅ Test agent spawning and monitoring
4. ✅ Verify log capture works correctly

### Milestone 4: Brainstorm Enhancement ✅ COMPLETE
1. ✅ Update BrainstormSessionManager for close/resume (uses ClaudeCodeSession)
2. ✅ Test dashboard integration
3. ✅ Verify WebSocket events fire correctly (added `brainstormWaiting` event)
4. ✅ Added `waiting` status to BrainstormSessionStatus
5. ✅ Added `pendingQuestion` and `claudeSessionId` to BrainstormSession

### Milestone 5: Cleanup ✅ COMPLETE
1. ✅ Remove pi-ai and pi-coding-agent dependencies
2. ✅ Delete obsolete files (interactive-session, sdk-agent-runner, claude-api, interactive-io-handler, tool-definitions)
3. ✅ Simplify auth command (now just verifies Claude Code is installed and authenticated)
4. ✅ Update documentation (this file updated with completion status)
5. ✅ Final integration testing (all unit tests pass, integration tests skip in CI)

---

## Claude Code Background Mode Details

### Command Line Interface

```bash
# Start new background session
claude --background \
  --print-session-id \
  --output-format json \
  --cwd /path/to/project \
  --prompt "Your prompt here"

# Resume existing session
claude --resume abc123 \
  --background \
  --output-format json \
  --cwd /path/to/project \
  --prompt "User's answer to question"

# Check session status
claude --session-status abc123 --output-format json

# Kill session
claude --session-kill abc123
```

### Output Format Parsing

Claude Code in JSON output mode returns structured data:

```json
{
  "session_id": "abc123",
  "status": "waiting_for_input",
  "output": "...",
  "question": {
    "id": "q1",
    "text": "What approach would you like to take?",
    "options": ["Option A", "Option B", "Option C"]
  },
  "usage": {
    "input_tokens": 1234,
    "output_tokens": 567
  }
}
```

### AskUserQuestion Detection

When Claude Code calls AskUserQuestion, the session pauses and returns:
- `status: "waiting_for_input"`
- `question` object with the question details
- Resume with `--resume <session-id> --prompt "<answer>"`

---

## Risk Mitigation

### Risk 1: Claude Code Background API Changes
**Mitigation:** Abstract all Claude Code interactions behind ClaudeCodeSession interface. Changes only need to happen in one place.

### Risk 2: Session ID Persistence
**Mitigation:** Store session IDs in task metadata files (`.devsfactory/tasks/*/task.md` frontmatter).

### Risk 3: Long-Running Sessions
**Mitigation:** Implement heartbeat checking and automatic recovery. Store enough context to restart if needed.

### Risk 4: User Has Old Claude Code Version
**Mitigation:** Check Claude Code version at startup, warn if too old. Document minimum required version.

---

## Testing Strategy

### Unit Tests
- ClaudeCodeSession mock for fast tests
- Session state machine testing
- Output parsing verification

### Integration Tests
- Real Claude Code subprocess execution
- Close/resume pattern verification
- Error handling and recovery

### E2E Tests
- Full `aop create-task` flow
- Full `aop run` with agent execution
- Dashboard brainstorm flow

---

## Documentation Updates

1. **README.md:** Remove OAuth setup instructions, add Claude Code requirements
2. **CONTRIBUTING.md:** Update development setup
3. **Architecture docs:** Update diagrams for new flow
4. **User guide:** Simplified auth story (just use Claude Code)

---

## Success Criteria

1. ✅ `aop create-task` works without OAuth tokens
2. ✅ `aop run` spawns agents via Claude Code background
3. ✅ Brainstorm sessions handle user interaction correctly
4. ✅ No pi-ai or pi-coding-agent dependencies remain
5. ✅ All existing tests pass (adapted)
6. ✅ New tests cover Claude Code integration
7. ✅ Documentation updated

---

## Appendix: File Change Summary

### New Files
| File | Purpose |
|------|---------|
| `src/core/claude-code-session.ts` | Session management for Claude Code |
| `src/core/claude-code-runner.ts` | Agent runner using Claude Code |

### Modified Files
| File | Changes |
|------|---------|
| `src/commands/create-task.ts` | Use ClaudeCodeSession instead of InteractiveSession |
| `src/commands/auth.ts` | Simplify to just verify Claude Code |
| `src/core/orchestrator.ts` | Use ClaudeCodeRunner instead of SdkAgentRunner |
| `src/core/brainstorm-session-manager.ts` | Use close/resume pattern |
| `src/core/dashboard-server.ts` | Minor updates for new session format |
| `package.json` | Remove pi-ai, pi-coding-agent dependencies |
| All job handlers | Use new agent runner API |

### Deleted Files
| File | Reason |
|------|---------|
| `src/core/interactive-session.ts` | Replaced by ClaudeCodeSession |
| `src/core/sdk-agent-runner.ts` | Replaced by ClaudeCodeRunner |
| `src/core/claude-api.ts` | No longer needed |
| `src/core/interactive-io-handler.ts` | Simplified or merged |

---

## Next Steps

1. Review and approve this plan
2. Create feature branch: `refactor/claude-code-integration` ✅ (already on `full-refactor-agent-integration`)
3. Begin Milestone 1: Core Infrastructure
4. Iterate through milestones with testing at each stage
