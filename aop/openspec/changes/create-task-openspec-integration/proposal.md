## Why

The `create-task` interactive brainstorming flow currently lives in `/devsfactory` (legacy codebase), using custom task models (`task.md`, `plan.md`, subtask files) that are incompatible with OpenSpec. This creates maintenance burden and prevents users from leveraging the established `opsx:*` workflow for task execution.

By migrating `create-task` to `aop/aop` and integrating it as a brainstorming frontend to `opsx:new`, we unify the task creation and execution experience while eliminating duplicate code paths.

## What Changes

- **NEW**: Add Claude session management (spawn, stream, kill/resume) to `packages/llm-provider`
- **NEW**: Add `create-task` domain in `apps/cli/` with interactive brainstorming orchestration
- **NEW**: Add `interactive_sessions` and `session_messages` tables to CLI database for session persistence
- **NEW**: Add `aop create-task` CLI command that runs brainstorming then invokes `opsx:new`
- **BREAKING**: Deprecate `/devsfactory` create-task flow (migration path: use `aop create-task`)

## Capabilities

### New Capabilities

- `claude-session`: Session management for Claude Code interactions in `packages/llm-provider`. Handles subprocess spawning with `--output-format stream-json`, stream parsing for tool use detection (especially `AskUserQuestion`), kill/resume pattern for interactive Q&A, and session lifecycle management.

- `create-task-cli`: Interactive task creation domain in `apps/cli/src/create-task/`. Includes orchestration service (question loop, continuation handling), session repository (SQLite persistence), question enforcer (one-question-at-a-time validation), terminal UI (display questions, collect answers), and thin CLI command entrypoint.

### Modified Capabilities

- `cli-database`: Extended with `interactive_sessions` and `session_messages` tables for persisting brainstorming session state across CLI restarts.

## Impact

- **Code**: New `packages/llm-provider/src/claude-session/` module with session management
- **Code**: New `apps/cli/src/create-task/` domain slice following existing patterns
- **Code**: Extended `apps/cli/src/db/schema.ts` with session tables
- **Code**: New CLI command registered in `apps/cli/src/commands/`
- **Dependencies**: None new - uses existing `@aop/infra` logging, Kysely ORM
- **User experience**: `aop create-task "idea"` starts interactive brainstorming, then seamlessly creates OpenSpec change via `opsx:new` flow
- **Migration**: Users of `/devsfactory` create-task should switch to `aop create-task`
