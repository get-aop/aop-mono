---
name: "AOP: From Scratch"
description: Start a new task from a rough idea when there is no GitHub issue, Linear ticket, or existing spec. This command includes any needed clarification inside the same flow.
category: AOP
tags: [aop, task, planning]
---

Start a new AOP task from scratch.

## Input

The argument after `/aop:from-scratch` is a short description of what needs to be built, fixed, or changed.

If no input is provided, ask the user what they want to build before proceeding.

## Rules

- This is the only entrypoint for idea-first task creation.
- Keep all clarification inside this command.
- Invoke the `aop-brainstorming` skill first, then continue this command after it writes `docs/tasks/<task-slug>/design.md`.
- Never invoke any generic `brainstorming` skill from this command.
- After writing the task files, ask whether the task should be started now.
- Ask only the minimum questions needed to produce a solid task file.
- Save all notes with the task folder.

## Process

1. Read the request.
2. Run the `aop-brainstorming` skill to clarify intent, constraints, and success criteria and to write `docs/tasks/<task-slug>/design.md`.
3. Continue only after `design.md` exists.
4. Read `docs/tasks/<task-slug>/design.md` from disk and use it as the source of truth for task creation.
5. Create `docs/tasks/<task-slug>/` if it does not exist.
6. Write `docs/tasks/<task-slug>/task.md` from the approved design in `design.md`, not from chat memory.
7. Write `docs/tasks/<task-slug>/plan.md` from the approved design in `design.md`.
8. Add numbered subtask files under `docs/tasks/<task-slug>/` when the design implies multiple executable slices.
9. Ask whether the task should be started now.
10. If the answer is yes, invoke the `task-ready` skill to promote the task to `READY`.
11. Present the task slug, `design.md`, written files, final status, and a short summary for review.

## Guardrails

- Do not start implementation.
- Do not redirect to any other task-start command.
- Keep the task file self-contained for background execution.
