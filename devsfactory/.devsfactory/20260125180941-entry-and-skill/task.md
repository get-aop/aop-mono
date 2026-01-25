---
title: Entry Point and New Task Skill
status: BACKLOG
created: 2026-01-25T00:00:00Z
priority: medium
tags: [entry, skill, integration]
assignee: null
dependencies: [20260125180931-terminal-ui]
---

## Description

Wire everything together with a main entry point and create the Claude skill for task creation via `/new-task` command. This is the final integration phase.

## Requirements

### Entry Point (`src/index.ts`)

- Define default configuration:
  ```typescript
  const DEFAULT_CONFIG = {
    maxConcurrentAgents: 2,
    devsfactoryDir: ".devsfactory",
    worktreesDir: ".worktrees",
  };
  ```
- Implement `main()` async function:
  1. Check we're in a git repository using `isGitRepo()`
     - Exit with error message if not
  2. Ensure `.devsfactory/` directory exists
     - Create if missing
  3. Ensure `.worktrees/` directory exists
     - Create if missing
  4. Add `.worktrees/` to `.gitignore` if not present
  5. Initialize `Orchestrator` with config
  6. Start orchestrator
  7. Start TUI with `startApp(orchestrator)`
  8. Handle graceful shutdown on SIGINT/SIGTERM
     - Stop orchestrator
     - Exit cleanly
- Call `main().catch(console.error)`

### Package.json Updates

- Add scripts:
  ```json
  {
    "scripts": {
      "start": "bun run src/index.ts",
      "dev": "bun --hot run src/index.ts",
      "test": "bun test",
      "test:watch": "bun test --watch",
      "typecheck": "bunx tsc --noEmit"
    }
  }
  ```
- Ensure all dependencies are listed

### Claude Skill (`skills/new-task/skill.md`)

- Create skill file following Claude skill format
- Skill name: `new-task`
- Description: "Create a new devsfactory task"
- Skill behavior:
  1. Parse title from command arguments
     - If empty, prompt user for title
  2. Generate folder name: `{YYYYMMDDHHmmss}-{slug}`
     - Slug from title: lowercase, replace spaces with hyphens, remove special chars
  3. Check folder doesn't already exist
  4. Prompt for details using AskUserQuestion:
     - Priority: high/medium/low (default: medium)
     - Tags: comma-separated (optional)
     - Dependencies: list existing tasks to depend on (optional)
  5. Ask: "Brainstorm or Draft?"
     - **Brainstorm**: Invoke `/brainstorming` skill first, then create task.md with status PENDING
     - **Draft**: Create task.md with status DRAFT for manual editing
  6. Create folder and task.md file
  7. Output: Confirm creation, show file path

### Task.md Template (for skill)

```markdown
---
title: { title }
status: { DRAFT|PENDING }
created: { ISO-8601-timestamp }
priority: { priority }
tags: [{ tags }]
assignee: null
dependencies: [{ dependencies }]
---

## Description

{description from brainstorming or placeholder text}

## Requirements

-

## Acceptance Criteria

- [ ]

## Notes
```

### Gitignore Updates

- Ensure `.worktrees/` is in `.gitignore`
- Ensure any temp files are ignored

### README Updates

- Update README.md with:
  - Project description
  - Installation: `bun install`
  - Usage: `bun run start`
  - Commands: `/new-task`
  - Configuration options

### Tests

- `src/index.test.ts`:
  - Test main function with mocked orchestrator/TUI
  - Test error handling for non-git directory
  - Test directory creation
- Integration test:
  - Create task via skill
  - Verify task.md created correctly
  - Verify orchestrator picks up new task

## Acceptance Criteria

- [ ] `bun run start` launches devsfactory successfully
- [ ] Entry point checks for git repository
- [ ] Entry point creates `.devsfactory/` if missing
- [ ] Entry point creates `.worktrees/` if missing
- [ ] Graceful shutdown on SIGINT/SIGTERM
- [ ] `/new-task` skill creates properly formatted task.md
- [ ] `/new-task` skill prompts for priority, tags, dependencies
- [ ] `/new-task` skill offers brainstorm vs draft option
- [ ] README documents installation and usage
- [ ] All tests pass: `bun test`
- [ ] Full workflow works: task creation → planning → implementation → review → done

## Notes

- The skill file goes in `skills/new-task/skill.md`
- Skill should be compatible with Claude Code skill format
- Test the full workflow manually after integration
