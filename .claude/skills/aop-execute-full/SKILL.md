---
name: aop:execute-full
description: Execute a complete implementation and review cycle for an OpenSpec change. State machine that implements tasks, then reviews. Use when user wants to fully implement and review a change. Triggers on /aop:execute-full, "execute full change", "implement and review".
---

# AOP Execute Full

State machine for complete implementation and review cycle.

## Arguments

```
/aop:execute-full {{change}}
```

`change` is optional. If omitted, use the current/active change.

## Workflow

Check the current state and perform ONE action per invocation.

### 1. Check Implementation Status

Read `openspec/changes/{{change}}/tasks.md`.

**If any tasks are incomplete (marked `[ ]`):**
- Invoke `/aop:implement {{change}}`
- After it completes, respond: `<aop>WIP</aop>`

**If all tasks are complete (marked `[x]`):**
- Run: `bun run check`
- If checks fail, uncheck relevant tasks or add new tasks to address and then respond: `<aop>WIP</aop>`
- If checks pass, proceed to step 2

### 2. Check Review Status

Read `openspec/changes/{{change}}/agent-review-report.md`.

**If the file does not exist or review previously failed:**
- Invoke `/aop:review {{change}}`
- After it completes, respond: `<aop>WIP</aop>`

**If the file exists and shows all checks passed:**
- Respond: `<aop>DONE</aop>`
