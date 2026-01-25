---
title: File Watcher and Orchestrator
status: BACKLOG
created: 2026-01-25T00:00:00Z
priority: high
tags: [core, orchestration, watcher]
assignee: null
dependencies:
  [20260125180910-document-parsers, 20260125180911-git-and-agent-runner]
---

## Description

Implement the reactive loop that monitors `.devsfactory/` for state changes and spawns agents accordingly. This is the "brain" of the system that ties parsers, git, and agent runner together to automate the development workflow.

## Requirements

### File Watcher (`src/core/watcher.ts`)

- Create `DevsfactoryWatcher` class extending EventEmitter
- Events to emit:
  - `taskChanged`: when any task.md file changes (payload: taskFolder)
  - `planChanged`: when any plan.md file changes (payload: taskFolder)
  - `subtaskChanged`: when any subtask file changes (payload: taskFolder, filename)
- Implement `start(devsfactoryPath: string): void`
  - Use `fs.watch()` with `{ recursive: true }` option
  - Parse file paths to determine event type
  - Debounce rapid changes (100ms) to avoid duplicate events
  - Emit appropriate events based on file type
- Implement `stop(): void`
  - Close the watcher
  - Clear any pending debounce timers
- Implement `scan(): Promise<{ tasks: Task[]; plans: Map<string, Plan>; subtasks: Map<string, Subtask[]> }>`
  - Use parsers to read all current state
  - Return structured state object
  - Used for initial state load

### Orchestrator (`src/core/orchestrator.ts`)

- Create `Orchestrator` class
- Constructor accepts `Config` object
- Contains instances of:
  - `DevsfactoryWatcher`
  - `AgentRunner`
- Implement `start(): Promise<void>`
  - Ensure `.devsfactory/` directory exists
  - Perform initial state scan
  - Start file watcher
  - Call `processState()` for initial agent spawning
  - Subscribe to watcher events to trigger `processState()`
- Implement `stop(): Promise<void>`
  - Stop file watcher
  - Kill all running agents
  - Clean up resources
- Implement private `processState(): Promise<void>`
  - This is the main decision loop, implementing the logic from DESIGN.md:
  1. **Find PENDING tasks** with satisfied dependencies
     - For each: create task worktree, spawn planning agent, set task to INPROGRESS
  2. **Find INPROGRESS plans** with ready subtasks (PENDING, deps satisfied)
     - For each ready subtask (up to maxConcurrentAgents): create subtask worktree, spawn implementation agent, set subtask to INPROGRESS
  3. **Find subtasks in AGENT_REVIEW**
     - For each: spawn review agent
  4. **Find completed plans** (all subtasks DONE)
     - Set plan status to REVIEW, set task status to REVIEW
  - Respect `config.maxConcurrentAgents` limit
- Implement `onTaskChanged(taskFolder: string): Promise<void>`
  - Re-read task state
  - Trigger `processState()`
- Implement `onSubtaskCompleted(taskFolder: string, subtaskFile: string): Promise<void>`
  - Parse subtask to get slug
  - Merge subtask worktree into task branch
  - Delete subtask worktree
  - Check if all subtasks are DONE, update plan/task status
- Implement `getState(): OrchestratorState`
  - Return current state for TUI consumption:
    - `tasks: Task[]`
    - `plans: Map<string, Plan>`
    - `subtasks: Map<string, Subtask[]>`
    - `activeAgents: AgentProcess[]`
- Subscribe to AgentRunner events:
  - On `completed`: check subtask status, update state, trigger `processState()`
  - On `error`: log error, potentially set subtask to BLOCKED

### Tests

- `src/core/watcher.test.ts`:
  - Test start/stop lifecycle
  - Test taskChanged event on task.md modification
  - Test planChanged event on plan.md modification
  - Test subtaskChanged event on subtask file modification
  - Test debouncing of rapid changes
  - Test scan returns correct state structure
- `src/core/orchestrator.test.ts`:
  - Test start initializes state correctly
  - Test PENDING task triggers planning agent
  - Test ready subtask triggers implementation agent
  - Test AGENT_REVIEW subtask triggers review agent
  - Test maxConcurrentAgents limit is respected
  - Test subtask completion triggers merge and cleanup
  - Test all subtasks DONE sets task to REVIEW
  - Use mocked AgentRunner for tests

## Acceptance Criteria

- [ ] Watcher correctly detects changes to task.md, plan.md, and subtask files
- [ ] Watcher debounces rapid file changes
- [ ] Orchestrator spawns planning agent when task goes PENDING
- [ ] Orchestrator creates task worktree before spawning planning agent
- [ ] Orchestrator spawns implementation agents for ready subtasks
- [ ] Orchestrator respects maxConcurrentAgents configuration
- [ ] Orchestrator spawns review agent for AGENT_REVIEW subtasks
- [ ] Subtask completion triggers merge and worktree cleanup
- [ ] Task marked REVIEW when all subtasks complete
- [ ] `getState()` returns complete current state for TUI
- [ ] All tests pass: `bun test src/core/`
- [ ] No TypeScript errors

## Notes

- The orchestrator is stateless - all state lives in markdown files
- Use dependency injection for testability (AgentRunner can be mocked)
- File watcher should not trigger on `.devsfactory/.git/` changes
- Consider using a state machine pattern for clarity
