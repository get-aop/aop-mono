---
name: aop-create-task
description: Use when a discussion in the current session should become an executable repo-local task package under docs/tasks.
---

# Create Task

Turn an agreed discussion into a self-contained task folder that another agent can execute without conversation context.

## Deliverable

Create or update `docs/tasks/<task-slug>/` with:

- `task.md`
- `plan.md`
- numbered subtask files like `001-*.md`, `002-*.md`

## Process

1. Harvest the decisions already made in the conversation.
2. Verify every important claim against the real codebase before writing files.
3. If a critical decision is still unresolved, flag it explicitly in the task docs.
4. Write the task folder so an implementing agent can work without this chat.

## Required File Shapes

### `task.md`

Use frontmatter plus these sections:

```md
---
title: [Task title]
status: DRAFT
created: [ISO timestamp]
priority: medium
tags: []
assignee: null
dependencies: []
startedAt: null
completedAt: null
durationMs: null
---

## Description
[Why this task exists]

## Requirements
- [Requirement]

## Acceptance Criteria
- [ ] [Acceptance criterion]
```

### `plan.md`

Use frontmatter plus these sections:

```md
---
status: INPROGRESS
task: [task-slug]
created: [ISO timestamp]
---

## Summary
[2-3 sentences]

## Context
[Key decisions, architecture notes, constraints]

## Subtasks
1. 001-[slug] ([Title])
2. 002-[slug] ([Title]) -> depends on: 1

## Verification
- [ ] [Verification command or check]
```

### Numbered subtask docs

```md
---
title: [Subtask title]
status: PENDING
dependencies: [1]
---

### Description
[Concrete scope]

### Context
[Relevant files, constraints, references]

### Result

### Review

### Blockers
```

## Guardrails

- Save files. Chat-only output is a failure.
- Do not reference the prior discussion as if the next agent can read it.
- Prefer a small number of cohesive subtasks over an oversized checklist.
- End by showing the task folder path and summarizing what was created.
