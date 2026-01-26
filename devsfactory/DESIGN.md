# devsfactory Design Document

> Automating your development pipeline with AI Agents

## Overview

devsfactory is an AI agent orchestration system for software development. It manages development tasks while preserving context through structured markdown files and git worktrees.

**Core Problem:** Keeping context window manageable while tracking all task progress across multiple AI agents.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         devsfactory                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────┐     ┌──────────────┐     ┌──────────────────┐   │
│   │   TUI    │────▶│   Watcher    │────▶│  Agent Runner    │   │
│   │ (OpenTUI)│     │  (fs.watch)  │     │  (claude CLI)    │   │
│   └──────────┘     └──────────────┘     └──────────────────┘   │
│        │                  │                      │               │
│        │                  ▼                      ▼               │
│        │           ┌─────────────────────────────────┐          │
│        └──────────▶│        .devsfactory/            │          │
│                    │   Task & Plan Markdown Files    │          │
│                    └─────────────────────────────────┘          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Core Components

1. **TUI** - Interactive dashboard (OpenTUI), displays state, user controls
2. **Watcher** - Monitors `.devsfactory/`, triggers agent runs on state changes
3. **Agent Runner** - Spawns `claude` CLI processes, manages parallelism

All state lives in markdown files - the watcher and TUI both read from them, agents write to them.

## File Structure

### Directory Layout

```
.devsfactory/
├── 20260125143022-add-user-auth/
│   ├── task.md                      # Main task
│   ├── plan.md                      # Plan (orchestration + subtask order)
│   ├── 001-create-user-model.md     # Subtask 1
│   ├── 001-create-user-model-review.md  # Review history
│   ├── 002-add-password-hashing.md  # Subtask 2
│   └── 003-setup-auth-routes.md     # Subtask 3
│
├── 20260125150000-setup-payments/
│   ├── task.md
│   └── plan.md
│
└── 20260124091530-fix-login-bug/
    ├── task.md
    ├── plan.md
    └── 001-fix-validation.md
```

### Task File: `task.md`

```yaml
---
title: Add user authentication
status: DRAFT | BACKLOG | PENDING | INPROGRESS | BLOCKED | REVIEW | DONE
created: 2026-01-25T14:30:22Z
priority: high | medium | low
tags: [auth, security]
assignee: null | agent-1
dependencies: [20260124091500-setup-database]
---

## Description
Users should be able to sign up and log in using email and password.

## Requirements
- Email must be unique and validated for format
- Passwords must be minimum 8 characters
- Use bcrypt for password hashing with cost factor 12
- Sessions expire after 24 hours of inactivity
- Rate limit login attempts to 5 per minute per IP

## Acceptance Criteria
- [ ] Users can register with email/password
- [ ] Users can log in and receive a session
- [ ] Passwords are securely hashed

## Notes
Any additional context, links, or references...

### Implemented PR Description
(filled by agent after completion)

{PR_TITLE}

{PR_DESCRIPTION}
```

**Task Statuses:**
- `DRAFT` - User is still capturing requirements
- `BACKLOG` - User is still prioritizing it
- `PENDING` - Ready to be worked on
- `INPROGRESS` - Agents are working on the task
- `BLOCKED` - Agents need user input
- `REVIEW` - Agents are done, waiting for user review
- `DONE` - User reviewed and approved

### Plan File: `plan.md`

```yaml
---
status: INPROGRESS | BLOCKED | REVIEW
task: 20260125143022-add-user-auth
created: 2026-01-25T15:00:00Z
---

## Subtasks
1. 001-create-user-model (Create user model)
2. 002-add-password-hashing (Add password hashing) → depends on: 001
3. 003-setup-auth-routes (Setup auth routes) → depends on: 001, 002
```

### Subtask File: `{NNN}-{slug}.md`

