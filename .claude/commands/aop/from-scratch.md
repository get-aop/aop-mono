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
- Do not invoke other planning or brainstorming commands or skills.
- Ask only the minimum questions needed to produce a solid task file.
- Save all notes with the task folder.

## Process

1. Read the request and inspect the relevant codebase areas.
2. Clarify only what materially changes the implementation plan.
3. Derive a kebab-case task slug.
4. Create `docs/tasks/<task-slug>/` if it does not exist.
5. Write `docs/tasks/<task-slug>/task.md` with the task description, requirements, and acceptance criteria.
6. Write `docs/tasks/<task-slug>/plan.md` with a short decision summary, implementation context, and verification steps.
7. Add numbered subtask files under `docs/tasks/<task-slug>/` when the work needs multiple executable slices.
8. Present the task slug, written files, and a short summary for review.

## Guardrails

- Do not start implementation.
- Do not redirect to any other task-start command.
- Keep the task file self-contained for background execution.
