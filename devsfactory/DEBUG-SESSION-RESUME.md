# Debug: AOP Create-Task Session Resume

## Problem
`aop create-task` interactive questions not working. Claude asks questions but session completes instead of pausing for user input.

## Root Cause Found
In `-p` mode with `stdin: "ignore"`, `AskUserQuestion` tool is **permission denied** by Claude CLI. Error `tool_result` written automatically.

## Fix Applied ✅ WORKING

### Implementation:
1. Parse `permission_denials` from stream output → `claude-code-session.ts:613-641`
2. Detect AskUserQuestion denial, set `pendingQuestion` → `claude-code-session.ts:694-727`
3. Write correct `tool_result` to session JSONL on resume → `claude-code-session.ts:29-110`
4. Added `toolResult` option to session options → `claude-code-session.ts:115-121`

### How it works:
1. Initial session runs with `-p` mode (stdin: ignore)
2. When Claude uses AskUserQuestion, it's permission denied
3. Claude CLI writes an error `tool_result` and Claude continues (often with a fallback message)
4. The `result` event includes `permission_denials` array with the denied tool info
5. We extract the question from the denial and set `pendingQuestion`
6. Session returns `status: "waiting_for_input"` with `question` object
7. On resume, we write our `tool_result` (with user's answer) to the session JSONL
8. Claude processes the answer and continues

## Verification (2026-02-01)

### Test 1: Simple question
```bash
bun scripts/debug-session.ts
# Result: ✅ Session pauses, question extracted, resume works
```

### Test 2: Real create-task flow
```bash
bun run ./src/cli.ts create-task "test feature" -p soulfcompany-catalog-service --debug
# Result: ✅ Multiple questions work, resume loop iterates correctly
```

Output shows:
- `status: waiting_for_input` ✓
- `hasQuestion: true` ✓
- Question prompt displayed to user ✓
- User selection captured ✓
- Resume with toolResult succeeds ✓
- Multiple question/answer rounds work ✓

## Key Files
- `/Users/marcelorm/workspace/aop/devsfactory/src/core/claude-code-session.ts`
- `/Users/marcelorm/workspace/aop/devsfactory/src/commands/create-task.ts`
- `~/.claude/skills/brainstorming/SKILL.md` (uses AskUserQuestion)

## GitHub Issue Reference
https://github.com/anthropics/claude-code/issues/16712

## Debug instrumentation added
- `create-task.ts:339-355`: Logs initial result status, session ID, question info
- `create-task.ts:359-367`: Logs resume loop iteration, user answer, resume result
- `claude-code-session.ts:763-768`: Logs buildResult decision factors
