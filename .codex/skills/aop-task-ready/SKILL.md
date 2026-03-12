---
name: aop-task-ready
description: Promote an existing task to READY so the orchestrator can pick it up.
---

# Task Ready

Use this after a task already exists under `docs/tasks/<task-slug>/` and the user wants the orchestrator to start working on it.

## Scope

- Only prepare a task for orchestrator pickup.
- Do not create or rewrite the task docs in this skill.
- Do not use this as a generic lifecycle editor.

## Process

1. Resolve the task by slug, task path, or task id.
2. Verify the task currently exists and is in an activatable state.
3. Promote the task to `READY` using the repo's existing `task:ready` flow.
4. Report the task identifier and confirm it is now ready for orchestrator pickup.

## Guardrails

- Only use this for tasks that should enter execution now.
- If the task is already `READY`, say so and stop.
- If the task is in a state that cannot be promoted with the normal `task:ready` flow, report that clearly instead of forcing a status change.
