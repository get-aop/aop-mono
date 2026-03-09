---
name: task-review
description: Add additional subtasks to an existing task folder. Use when the user wants to expand or revise work already planned under docs/tasks.
---

# Task Review

Review an existing task folder, identify missing work, and add new numbered subtasks without disturbing completed ones.

## Deliverable

Create or update:

- `docs/tasks/<task-slug>/plan.md`
- new numbered subtask files like `docs/tasks/<task-slug>/009-*.md`

## Workflow

1. Read `task.md`, `plan.md`, and the existing numbered subtasks.
2. Show the current task and subtask status.
3. Gather the additional work that needs to be planned.
4. Create new numbered subtasks that fit the existing sequence.
5. Update `plan.md` to include the new work.
6. Set the task back to `INPROGRESS` so the orchestrator can pick it up.

## Guidance

- Keep existing subtask files unchanged.
- Continue numbering from the highest existing subtask.
- Default new dependencies to the already completed subtasks when that gives the next agent enough context.
- Keep each new subtask focused and independently executable.

## Subtask Shape

Create new numbered subtask files with this structure:

```md
---
title: [Subtask title]
status: PENDING
dependencies: [1, 2]
---

### Description
[What this subtask must do]

### Context
[Relevant background, file references, or constraints]

### Result
(filled after implementation)

### Review
(filled after review)

### Blockers
(filled if the work gets stuck)
```

## Plan Update

Append the new subtasks under `## Subtasks` in `plan.md` and preserve the existing entries.

## Final State

When new subtasks were added, update `task.md` so the task status is `INPROGRESS`.
