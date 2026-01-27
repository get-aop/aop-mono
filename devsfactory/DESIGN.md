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
│   ├── review.md                    # Task-level review attempts (3 max)
│   ├── 001-create-user-model.md     # Subtask 1
│   ├── 001-create-user-model-review.md  # Subtask review history
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
status: INPROGRESS | AGENT_REVIEW | BLOCKED | REVIEW
task: 20260125143022-add-user-auth
created: 2026-01-25T15:00:00Z
---

## Subtasks
1. 001-create-user-model (Create user model)
2. 002-add-password-hashing (Add password hashing) → depends on: 001
3. 003-setup-auth-routes (Setup auth routes) → depends on: 001, 002

## Blockers
(filled by completion reviewer if task becomes blocked)
```

**Plan Statuses:**
- `INPROGRESS` - Subtasks are being worked on
- `AGENT_REVIEW` - All subtasks DONE, completion reviewer checking acceptance criteria
- `BLOCKED` - Review failed after 3 attempts, needs human intervention
- `REVIEW` - Ready for user to open PR

### Task-Level Review File: `review.md`

```yaml
---
task: 20260125143022-add-user-auth
created: 2026-01-25T17:00:00Z
---

## Review Attempt 1
(filled by Completion Review agent)

## Review Attempt 2
(filled by Completion Review agent)

## Review Attempt 3
(filled by Completion Review agent)

## Review Blocked
(filled if all three attempts consumed)
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

### File Watcher

The watcher monitors `.devsfactory/` using `fs.watch()` with `{ recursive: true }` and emits events:

| File Pattern | Event | Payload |
|--------------|-------|---------|
| `{taskFolder}/task.md` | `taskChanged` | `{ taskFolder }` |
| `{taskFolder}/plan.md` | `planChanged` | `{ taskFolder }` |
| `{taskFolder}/NNN-*.md` | `subtaskChanged` | `{ taskFolder, filename }` |
| `{taskFolder}/review.md` | `reviewChanged` | `{ taskFolder }` |

**Filtering:** Ignores `.git/`, `*.swp`, `*.tmp`, `*~`, `.DS_Store`
**Debouncing:** 100ms per file path to avoid duplicate events

### Orchestration Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                     Orchestration Loop                           │
│              (Priority order - finishing > starting)             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Find PENDING tasks (dependencies satisfied)                  │
│     └─▶ Set task to INPROGRESS                                  │
│     └─▶ Create task worktree                                    │
│     (Note: Plan already exists from task-planner brainstorm)    │
│                                                                  │
│  2. Find plans in AGENT_REVIEW                                   │
│     └─▶ Spawn Completion Review agent                           │
│     (Priority: finish task-level reviews first)                 │
│                                                                  │
│  3. Find tasks where ALL subtasks DONE, plan INPROGRESS         │
│     └─▶ Spawn Completing Task agent                             │
│     (Checks acceptance criteria)                                │
│                                                                  │
│  4. Find subtasks in AGENT_REVIEW                                │
│     └─▶ Spawn Subtask Review agent                              │
│     (Priority: finish subtask reviews before new work)          │
│                                                                  │
│  5. Find PENDING subtasks (task INPROGRESS, deps satisfied)     │
│     └─▶ Create subtask worktree                                 │
│     └─▶ Spawn Implementation agent                              │
│     └─▶ Set subtask to INPROGRESS                               │
│                                                                  │
│  6. Sleep / wait for file changes, repeat                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Task Planning Flow

Planning is **human-driven** via the `task-planner` skill (not an autonomous agent):

```
Task BACKLOG
    │
    ▼
User runs task-planner skill
    │ (brainstorming session)
    ▼
Creates plan.md + subtasks (all PENDING)
    │
    ▼
Skill prompts: "Move task to PENDING?"
    │
    ▼
Task PENDING (deps satisfied) → INPROGRESS
    │
    ▼
Orchestrator picks up subtasks
```

### Parallelism Rules

- **Global limit:** `maxConcurrentAgents` applies across ALL agent types (default: 2)
- Multiple tasks can run in parallel (different folders)
- Multiple subtasks within a task can run in parallel (if no dependencies)
- **Priority when at capacity:**
  1. Completion Review (task-level reviews)
  2. Subtask Review (subtask-level reviews)
  3. Completing Task (check if task done)
  4. Implementation (new work)

### Configuration

Environment variables (auto-loaded from `.env` by Bun):

```bash
DEVSFACTORY_DIR=.devsfactory     # Task definitions directory
WORKTREES_DIR=.worktrees         # Git worktrees directory
MAX_CONCURRENT_AGENTS=2          # Global agent limit
DEBOUNCE_MS=100                  # File watcher debounce
RETRY_INITIAL_MS=2000            # Initial retry delay
RETRY_MAX_MS=300000              # Max retry delay (5 min)
```

### Restart Recovery

On orchestrator startup:

| Scenario | Condition | Action |
|----------|-----------|--------|
| Task INPROGRESS, no plan.md | Planning interrupted | Reset to PENDING |
| Subtask INPROGRESS, no agent | Implementation interrupted | Respawn implementation agent |
| Subtask AGENT_REVIEW, no agent | Review interrupted | Respawn review agent |
| Orphaned worktree | Worktree exists but no INPROGRESS item | Set task BLOCKED + diagnostic |

### Error Handling

