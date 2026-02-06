## Context

The `create-task` interactive brainstorming flow exists in `/devsfactory` with custom task models. We need to migrate it to `aop/aop`, splitting responsibilities: Claude session management goes to `packages/llm-provider`, CLI orchestration stays in `apps/cli`. The brainstorming output feeds into the existing `opsx:new` workflow.

## Goals / Non-Goals

**Goals:**
- Move Claude session spawning/streaming to `packages/llm-provider/src/claude-session/`
- Create `apps/cli/src/create-task/` domain with orchestration service, repository, UI
- Add `aop create-task` CLI command
- Persist sessions in CLI database for resume capability
- Hand off brainstorming results to `opsx:new` flow

**Non-Goals:**
- Modifying the `opsx:new` skill itself
- Supporting raw mode (direct stdin inheritance) in initial version
- Web UI for brainstorming (CLI-only)

## Decisions

### 1. Package Split: llm-provider vs cli

**Decision**: Claude session management (spawn, stream, kill/resume) lives in `packages/llm-provider`. CLI-specific code (terminal UI, orchestration, persistence) lives in `apps/cli`.

**Rationale**: Follows existing package boundaries. `llm-provider` already handles LLM interactions. Terminal UI is CLI-specific and shouldn't pollute a shared package.

**Structure**:
```
packages/llm-provider/src/
  claude-session/
    index.ts              # Public exports
    session.ts            # ClaudeCodeSession class
    stream-parser.ts      # JSON stream parsing
    types.ts              # Event types, options

apps/cli/src/
  create-task/
    index.ts              # Public exports
    command.ts            # CLI entrypoint (thin)
    service.ts            # CreateTaskService orchestration
    repository.ts         # Session persistence
    question-enforcer.ts  # One-question validation
    terminal-ui.ts        # Question display, answer collection
```

### 2. ClaudeCodeSession API

**Decision**: Event-emitter pattern with typed events.

```typescript
interface ClaudeSessionEvents {
  message: (content: string) => void;
  toolUse: (tool: string, input: unknown) => void;
  question: (data: AskUserQuestionInput) => void;
  completed: (output: string) => void;
  error: (code: number, signal?: string) => void;
}

class ClaudeCodeSession extends EventEmitter<ClaudeSessionEvents> {
  constructor(options: SessionOptions);
  run(prompt: string): Promise<void>;
  resume(sessionId: string, answer: string): Promise<void>;
  kill(): void;
  get sessionId(): string | null;
  get isRunning(): boolean;
}
```

**Rationale**: Event emitter allows real-time streaming while keeping the API simple. The `question` event triggers kill automatically per spec requirement.

### 3. Stream Parsing

**Decision**: Line-by-line JSON parsing with type discrimination.

```typescript
// Claude outputs newline-delimited JSON
interface StreamEvent {
  type: 'assistant' | 'tool_use' | 'tool_result' | 'system' | 'result';
  // ... type-specific fields
}
```

**Rationale**: Claude's `--output-format stream-json` outputs one JSON object per line. We parse each line, discriminate by `type` field, and emit appropriate events.

### 4. Kill/Resume Pattern

**Decision**: Kill subprocess immediately on `AskUserQuestion` detection. Resume with `--resume <sessionId>` flag.

**Flow**:
```
1. run(prompt) → spawn claude with prompt
2. Stream stdout, detect AskUserQuestion tool_use
3. Emit 'question' event, kill() subprocess
4. Caller collects answer
5. resume(sessionId, answer) → spawn claude --resume <id> "answer"
6. Repeat until completed or error
```

**Rationale**: Claude's session file persists conversation state. Killing preserves this file. Resume with answer works because Claude interprets the prompt as response to pending question.

### 5. Orchestration Service

**Decision**: `CreateTaskService` handles the question loop and handoff.

```typescript
class CreateTaskService {
  constructor(
    private sessionRepo: SessionRepository,
    private claudeSession: ClaudeCodeSession,
    private terminalUI: TerminalUI,
    private questionEnforcer: QuestionEnforcer
  );

  async run(description: string): Promise<CreateTaskResult>;
}
```

**Flow**:
```
1. Create session record (status=active)
2. Build brainstorming prompt with description
3. Loop:
   a. Run/resume Claude session
   b. On question: enforce single question, display via UI, collect answer
   c. On completed: check for [BRAINSTORM_COMPLETE] marker
   d. On error: handle appropriately
4. Extract requirements from completion JSON
5. Invoke opsx:new with gathered context
6. Update session (status=completed, change_path)
```

### 6. Question Enforcement

**Decision**: Reject multi-question calls, auto-resume with error message.

```typescript
interface QuestionEnforcerResult {
  valid: boolean;
  question?: Question;
  errorMessage?: string;
}

class QuestionEnforcer {
  validate(input: AskUserQuestionInput): QuestionEnforcerResult;
  incrementCount(): void;
  isMaxReached(): boolean;
}
```

**Rationale**: Claude sometimes batches questions despite instructions. We reject and retry automatically (max 5 times) rather than failing immediately.

### 7. Terminal UI

**Decision**: Simple readline-based UI with numbered options.

```typescript
class TerminalUI {
  displayQuestion(question: Question, count: number, max: number): void;
  collectAnswer(question: Question): Promise<string>;
  displayToolUse(toolName: string): void;
  displayError(message: string): void;
}
```

**Output format**:
```
Question 2/7: Which authentication method should we use?

  1. JWT tokens (Recommended)
  2. Session cookies
  3. OAuth2
  4. Other

> _
```

### 8. Database Schema

**Decision**: Two new tables with foreign key relationship.

```sql
CREATE TABLE interactive_sessions (
  id TEXT PRIMARY KEY,
  repo_id TEXT REFERENCES repos(id),
  change_path TEXT,
  claude_session_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  question_count INTEGER NOT NULL DEFAULT 0,
  continuation_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE session_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES interactive_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_use_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Rationale**: Follows existing CLI database patterns (Kysely, SQLite, TypeID for IDs). Foreign key with cascade ensures cleanup.

### 9. Handoff to opsx:new

**Decision**: Invoke `opsx:new` skill programmatically with gathered context.

```typescript
// After brainstorming completes
const result = await invokeSKill('opsx:new', {
  name: kebabCase(requirements.title),
  context: formatContext(requirements)
});
```

**Rationale**: Reuses existing skill infrastructure. The `opsx:new` skill handles OpenSpec change creation.

### 10. CLI Command

**Decision**: Thin entrypoint following existing patterns.

```typescript
// commands/create-task.ts
export const createTaskCommand = async (
  ctx: CommandContext,
  description?: string,
  options?: CreateTaskOptions
): Promise<void> => {
  const service = new CreateTaskService(/* deps from ctx */);
  const result = await service.run(description ?? await promptForDescription());

  if (result.success) {
    log.info("Change created: {path}", { path: result.changePath });
  } else {
    handleError(result.error);
  }
};
```

## Risks / Trade-offs

**[Session file location]** → Claude stores sessions in `~/.claude/`. We don't control this path. Mitigation: Store `claude_session_id` and rely on Claude's session management.

**[Kill timing]** → Killing too early might lose output. Mitigation: Kill only after detecting `AskUserQuestion` tool use event.

**[opsx:new integration]** → Skill invocation API may need adjustment. Mitigation: Check existing skill invocation patterns in codebase.

**[Timeout handling]** → Long brainstorming sessions might hit timeout. Mitigation: 5-minute timeout per question round, not total session.
