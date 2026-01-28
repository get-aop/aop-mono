---
name: task-planner
description: Break down a development task into small, implementable subtasks. Use when a task transitions from PENDING to INPROGRESS in devsfactory. Reads a task.md file, analyzes requirements, and generates numbered subtask files with proper dependencies, plus a plan.md orchestration file.
---

# Task Planner

Break a task into small, implementable subtasks for parallel agent execution.

## Workflow

1. Read the task file at the provided path
2. Analyze the codebase to understand existing patterns and structure
3. Design subtasks that are small, focused, and independently testable
4. Create subtask files using the template format
5. Create/update plan.md with subtask ordering and dependencies
6. Prompt user to move task from BACKLOG to PENDING (if applicable)

## Step 1: Read and Analyze Task

Read the task file. Extract:

- Title and description
- Requirements (explicit and implicit)
- Acceptance criteria
- Any referenced files or dependencies

## Step 2: Explore Codebase

Before planning, understand the codebase:

- Identify existing patterns for similar functionality
- Find files that will need modification
- Note any shared utilities or conventions
- Check for existing tests to understand testing patterns

## Step 3: Design Subtasks

Break the task into subtasks following these principles:

**Size**: Each subtask should be completable in a single focused session. If a subtask feels too large, split it.

**Independence**: Minimize dependencies between subtasks. Prefer subtasks that can run in parallel.

**Testability**: Each subtask should have clear, verifiable outcomes.

**Ordering**: Structure dependencies so early subtasks unblock later ones:

1. Data models / schemas first
2. Core utilities second
3. Business logic third
4. Integration / glue code fourth
5. Tests that span multiple components last

## Step 4: Create Subtask Files

For each subtask, create `.devsfactory/{task-folder}/{NNN}-{slug}.md`:

Use the template at `./templates/subtask.md` with these variables:

| Variable | Description |
|----------|-------------|
| `{{title}}` | Short descriptive title for the subtask |
| `{{dependencies}}` | Comma-separated list of subtask numbers this depends on (e.g., `001, 002`) or empty |
| `{{description}}` | What this subtask implements |
| `{{context}}` | File references, links, patterns to follow |

**Naming convention**: `{NNN}-{slug}.md` where:

- NNN = zero-padded sequence number (001, 002, ...)
- slug = kebab-case summary (e.g., `create-user-model`, `add-auth-routes`)

## Step 5: Create plan.md

Create/update `.devsfactory/{task-folder}/plan.md`

Use the template at `./templates/plan.md` with these variables:

| Variable | Description |
|----------|-------------|
| `{{taskFolder}}` | The task folder name (e.g., `20260125143022-add-user-auth`) |
| `{{timestamp}}` | ISO timestamp (e.g., `2026-01-25T14:30:22Z`) |
| `{{subtasks}}` | Numbered list of subtasks with dependencies |

**Subtasks format**:
```
1. [001-slug](001-slug.md) - Title
2. [002-slug](002-slug.md) - Title → depends on: 001
3. [003-slug](003-slug.md) - Title → depends on: 001, 002
```

## Step 6: Prompt to Move Task to PENDING

After creating the plan.md and all subtask files, if the task is currently in BACKLOG status:

1. **Summarize what was created:**
   - Number of subtasks
   - Dependency structure (which subtasks can run in parallel, which are sequential)
   - Key files that will be modified

2. **Use the AskUserQuestion tool to prompt:**

   ```
   "The plan is ready! Would you like to move the task to PENDING status to start implementation?"

   Options:
   - "Yes, move to PENDING now"
   - "No, I'll review the plan first and move it manually later"
   ```

3. **If user selects yes:**
   - Update the task.md frontmatter: `status: PENDING`
   - Confirm: "Task moved to PENDING. The orchestrator will pick it up when dependencies are satisfied."

4. **If user selects no:**
   - Confirm: "The plan is ready for your review. You can move the task to PENDING at any time by editing the task.md frontmatter."

**Note:** Skip this step if the task is already in PENDING status or later (INPROGRESS, DONE, etc.).

## Step 6: Prompt to Move Task to PENDING

After creating the plan.md and all subtask files, if the task is currently in BACKLOG status:

1. **Summarize what was created:**
   - Number of subtasks
   - Dependency structure (which subtasks can run in parallel, which are sequential)
   - Key files that will be modified

2. **Use the AskUserQuestion tool to prompt:**

   ```
   "The plan is ready! Would you like to move the task to PENDING status to start implementation?"

   Options:
   - "Yes, move to PENDING now"
   - "No, I'll review the plan first and move it manually later"
   ```

3. **If user selects yes:**
   - Update the task.md frontmatter: `status: PENDING`
   - Confirm: "Task moved to PENDING. The orchestrator will pick it up when dependencies are satisfied."

4. **If user selects no:**
   - Confirm: "The plan is ready for your review. You can move the task to PENDING at any time by editing the task.md frontmatter."

**Note:** Skip this step if the task is already in PENDING status or later (INPROGRESS, DONE, etc.).

## Guidelines

**DO**:

- Keep subtasks atomic - one clear responsibility each
- Include specific file references in Context section
- Order subtasks to maximize parallelism
- Reference existing code patterns agents should follow

**DON'T**:

- Create subtasks that require multiple unrelated changes
- Leave dependencies implicit - always declare them
- Create subtasks that can't be tested independently
- Over-engineer - match complexity to the task requirements