```yaml
---
title: Create user model with email/password fields
status: PENDING | INPROGRESS | AGENT_REVIEW | DONE | BLOCKED
dependencies: []
---

### Description
Create a User model with email and hashed password fields using bun:sqlite.

### Context
- Reference: `src/db/schema.ts` for existing model patterns
- Reference: `src/utils/hash.ts` for password hashing
- See: https://bun.sh/docs/api/sqlite

### Result
(filled by agent after completion)
Created User model in `src/models/user.ts` with email unique constraint and password hash field.

### Review
- [ ] Input validation for email format
- [ ] Add index on email field for faster lookups

### Blockers
- (filled when agent gets stuck or needs user input)
```

**Subtask Statuses:**
- `PENDING` - Waiting for dependencies
- `INPROGRESS` - Implementation agent working
- `AGENT_REVIEW` - Review agent evaluating
- `DONE` - Review passed, committed (includes commit SHA)
- `BLOCKED` - Needs human (stuck or 3 failed reviews)

### Review History File: `{NNN}-{slug}-review.md`

```markdown
## Review #1 - 2026-01-25T15:30:00Z
- [ ] Missing input validation on email field
- [ ] Add error handling for duplicate emails

## Review #2 - 2026-01-25T16:00:00Z
- [x] Missing input validation on email field (fixed)
- [x] Add error handling for duplicate emails (fixed)
- [ ] Test coverage below 80%

## Review #3 - 2026-01-25T16:30:00Z
- [x] Test coverage below 80% (fixed)
✓ Approved
```

## Git Worktree Strategy

Each task and subtask gets its own worktree for isolation.

### Branch Structure

```
main (protected, user review required)
 │
 ├── task/20260125143022-add-user-auth
 │    └── (subtasks auto-merge here)
 │
 └── task/20260125150000-setup-payments
```

### Worktree Structure (flat)

```
.worktrees/
├── 20260125143022-add-user-auth/                          # Task worktree
├── 20260125143022-add-user-auth-001-create-user-model/    # Subtask worktree
├── 20260125143022-add-user-auth-002-add-password-hash/    # Subtask worktree
├── 20260125150000-setup-payments/                         # Another task
└── 20260125150000-setup-payments-001-add-stripe/          # Its subtask
```

### Workflow

1. Task → INPROGRESS: Create worktree `.worktrees/{task-folder}/` on branch `task/{task-folder}`
2. Subtask → INPROGRESS: Create worktree `.worktrees/{task-folder}-{num}-{slug}/` branched from task
3. Subtask → DONE: Auto-merge subtask branch into task branch, delete subtask worktree
4. Subtask → BLOCKED: Requires user input
5. All subtasks DONE: Task → REVIEW
6. User approves: Prompt to merge directly or open PR via `gh pr create`

## Watcher & Orchestration

```
┌─────────────────────────────────────────────────────────────────┐
│                        Watcher Loop                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Scan all task folders                                        │
│     └─▶ Parse task.md frontmatter                               │
│                                                                  │
│  2. Find PENDING tasks (dependencies satisfied)                  │
│     └─▶ Spawn planning agent                                    │
│     └─▶ Set task to INPROGRESS, create plan.md                  │
│                                                                  │
│  3. Find INPROGRESS plans with available subtasks               │
│     └─▶ For each unblocked subtask (deps satisfied, PENDING):   │
│         └─▶ Spawn implementation agent (up to max parallelism)  │
│         └─▶ Set subtask to INPROGRESS                           │
│                                                                  │
│  4. Find subtasks in AGENT_REVIEW                                │
│     └─▶ Spawn review agent                                      │
│                                                                  │
│  5. Check for completed plans                                    │
│     └─▶ All subtasks DONE? → Set plan + task to REVIEW          │
│                                                                  │
│  6. Sleep / wait for file changes, repeat                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Parallelism Rules:**
- Multiple tasks can run in parallel (different folders)
- Multiple subtasks within a task can run in parallel (if no dependencies between them)
- Configurable max concurrent agents (default: 2)

## Agent Types

### 1. Planning Agent

Triggered when: Task goes PENDING → INPROGRESS

```bash
claude --print "
You are planning task: {task-folder}

