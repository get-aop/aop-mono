---
name: aop-from-scratch
description: Use when the user has a rough idea and wants to create a repo-local task package without an existing ticket or spec.
---

# AOP From Scratch

Start a new AOP task from an idea-first request.

## Input

The user provides a short description of what needs to be built, fixed, or changed.

If the user already has a GitHub issue, Linear ticket, or requirements document, use `aop-from-ticket` instead.

## Rules

- This is the idea-first entrypoint for task creation.
- Keep clarification inside this skill.
- Invoke `aop-brainstorming` first, then continue only after it writes `docs/tasks/<task-slug>/design.md`.
- Never invoke a generic brainstorming skill from this flow.
- Ask only the minimum questions needed to produce a solid task package.
- After writing the task files, ask whether the task should be started now.

## Process

1. Read the request.
2. Run `aop-brainstorming` to clarify intent, constraints, and success criteria and to write `docs/tasks/<task-slug>/design.md`.
3. Continue only after `design.md` exists.
4. Read `docs/tasks/<task-slug>/design.md` from disk and use it as the source of truth.
5. Create `docs/tasks/<task-slug>/` if it does not exist.
6. Write `docs/tasks/<task-slug>/task.md` from the approved design, not from chat memory.
7. Write `docs/tasks/<task-slug>/plan.md` from the approved design.
8. Add numbered subtask files when the design implies multiple executable slices.
9. Ask whether the task should be started now.
10. If the answer is yes, invoke `aop-task-ready` to promote the task to `READY`.
11. Present the task slug, `design.md`, written files, final status, and a short summary.

## Guardrails

- Do not start implementation.
- Keep the task files self-contained for background execution.
- Save the files. Chat-only output is a failure.
