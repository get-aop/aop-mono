---
title: Git Worktree Management and Agent Runner
status: BACKLOG
created: 2026-01-25T00:00:00Z
priority: high
tags: [core, git, agent]
assignee: null
dependencies: [20260125180901-types-and-frontmatter]
---

## Description

Implement git worktree management for task/subtask isolation and the agent runner that spawns and manages claude CLI processes. These are the core infrastructure components that enable parallel work and AI execution.

## Requirements

### Git Worktree Manager (`src/core/git.ts`)

- Implement `isGitRepo(): Promise<boolean>`
  - Run `git rev-parse --git-dir`
  - Return true if command succeeds, false otherwise
- Implement `getMainBranch(): Promise<string>`
  - Try `git symbolic-ref refs/remotes/origin/HEAD`
  - Parse branch name from output
  - Fallback to checking if 'main' or 'master' exists
  - Return branch name
- Implement `createTaskWorktree(taskFolder: string): Promise<string>`
  - Branch name: `task/{taskFolder}`
  - Worktree path: `.worktrees/{taskFolder}/`
  - Run: `git worktree add -b task/{taskFolder} .worktrees/{taskFolder}`
  - Return worktree path
  - Handle case where branch already exists
- Implement `createSubtaskWorktree(taskFolder: string, subtaskSlug: string): Promise<string>`
  - Worktree path: `.worktrees/{taskFolder}-{subtaskSlug}/`
  - Branch from: `task/{taskFolder}`
  - Run: `git worktree add -b task/{taskFolder}/{subtaskSlug} .worktrees/{taskFolder}-{subtaskSlug} task/{taskFolder}`
  - Return worktree path
- Implement `mergeSubtaskIntoTask(taskFolder: string, subtaskSlug: string): Promise<{ success: boolean; commitSha?: string; error?: string }>`
  - Get task worktree path
  - Run git merge from task worktree
  - Return commit SHA on success
  - Return error message on failure (conflicts, etc.)
- Implement `deleteWorktree(worktreePath: string): Promise<void>`
  - Run: `git worktree remove {path} --force`
  - Handle case where worktree doesn't exist
- Implement `listWorktrees(): Promise<string[]>`
  - Run: `git worktree list --porcelain`
  - Parse output for worktree paths
  - Return array of paths
- Implement `getCurrentBranch(worktreePath: string): Promise<string>`
  - Run: `git -C {path} branch --show-current`
  - Return branch name

### Agent Runner (`src/core/agent-runner.ts`)

- Create `AgentRunner` class extending EventEmitter
- Events to emit:
  - `started`: when agent process starts
  - `completed`: when agent process exits (with exit code)
  - `output`: for each line of stdout/stderr
  - `error`: on process errors
- Implement `spawn(options: { type: AgentType; taskFolder: string; subtaskFile?: string; prompt: string; cwd: string }): Promise<AgentProcess>`
  - Generate unique agent ID (uuid or timestamp-based)
  - Construct claude CLI command: `claude --print "{prompt}"`
  - Spawn process using `Bun.spawn()`
  - Set up stdout/stderr streaming with line-by-line parsing
  - Emit 'started' event
  - Track process in internal Map
  - Return AgentProcess object
- Implement `kill(agentId: string): Promise<void>`
  - Find process by ID
  - Send SIGTERM
  - Wait up to 5 seconds
  - Send SIGKILL if still running
  - Remove from tracking Map
- Implement `getActive(): AgentProcess[]`
  - Return array of all currently running agents
- Implement `getCountByType(type: AgentType): number`
  - Filter active agents by type
  - Return count

### Prompt Templates (`src/prompts/`)

- `src/prompts/planning.ts`:
  - Implement `getPlanningPrompt(taskFolder: string): string`
  - Template from DESIGN.md with {task-folder} substitution
  - Include instructions to read task.md, create subtask files, update plan.md
- `src/prompts/implementation.ts`:
  - Implement `getImplementationPrompt(taskFolder: string, subtaskFile: string): string`
  - Template from DESIGN.md with substitutions
  - Include TDD instructions, code-simplifier usage
- `src/prompts/review.ts`:
  - Implement `getReviewPrompt(taskFolder: string, subtaskFile: string): string`
  - Template from DESIGN.md
  - Include review criteria, approval/rejection logic, 3-attempt limit

### Tests

- `src/core/git.test.ts`:
  - Test isGitRepo in git directory (returns true)
  - Test isGitRepo in non-git directory (returns false)
  - Test createTaskWorktree creates worktree and branch
  - Test createSubtaskWorktree branches from task branch
  - Test mergeSubtaskIntoTask on clean merge
  - Test deleteWorktree removes worktree
  - Use temporary git repositories for isolation
- `src/core/agent-runner.test.ts`:
  - Test spawn with echo command (mock claude)
  - Test output event receives process stdout
  - Test completed event with exit code
  - Test kill terminates process
  - Test getActive tracks running processes
  - Test getCountByType filtering

## Acceptance Criteria

- [ ] `isGitRepo` correctly detects git repositories
- [ ] `createTaskWorktree` creates worktree on new branch from main
- [ ] `createSubtaskWorktree` creates worktree branched from task branch
- [ ] `mergeSubtaskIntoTask` performs merge and returns commit SHA
- [ ] `deleteWorktree` removes worktree and optionally deletes branch
- [ ] `AgentRunner.spawn` starts claude CLI process and tracks it
- [ ] `AgentRunner` emits events for process lifecycle
- [ ] `AgentRunner.kill` gracefully terminates processes
- [ ] All prompt templates match DESIGN.md format
- [ ] All tests pass: `bun test src/core/ src/prompts/`
- [ ] No TypeScript errors

## Notes

- Use `Bun.$` template literal for shell commands
- Capture both stdout and stderr from git commands for error handling
- AgentRunner should handle multiple concurrent agents
- Prompt templates should be string templates, not files

## Implemented PR Description
(filled by agent after completion)

{PR_TITLE}

{PR_DESCRIPTION}

