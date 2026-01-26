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

Use the template at `./templates/subtask.md`:

**Naming convention**: `{NNN}-{slug}.md` where:

- NNN = zero-padded sequence number (001, 002, ...)
- slug = kebab-case summary (e.g., `create-user-model`, `add-auth-routes`)

## Step 5: Create plan.md

Create/update `.devsfactory/{task-folder}/plan.md`

Use the template at `./templates/plan.md`

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
