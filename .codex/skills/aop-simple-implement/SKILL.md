---
name: aop:simple-implement
description: Implement tasks from a simple checklist or plan file. Use when working with unstructured task files (markdown checklists, review notes, TODO lists) rather than OpenSpec changes. Triggers on /aop:simple-implement, "implement from checklist", "work through the todo list".
---

# AOP Simple Implement

Execute tasks from a simple markdown checklist or plan file through a quality pipeline.

- Work through **one checkbox item at a time**
- Stop after completing a cohesive chunk of work (like a 20min pomodoro session)

## Arguments

```
/aop:simple-implement {{file_path}}
```

`file_path` is required. Must be a markdown file with checkbox items (`- [ ]`).

## Workflow

**Copy this tracker and update as you complete each step:**

```
AOP Simple Implement Progress:
[ ] Step 1: Parse Tasks - file read, next task identified
[ ] Step 2: Implement Task - task completed
[ ] Step 3: Remove AI Slop - /remove-ai-slop executed
[ ] Step 4: Signal Output - TASK_DONE or FINISHED
```

### Step 1: Parse Tasks

1. Read the specified file
2. Find all checkbox items (`- [ ]` = pending, `- [x]` = done)
3. Identify the **next pending task** (first unchecked item)

**If no pending tasks remain**: Stop and respond with `<aop>FINISHED</aop>`

**Otherwise**: Announce which task you're working on and continue to Step 2.

### Step 2: Implement Task

Execute the task:
- Make the required code changes
- Keep changes minimal and focused on the task
- Wire up all functionality (no dangling TODOs)

**TDD requirement**: If the task introduces new code (functions, classes, modules), use `/test-driven-development`.

**Skip TDD when**:
- Infrastructure/config tasks (CI, build, linting setup)
- The task IS writing tests or e2e tests 
  - Never use Mocks on E2E tests, the idea is to stress the real system with real APIs. Unless the user explicitly asked to use mocks.
- Writing frontend or UI/UX code. 
  - Here you should favor happy paths and basic unhappy flows using e2e/playwright tests
  - Apply TDD in E2E imagining you are the user
  - Use the `webapp-testing` skill to run your tests
- Pure refactoring with existing test coverage

Verify completion:
- Run relevant tests if applicable
- Run repo verification commands (`bun check` or equivalent, but make sure you arent breaking linting, formatting, typechecking, etc.)
- Ensure the change is functional

Once complete:
- Mark the checkbox as done in the file: `- [ ]` → `- [x]`

**Gate**: Do not proceed until the task is verified complete.

### Step 3: Remove AI Slop

Run `/remove-ai-slop` to clean up:
- Unnecessary comments
- Over-defensive code
- Type casts to `any`
- Style inconsistencies
- Dead code

**Gate**: Do not proceed until slop is removed.

### Step 4: Output Signal (REQUIRED)

**End with one of these signals on its own line:**

If more tasks remain in the file:
```
<aop>TASK_DONE</aop>
```

If all tasks are complete:
```
<aop>FINISHED</aop>
```
