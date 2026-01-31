---
name: create-task
description: "Create a new development task with brainstorming and planning. Use when user wants to create a new task for a bug fix, start a new feature, or add a development item to work on. Combines brainstorming (to explore requirements) with task-planner (to break into subtasks). Triggers on: /create-task, 'create a task', 'add a new task', 'I want to build...', 'let's implement...'."
---

# New Task

Create a devsfactory task through collaborative brainstorming, then break it into implementable subtasks.

## Task Location

**Read the `<aop-context>` block** at the start of the prompt to determine where to create tasks.

If `<aop-context>` is present:
- Use `{tasks-dir}` from the context as the base directory for tasks
- Use `{brainstorm-dir}` for brainstorm artifacts
- Use `{project-name}` for branch naming: `task/{project-name}/{task-slug}`

If no `<aop-context>` block is present (backwards compatibility):
- Use `.devsfactory/` relative to the current working directory
- Use `.devsfactory/brainstorm/` for brainstorm artifacts

**Structure:**
```
{tasks-dir}/{task-slug}/
├── task.md       # Task definition with branch field
├── plan.md       # Planning output
└── 001-subtask.md
```

**IMPORTANT:** Tasks MUST be created directly under `{tasks-dir}/`, NOT in a nested `tasks/` subdirectory.

```
CORRECT:   {tasks-dir}/{task-slug}/task.md
WRONG:     {tasks-dir}/tasks/{task-slug}/task.md
```

The orchestrator uses the glob pattern `*/task.md` relative to the tasks directory, so it only finds tasks one level deep.

## Branch Naming

When creating task.md, set the `branch` field in frontmatter:
- Global mode: `task/{task-slug}` (project context is already in the tasks-dir path)
- Local mode: `task/{task-slug}`

## Workflow

1. Parse title from args or prompt user
2. Generate task-slug from title (kebab-case, e.g., "Dashboard UI" → "dashboard-ui")
3. Create task folder: `{tasks-dir}/{task-slug}/`
4. Use the brainstorming skill to gather requirements (interactive)
5. Create task.md using the template at `./templates/task.md`
6. Use the task-planner skill to generate the plan and all the subtasks
