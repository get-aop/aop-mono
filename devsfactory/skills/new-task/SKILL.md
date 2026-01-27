---
name: new-task
description: "Create a new development task with brainstorming and planning. Use when user wants to create a new task for a bug fix, start a new feature, or add a development item to work on. Combines brainstorming (to explore requirements) with task-planner (to break into subtasks). Triggers on: /new-task, 'create a task', 'add a new task', 'I want to build...', 'let's implement...'."
---

# New Task

Create a devsfactory task through collaborative brainstorming, then break it into implementable subtasks.

## Workflow

1. Parse title from args or prompt user
2. Create task folder with timestamp
3. Use the brainstorming skill to gather requirements (interactive)
4. Use the task-planner skill to generate the task, the plan and all the subtasks.
