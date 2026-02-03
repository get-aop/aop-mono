## Why

Before building the full orchestration platform, we need to validate the core loop: can an agent complete a real task in an isolated worktree? This milestone proves the fundamental mechanics work end-to-end with minimal infrastructure.

## What Changes

- Create `packages/common` with shared Task and Status types
- Add TypeID helpers to `packages/infra`
- Create `apps/cli` with SQLite database (Kysely + Bun)
- Create task domain (types and store for manual task tracking)
- Create CLI commands: `aop run <change-path>` and `aop apply <task-id>`
- Extend `git-manager` with `applyWorktree` for applying changes to main repo
- Integrate existing `git-manager` and `llm-provider` packages

## Capabilities

### New Capabilities

- `common-types`: Shared TypeScript types for Task (5-state model: DRAFT/READY/WORKING/BLOCKED/DONE), Status enum, and basic task metadata
- `infra-typeid`: TypeID generation helpers using `typeid-js` unboxed API for type-prefixed, K-sortable identifiers
- `cli-database`: Kysely + Bun SQLite database layer with schema migrations; minimal schema for tasks only
- `cli-tasks`: Task domain within CLI - types and SQLite store for tracking task execution state
- `cli-commands`: Basic CLI commands for manual task execution (`aop run`, `aop apply`)
- `prompt-templates`: Handlebars-based prompt templates in `templates/prompts/` for agent instructions
- `e2e-tests`: End-to-end test suite with fixture changes to verify the full implementation loop

### Modified Capabilities

- `git-manager`: Add `applyWorktree` function to apply worktree changes to main repo working directory (see delta spec)

## Impact

- **New package**: `packages/common` (shared types)
- **Modified package**: `packages/infra` (add TypeID helpers)
- **New app**: `apps/cli` with db, tasks, commands
- **New folder**: `templates/prompts/` (Handlebars prompt templates)
- **New folder**: `e2e-tests/` with fixtures and integration tests
- **Dependencies**: `typeid-js`, `kysely`, `kysely-bun-sqlite`, `handlebars`
- **Existing packages**: `git-manager` extended with apply capability, `llm-provider` used as-is

## End-to-End Flow

```bash
aop run ./my-repo/openspec/changes/add-auth
# → Creates worktree (.worktrees/add-auth/)
# → Spawns agent with task context
# → Agent implements
# → Reports success/failure
# → Worktree persists for user review

aop apply <task-id>
# → Applies changes from worktree to main repo working directory
# → User reviews diff, commits manually
# → Worktree persists (cleanup via dashboard in future milestone)
```

## Not In Scope

- Multi-repo management (no repos table, no `aop init`)
- File watcher (no auto-detection of changes)
- Remote server connection
- Dashboard
- Workflow engine (single hardcoded flow for now)

These are deferred to subsequent milestones after validating the core loop works.