Read the task file at .devsfactory/{task-folder}/task.md

Break this task into small, implementable subtasks. For each subtask create a file:
.devsfactory/{task-folder}/{NNN}-{slug}.md

Each subtask should have:
- Clear title and description
- Context with file references
- Dependencies on other subtasks (by number)

Then update plan.md with the subtask list and order.

Keep subtasks small - each should be completable in a single coding session.
" --cwd .worktrees/{task-folder}
```

### 2. Implementation Agent

Triggered when: Subtask is PENDING with deps satisfied

```bash
claude --print "
You are implementing subtask: {subtask-file}

Read the subtask at .devsfactory/{task-folder}/{subtask-file}

Follow TDD:
1. Write failing tests first
2. Implement until tests pass
3. Run /code-simplifier for maintainability

When complete, set status to AGENT_REVIEW and fill the Result section.
If blocked, set status to BLOCKED and describe the blocker.
" --cwd .worktrees/{task-folder}-{subtask-slug}
```

### 3. Review Agent

Triggered when: Subtask is in AGENT_REVIEW

```bash
claude --print "
You are reviewing subtask: {subtask-file}

Review the implementation changes. Check for:
- Code quality and maintainability
- Test coverage
- Security issues
- Performance concerns

Add issues to the Review section in the subtask file.
Append a new entry to {subtask}-review.md with your findings.

If approved: Set status to DONE, commit with message referencing subtask.
If issues found: Set status to INPROGRESS for another implementation pass.
If this is attempt 3+ with unresolved issues: Set status to BLOCKED.
" --cwd .worktrees/{task-folder}-{subtask-slug}
```

### Review Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                    Subtask Lifecycle                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PENDING                                                         │
│     │                                                            │
│     ▼                                                            │
│  INPROGRESS ◄────────────────────┐                              │
│     │                             │                              │
│     │ (TDD + simplify)            │ (issues found,              │
│     ▼                             │  attempt < 3)                │
│  AGENT_REVIEW ────────────────────┤                              │
│     │                             │                              │
│     │ (review passes)             │ (attempt >= 3)               │
│     ▼                             ▼                              │
│   DONE                         BLOCKED                           │
│  (commit)                   (needs human)                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## TUI Dashboard

### Main View

```
┌─ devsfactory ─────────────────────────────────────────────────────┐
│ Tasks                                                              │
├────────────────────────────────────────────────────────────────────┤
│ ● INPROGRESS  20260125143022-add-user-auth     high   2/5 ██░░░   │
│ ○ PENDING     20260125150000-setup-payments    med    0/0         │
│ ◉ REVIEW      20260124091530-fix-login-bug     high   4/4 ████    │
│ ✓ DONE        20260123100000-init-project      low    2/2 ████    │
├────────────────────────────────────────────────────────────────────┤
│ Active Agents                                                      │
├────────────────────────────────────────────────────────────────────┤
│ impl   20260125143022-add-user-auth-002  "Running tests..."        │
│ review 20260125143022-add-user-auth-001  "Checking coverage..."    │
│ ──     (1 slot available)                                          │
└────────────────────────────────────────────────────────────────────┘
 [↑↓] Navigate  [Enter] Drill down  [b] Back  [l] Logs  [q] Quit
