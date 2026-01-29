---
name: new-task
description: "Create a new development task with brainstorming and planning. Use when user wants to create a new task for a bug fix, start a new feature, or add a development item to work on. Combines brainstorming (to explore requirements) with task-planner (to break into subtasks). Triggers on: /new-task, 'create a task', 'add a new task', 'I want to build...', 'let's implement...'."
---

# New Task

Create a devsfactory task through collaborative brainstorming, then break it into implementable subtasks.

## Task Location

**IMPORTANT:** Tasks MUST be created directly under `.devsfactory/`, NOT in a `tasks/` subdirectory.

```
CORRECT:   .devsfactory/{task-slug}/task.md
WRONG:     .devsfactory/tasks/{task-slug}/task.md
```

The orchestrator uses the glob pattern `*/task.md` relative to `.devsfactory/`, so it only finds tasks one level deep.

## Workflow

1. Parse title from args or prompt user
2. Generate task-slug from title (kebab-case, e.g., "Dashboard UI" → "dashboard-ui")
3. Create task folder: `.devsfactory/{task-slug}/`
4. Use the brainstorming skill to gather requirements (interactive)
5. Create task.md using the template at `./templates/task.md`
6. Use the task-planner skill to generate the plan and all the subtasks
