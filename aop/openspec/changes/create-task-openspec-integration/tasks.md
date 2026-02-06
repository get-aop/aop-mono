## 1. Claude Session Package Setup

- [x] 1.1 Create `packages/llm-provider/src/claude-session/` directory structure
- [x] 1.2 Create `types.ts` with SessionOptions, ClaudeSessionEvents, StreamEvent interfaces
- [x] 1.3 Create `index.ts` with public exports

## 2. Stream Parser

- [x] 2.1 Create `stream-parser.ts` with line-by-line JSON parsing
- [x] 2.2 Implement type discrimination for stream events (assistant, tool_use, tool_result, system, result)
- [x] 2.3 Handle malformed JSON gracefully (log warning, continue)
- [x] 2.4 Add unit tests for stream parsing with various event types

## 3. ClaudeCodeSession Class

- [x] 3.1 Create `session.ts` with ClaudeCodeSession class extending EventEmitter
- [x] 3.2 Implement `run(prompt)` - spawn claude with `--output-format stream-json --print`
- [x] 3.3 Implement `resume(sessionId, answer)` - spawn with `--resume` flag
- [x] 3.4 Implement `kill()` - terminate subprocess, preserve session
- [x] 3.5 Implement stream reading with event emission (message, toolUse, question, completed, error)
- [x] 3.6 Auto-kill on AskUserQuestion detection
- [x] 3.7 Add unit tests for session lifecycle (spawn, kill, resume)

## 4. CLI Database Schema

- [x] 4.1 Add `interactive_sessions` table to `apps/cli/src/db/schema.ts`
- [x] 4.2 Add `session_messages` table with foreign key to interactive_sessions
- [x] 4.3 Update migration to create new tables on database init
- [x] 4.4 Add TypeID prefixes for session and message IDs

## 5. Session Repository

- [x] 5.1 Create `apps/cli/src/create-task/repository.ts`
- [x] 5.2 Implement `create(session)` - insert new session record
- [x] 5.3 Implement `get(id)` - fetch session by ID
- [x] 5.4 Implement `update(id, updates)` - update session fields
- [x] 5.5 Implement `getActive()` - find sessions with status active/brainstorming
- [x] 5.6 Implement `addMessage(sessionId, message)` - insert message record
- [x] 5.7 Implement `getMessages(sessionId)` - fetch messages ordered by created_at
- [x] 5.8 Add integration tests with real database

## 6. Question Enforcer

- [x] 6.1 Create `apps/cli/src/create-task/question-enforcer.ts`
- [x] 6.2 Implement `validate(input)` - check questions.length === 1
- [x] 6.3 Implement retry tracking (max 5 multi-question violations)
- [x] 6.4 Implement question count tracking (max 7 questions)
- [x] 6.5 Add unit tests for validation logic

## 7. Terminal UI

- [x] 7.1 Create `apps/cli/src/create-task/terminal-ui.ts`
- [x] 7.2 Implement `displayQuestion(question, count, max)` - show formatted question with options
- [x] 7.3 Implement `collectAnswer(question)` - readline input for single/multi-select and free text
- [x] 7.4 Implement `displayToolUse(toolName)` - show tool indicator
- [x] 7.5 Implement `displayError(message)` - show error message
- [x] 7.6 Add unit tests for display formatting

## 8. Create Task Service

- [x] 8.1 Create `apps/cli/src/create-task/service.ts`
- [x] 8.2 Implement constructor with dependency injection (sessionRepo, claudeSession, terminalUI, questionEnforcer)
- [x] 8.3 Implement `run(description)` - main orchestration method
- [x] 8.4 Implement question loop (run/resume, enforce, display, collect, repeat)
- [x] 8.5 Implement brainstorming completion detection (`[BRAINSTORM_COMPLETE]` marker)
- [x] 8.6 Implement continuation logic for incomplete sessions (max 3 retries)
- [x] 8.7 Implement handoff to opsx:new with gathered requirements
- [x] 8.8 Implement error handling (crash, cancellation, timeout)
- [x] 8.9 Add integration tests for full orchestration flow

## 9. CLI Command

- [x] 9.1 Create `apps/cli/src/create-task/command.ts` - thin entrypoint
- [x] 9.2 Parse arguments: description (positional), --debug, --raw flags
- [x] 9.3 Wire up dependencies and call CreateTaskService
- [x] 9.4 Register command in `apps/cli/src/main.ts`
- [x] 9.5 Add to help output in `apps/cli/src/commands/help.ts`

## 10. Public Exports

- [x] 10.1 Create `apps/cli/src/create-task/index.ts` with public exports
- [x] 10.2 Export ClaudeCodeSession from `packages/llm-provider/src/index.ts`

## 11. Unit and Integration Tests

- [x] 11.1 Add unit tests for ClaudeCodeSession event emission
- [x] 11.2 Add unit tests for stream parser edge cases
- [x] 11.3 Add integration tests for session repository with real SQLite
- [x] 11.4 Add integration tests for CreateTaskService with mocked Claude session

## 12. E2E Tests

**CRITICAL: Do NOT mark tasks complete until E2E tests pass. E2E tests MUST use real Claude session, real brainstorming flow, real opsx:new invocation. These are real-world use cases - NEVER use mocks for E2E. The entire flow must work end-to-end.**

- [x] 12.1 Add E2E test for `aop create-task` with interactive brainstorming
- [x] 12.2 Verify session persistence across CLI restarts
- [x] 12.3 Verify handoff to opsx:new creates valid OpenSpec change folder
- [x] 12.4 Verify entire E2E test suite passes with real Claude session - NO MOCKS. Do not check this until verified working.