```

### Task Detail View

```
┌─ 20260125143022-add-user-auth ────────────────────────────────────┐
│ Status: INPROGRESS    Priority: high    Branch: task/20260125...  │
├────────────────────────────────────────────────────────────────────┤
│ Subtasks                                                           │
├────────────────────────────────────────────────────────────────────┤
│ ✓ DONE         001-create-user-model        (abc123f)              │
│ ◎ AGENT_REVIEW 002-add-password-hashing     review #1              │
│ ● INPROGRESS   003-setup-auth-routes        attempt #1             │
│ ○ PENDING      004-add-session-middleware   blocked by: 003        │
│ ○ PENDING      005-write-integration-tests  blocked by: 003, 004   │
├────────────────────────────────────────────────────────────────────┤
│ [Enter] View subtask  [l] Logs  [r] Open review.md  [b] Back       │
└────────────────────────────────────────────────────────────────────┘
```

### Subtask Detail View

```
┌─ 002-add-password-hashing ────────────────────────────────────────┐
│ Status: AGENT_REVIEW (attempt 1/3)                                 │
├────────────────────────────────────────────────────────────────────┤
│ Description:                                                       │
│ Add bcrypt password hashing utility with cost factor 12...         │
│                                                                    │
│ Review Issues:                                                     │
│ - [ ] Add timing-safe comparison for password verification         │
│ - [ ] Missing test for empty password edge case                    │
├────────────────────────────────────────────────────────────────────┤
│ [l] Live logs  [r] Review history  [u] Unblock  [b] Back           │
└────────────────────────────────────────────────────────────────────┘
```

## Claude Skill: `/new-task`

Integrates task creation into Claude Code workflow.

**Invocation:**
```
> /new-task Add user authentication with email and password
```

**Skill Behavior:**

1. Parse input - Extract title from command args, or prompt if empty
2. Generate folder name - `{YYYYMMDDHHmmss}-{slug}` from title
3. Create folder - `.devsfactory/{folder}/`
4. Prompt for details:
   - Priority? (high/medium/low)
   - Tags? (comma-separated)
   - Dependencies? (list existing tasks)
5. Ask: Brainstorm or Draft?
   - **Brainstorm** → Launch brainstorming skill, write design, then create task.md with status PENDING
   - **Draft** → Create task.md with status DRAFT for user to fill in manually

## Project Structure

```
devsfactory/
├── src/
│   ├── index.ts                 # Entry point - launches TUI
│   │
│   ├── core/
│   │   ├── watcher.ts           # File system watcher for .devsfactory/
│   │   ├── orchestrator.ts      # Decides which agents to spawn
│   │   ├── agent-runner.ts      # Spawns/manages claude CLI processes
│   │   └── git.ts               # Worktree management, branch ops
│   │
│   ├── parser/
│   │   ├── frontmatter.ts       # YAML frontmatter parsing
│   │   ├── task.ts              # Task file parsing/writing
│   │   ├── plan.ts              # Plan file parsing/writing
│   │   └── subtask.ts           # Subtask file parsing/writing
│   │
│   ├── prompts/
│   │   ├── planning.ts          # Planning agent prompt template
│   │   ├── implementation.ts    # Implementation agent prompt
│   │   └── review.ts            # Review agent prompt
│   │
│   ├── tui/
│   │   ├── app.tsx              # Root OpenTUI component
│   │   ├── views/
│   │   │   ├── task-list.tsx    # Main task list view
│   │   │   ├── task-detail.tsx  # Task drill-down view
│   │   │   └── subtask-detail.tsx
│   │   └── components/
│   │       ├── status-badge.tsx
│   │       ├── progress-bar.tsx
│   │       └── log-viewer.tsx
│   │
│   └── types/
│       └── index.ts             # Shared TypeScript types
│
├── skills/
│   └── new-task/                # Claude skill for /new-task
│       └── skill.md
│
├── .devsfactory/                # Created on init
├── package.json
├── tsconfig.json
└── README.md
```

## Technology Choices

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Fast, TypeScript-native, built-in tooling |
| TUI | OpenTUI | TypeScript-native, Bun-friendly |
| Agent Invocation | Claude CLI | Leverage existing tools/skills |
| State Storage | Markdown + YAML frontmatter | Human-readable, git-friendly |
| Git Isolation | Worktrees | Parallel work without conflicts |
| Task Creation | Claude Skill | Integrated into dev workflow |

## Future Considerations

- GitHub Issues sync (bi-directional task ↔ issue mapping)
- Cloud deployment as daemon
- Multiple repository support
- Custom agent prompts per project
