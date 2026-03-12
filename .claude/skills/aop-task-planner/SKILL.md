---
name: aop-task-planner
description: Use when planning implementation work from a document, issue, or prompt into the repo-local docs/tasks workflow.
---

# Task Planner

Read an input document or prompt and turn it into an executable task package under `docs/tasks/<task-slug>/`.

## Deliverable

You must create or update:

- `docs/tasks/<task-slug>/task.md`
- `docs/tasks/<task-slug>/plan.md`
- numbered subtask files like `docs/tasks/<task-slug>/001-*.md`

## Process

1. Read the input thoroughly.
2. Explore the codebase before planning.
3. Identify integration points, existing patterns, and repo verification commands.
4. Create a compact implementation plan with dependency-aware subtasks.
5. Present the saved plan for human approval before implementation starts.

## Planning Rules

- Tasks must be implementation tasks, not research tasks.
- Use concrete action verbs: implement, add, create, refactor, replace, wire up, migrate.
- Every subtask must be executable without hidden context.
- The verification section must contain exact commands or explicit checks.

## Required Files

Use the same `task.md`, `plan.md`, and numbered subtask formats defined by the repo-local task workflow.

At minimum:
- `task.md` must explain the problem, requirements, and acceptance criteria.
- `plan.md` must contain `## Summary`, `## Context`, `## Subtasks`, and `## Verification`.
- numbered subtask docs must define scope, context, result, review, and blockers.

## Guardrails

- Save the files. A plan only shown in chat is a failure.
- Plan only. Do not implement code in this step.
- If the input is actually a research request, say so explicitly instead of forcing an implementation plan.
- End by showing the task folder path and a short summary of the planned subtasks.