On agent failure (non-zero exit):
- Retry with exponential backoff: 2s → 4s → 8s → ... capped at 5 minutes
- Retry indefinitely (no max attempts)
- Retry state is in-memory only (resets on restart)

## Agent Types

There are **5 agent types** managed by the orchestrator:

| Agent Type | Trigger | Working Directory | Output |
|------------|---------|-------------------|--------|
| Implementation | Subtask PENDING (task INPROGRESS, deps satisfied) | Subtask worktree | Code changes, sets subtask to AGENT_REVIEW |
| Subtask Review | Subtask AGENT_REVIEW | Subtask worktree | DONE or back to INPROGRESS |
| Completing Task | All subtasks DONE, plan INPROGRESS | Task worktree | Sets plan to AGENT_REVIEW or creates more subtasks |
| Completion Review | Plan AGENT_REVIEW | Task worktree | Sets plan+task to REVIEW or BLOCKED |
| Conflict Solver | Merge conflict during subtask merge | Task worktree | Resolves conflict or fails |

### 1. Implementation Agent

Triggered when: Subtask is PENDING, parent task is INPROGRESS, dependencies satisfied

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

### 2. Subtask Review Agent

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

### 3. Completing Task Agent

Triggered when: All subtasks are DONE, plan status is INPROGRESS

```bash
claude --print "
You are reviewing the task .devsfactory/{task-folder}/task.md
with the subtasks planned at .devsfactory/{task-folder}/plan.md.

We've implemented the whole task and subtasks. It's implemented in this
current working directory, on this current branch.

Check against the task acceptance criteria. Mark all items that are done.

If it's fully complete, mark the plan status to AGENT_REVIEW and save the file.

Else, if you found items that are still missing, please break them into new
subtasks following the existing subtask format and add them to the plan.
" --cwd .worktrees/{task-folder}
```

### 4. Completion Review Agent

Triggered when: Plan status is AGENT_REVIEW

```bash
claude --print "
You are reviewing task: .devsfactory/{task-folder}/task.md
with the subtasks planned at .devsfactory/{task-folder}/plan.md.

Use the code-review skill to run this review against this worktree branch.

If there are still Review Attempts to be filled at .devsfactory/{task-folder}/review.md:
- Review the implementation changes using code-reviewer.
- Report your findings in the respective attempt (1, 2 or 3).
- If approved with no relevant issues:
  - Set the plan status and task status to REVIEW
  - Prepare a PR title and body and add it to the task file

Else, if there are no review attempts remaining:
- Report your final verdict in the Blockers section of the plan file.
- Propose any solutions if you can to unblock it.
- Set task and plan status to BLOCKED.
" --cwd .worktrees/{task-folder}
```

### 5. Conflict Solver Agent

Triggered when: Merge conflict occurs when merging subtask branch into task branch

```bash
claude --print "
You are resolving a merge conflict for subtask {subtask-file} in task {task-folder}.

The subtask branch failed to merge into the task branch due to conflicts.

Your job:
1. Identify the conflicting files (look for conflict markers)
2. Resolve the conflicts by keeping the intended changes from both sides
3. Stage the resolved files
4. Complete the merge commit

If you cannot resolve the conflict automatically (e.g., requires human decision):
- Abort the merge
- Exit with non-zero code

Do NOT make arbitrary decisions about conflicting logic - only resolve obvious
formatting or import conflicts.
" --cwd .worktrees/{task-folder}
```

### Subtask Lifecycle

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
│  (merge to task)            (needs human)                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Task-Level Review Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                    Task Review Lifecycle                         │
│              (After all subtasks are DONE)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  All subtasks DONE, plan INPROGRESS                              │
│     │                                                            │
│     ▼                                                            │
│  Completing Task Agent                                           │
│     │                                                            │
│     ├─▶ Missing items? → Create new subtasks → back to work     │
│     │                                                            │
│     ▼                                                            │
│  Plan AGENT_REVIEW ◄─────────────┐                              │
│     │                             │                              │
│     ▼                             │ (issues, attempt < 3)        │
│  Completion Review Agent ─────────┤                              │
│     │                             │                              │
│     │ (approved)                  │ (attempt >= 3)               │
│     ▼                             ▼                              │
│  Plan + Task REVIEW           BLOCKED                            │
│  (ready for PR)            (needs human)                         │
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
│   │   ├── git.ts               # Worktree management, branch ops
│   │   └── config.ts            # Configuration loader from env vars
│   │
│   ├── parser/
│   │   ├── frontmatter.ts       # YAML frontmatter parsing
│   │   ├── task.ts              # Task file parsing/writing
│   │   ├── plan.ts              # Plan file parsing/writing
│   │   └── subtask.ts           # Subtask file parsing/writing
│   │
│   ├── prompts/
│   │   ├── implementation.ts    # Implementation agent prompt
│   │   ├── review.ts            # Subtask review agent prompt
│   │   ├── completing-task.ts   # Completing task agent prompt
│   │   ├── completion-review.ts # Completion review agent prompt
│   │   └── conflict-solver.ts   # Conflict solver agent prompt
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
│   └── templates/
│       ├── review.md            # Task-level review template
│       └── ...
│
├── skills/
│   ├── new-task/                # Claude skill for /new-task
│   │   └── skill.md
│   └── task-planner/            # Claude skill for brainstorming tasks
│       └── SKILL.md
│
├── .devsfactory/                # Created on init
├── .env.example                 # Configuration template
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
