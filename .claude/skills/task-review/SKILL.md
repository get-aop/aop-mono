---
name: task-review
description: Add additional subtasks to an existing task. Use when user says /task-review, "review task", "add subtasks". Reads the task folder, shows current status, allows adding new subtasks interactively, and sets task.md back to INPROGRESS.
---

# Task Review

## Workflow

1. **Read task folder** - Identify task path and load task.md + plan.md
2. **Show current status** - Display existing subtasks with their statuses
3. **Gather requirements** - Ask user what additional work is needed
4. **Create new subtasks** - Generate subtask files following existing patterns
5. **Update plan.md** - Add new subtasks to the plan
6. **Set task INPROGRESS** - Update task.md status so orchestrator picks it up

## Step 1: Read Task Folder

Accept task path as argument or prompt user:

```
/task-review .devsfactory/my-task-folder
```

Load and parse:

- `task.md` - Get task title, status, requirements
- `plan.md` - Get existing subtask list and statuses
- All `NNN-*.md` files - Get subtask details

## Step 2: Show Current Status

Display summary to user:

```
Task: [title]
Status: [current status]
Subtasks:
  001-setup-models       DONE
  002-add-routes         DONE
  003-write-tests        DONE
  004-update-docs        BLOCKED
```

## Step 3: Gather Requirements

Use AskUserQuestion to understand what's missing:

- "What additional work is needed for this task?"
- "Are there any issues with the completed subtasks that need fixing?"
- "Should any existing blocked subtasks be removed or modified?"

Based on user input, determine:

- New subtasks to create
- Whether to unblock/modify existing subtasks

## Step 4: Create New Subtasks

For each new subtask, create `.devsfactory/{task-folder}/{NNN}-{slug}.md`:

**Numbering**: Continue from the highest existing subtask number (e.g., if 008 exists, start at 009).

**Dependencies**: Auto-assign dependencies on all DONE subtasks by default. This ensures new work builds on completed foundations.

Use the same template format as task-planner:

```markdown
---
title: { { title } }
status: PENDING
dependencies: [{ { all-done-subtask-numbers } }]
---

### Description

{{description}}

### Context

{{context}}

### Result

(filled by agent after completion)

### Review

(filled by review agent)

### Blockers

(filled when agent gets stuck or needs user input)
```

## Step 5: Update plan.md

Append new subtasks to the existing plan:

```markdown
## Subtasks

1. [001-slug](001-slug.md) - Title (existing)
   ...
2. [008-final](008-final.md) - Title (existing)
3. [009-new-feature](009-new-feature.md) - Title → depends on: 001, 002, 003
4. [010-fix-edge-case](010-fix-edge-case.md) - Title → depends on: 009
```

Update the dependency graph section if present.

## Step 6: Set Task INPROGRESS

Update task.md frontmatter:

```yaml
status: INPROGRESS
```

Confirm to user:

> Added N new subtask(s). Task set to INPROGRESS - the orchestrator will process the new subtasks.

## Guidelines

**DO**:

- Continue numbering from the highest existing subtask
- Set dependencies on DONE subtasks so agents have context
- Keep new subtasks focused and testable
- Preserve existing subtask files unchanged

**DON'T**:

- Modify or renumber existing subtasks
- Create subtasks that duplicate completed work
- Remove completed subtask files
- Skip the dependency auto-assignment unless user explicitly requests it