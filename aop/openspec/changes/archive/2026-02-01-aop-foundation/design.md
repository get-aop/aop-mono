## Context

This is Milestone 1 of the AOP platform: validating the core agent execution loop before building full orchestration infrastructure.

**Current state**:
- `packages/git-manager`: Worktree creation, squash merge, removal
- `packages/llm-provider`: Claude Code agent spawning with streaming output
- `packages/infra`: Logger

**What we're building**: The minimal CLI that runs a single agent task in an isolated worktree, then allows the user to apply the results to their main repo.

## Goals / Non-Goals

**Goals:**
- Prove an agent can complete a real task in an isolated worktree
- User can apply agent's work to their main repo for review
- Minimal infrastructure: just enough to validate the loop
- Foundation for future milestones (database schema, types)
- E2E tests verify the implementation (pass = done)

**Non-Goals:**
- Multi-repo management (single repo, single task for now)
- Automatic task detection (manual `aop run` only)
- Remote server or dashboard
- Workflow engine (hardcoded single-step flow)
- Worktree cleanup (deferred to dashboard in future milestone)

## Decisions

### 1. CLI Entry Point

**Choice**: Single binary `aop` with subcommands.

```bash
aop run <change-path>    # Execute agent on change
aop apply <task-id>      # Apply worktree changes to main repo
aop status [task-id]     # Show task/execution status
```

**Rationale**: Familiar CLI pattern. `run` is the primary action; `apply` is the user-controlled integration step.

### 2. Task Identification

**Choice**: Use the change directory name as the task identifier (e.g., `add-auth` from `openspec/changes/add-auth/`).

**Alternative considered**: Generate UUIDs for tasks. Rejected because directory names are human-readable and already unique within a repo.

**Rationale**: Simpler mental model. User runs `aop run ./openspec/changes/add-auth`, gets task `add-auth`.

### 3. SQLite Schema (Minimal)

**Choice**: Single `tasks` table for this milestone. No `repos` table yet.

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,            -- "add-auth" (change directory name)
  repo_path TEXT NOT NULL,        -- Absolute path to repo
  change_path TEXT NOT NULL,      -- Relative path: openspec/changes/add-auth
  worktree_path TEXT,             -- .worktrees/add-auth (when created)

  status TEXT NOT NULL,           -- DRAFT, READY, WORKING, BLOCKED, DONE

  agent_pid INTEGER,              -- Running agent process ID
  session_id TEXT,                -- LLM session for resume
  exit_code INTEGER,              -- Agent exit code
  error TEXT,                     -- Error message if failed

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**Rationale**: Tracks just enough to manage one task. Schema will expand in Milestone 2 with repos table and execution history.

### 4. Execution Flow

**Choice**: Linear flow for `aop run`:

```
aop run ./openspec/changes/add-auth
    │
    ▼
1. Parse change path, validate exists
    │
    ▼
2. Create/update task in SQLite (status: WORKING)
    │
    ▼
3. Create worktree via git-manager
   (.worktrees/add-auth from main branch)
    │
    ▼
4. Build agent prompt from change artifacts
   (read proposal.md, design.md, tasks.md, specs/)
    │
    ▼
5. Spawn agent via llm-provider
   (cwd = worktree path, stream output to terminal)
    │
    ▼
6. On completion:
   - exit 0 → status: DONE
   - exit non-0 → status: BLOCKED, store error
    │
    ▼
7. Print summary, suggest: "Run 'aop apply add-auth' to apply changes"
```

**Rationale**: Simple, synchronous flow. User watches agent work in real-time.

### 5. Apply Flow

**Choice**: `aop apply` uses git patch to transfer changes.

```
aop apply add-auth
    │
    ▼
1. Look up task, verify status is DONE or BLOCKED
    │
    ▼
2. Check main repo has no uncommitted changes
   (fail with DirtyWorkingDirectoryError if dirty)
    │
    ▼
3. Generate patch: worktree changes vs base commit
   git diff <base-commit> HEAD (in worktree)
    │
    ▼
4. Apply patch to main repo
   git apply <patch> (in main repo)
    │
    ▼
5. Print affected files
   "Applied N files. Review changes and commit when ready."
```

**Alternative considered**: Cherry-pick commits. Rejected because patch is cleaner—user gets unstaged changes to review before committing.

**Rationale**: User stays in control. They see the diff, decide how to commit.

### 6. Prompt Templates

**Choice**: Use Handlebars templates stored in `templates/prompts/`.

**Alternatives considered**:
- **String concatenation**: Rejected—hard to read, hard to customize.
- **eta**: Modern, TypeScript-first, faster. Good alternative but less ecosystem support.
- **Mustache**: Simpler but lacks helpers we may need (conditionals, loops).
- **Nunjucks**: Jinja2-like, powerful but heavier than needed.

**Why Handlebars**:
- `{{ }}` syntax reads naturally in markdown
- Logic-less by default (keeps templates simple)
- Battle-tested, wide ecosystem
- Supports helpers for future needs (e.g., `{{#if hasDesign}}`)

**Template structure**:

```
templates/
  prompts/
    naive-implement.md.hbs      # Main implementation prompt
    review.md.hbs         # Code review prompt (future)
    debug.md.hbs          # Debug prompt (future)
```

**Example `naive-implement.md.hbs`**:

```handlebars
Implement the following change in this repository.

## Change: {{changeName}}

{{#if proposal}}
## Proposal

{{{proposal}}}
{{/if}}

{{#if design}}
## Design

{{{design}}}
{{/if}}

{{#if tasks}}
## Tasks

{{{tasks}}}
{{/if}}

{{#each specs}}
## Spec: {{this.name}}

{{{this.content}}}
{{/each}}
```

**Usage**:

```typescript
import Handlebars from 'handlebars';

const renderPrompt = (templateName: string, context: PromptContext): string => {
  const templatePath = `templates/prompts/${templateName}.md.hbs`;
  const template = Handlebars.compile(Bun.file(templatePath).text());
  return template(context);
};

// Context built from change artifacts
interface PromptContext {
  changeName: string;
  proposal?: string;
  design?: string;
  tasks?: string;
  specs: Array<{ name: string; content: string }>;
}
```

**Rationale**: Templates are readable, customizable, and separate content from logic. Future milestones can add more templates or fetch them from the server.

### 7. TypeID for Database IDs

**Choice**: Use TypeID for any generated IDs (future execution records).

```typescript
import { typeidUnboxed } from 'typeid-js';

const execId = typeidUnboxed('exec');  // "exec_01h455vb4..."
```

**Note**: For this milestone, task IDs are just the change directory name. TypeID will be used when we add execution history in Milestone 2.

**Rationale**: Consistent ID format across the codebase. Self-documenting, sortable.

### 8. Package Structure

**Choice**: Organize CLI by domain, templates at root, E2E tests separate.

```
apps/cli/
  src/
    db/
      connection.ts     # Kysely + Bun SQLite setup
      migrations.ts     # Schema migrations
      schema.ts         # Type definitions for tables
    tasks/
      types.ts          # Task, Status types
      store.ts          # CRUD operations
    commands/
      run.ts            # aop run
      apply.ts          # aop apply
      status.ts         # aop status
    prompt/
      builder.ts        # Build prompt from artifacts using templates
    main.ts             # CLI entry point

packages/common/
  src/
    types/
      task.ts           # Task, Status (shared types)
    index.ts

templates/
  prompts/
    naive-implement.md.hbs    # Main implementation prompt

e2e-tests/
  fixtures/
    cli-greeting-command/     # Sample OpenSpec change for testing
      proposal.md
      design.md
      tasks.md
  run.test.ts                 # E2E test for aop run
  apply.test.ts               # E2E test for aop apply
  utils.ts                    # Test helpers (create temp repo, etc.)
```

**Rationale**: Vertical slice organization. Templates are shared resources. E2E tests are separate from unit tests.

### 9. E2E Testing Strategy

**Choice**: E2E tests validate the full `aop run` → `aop apply` loop using a fixture change.

**Structure**:

```
e2e-tests/
  fixtures/
    cli-greeting-command/     # OpenSpec change that adds a greeting CLI command
      proposal.md             # "Add 'aop greet' command"
      design.md               # Simple design: parse args, print greeting
      tasks.md                # [ ] Add greet command, [ ] Add tests
  run.test.ts                 # Tests aop run
  apply.test.ts               # Tests aop apply
  utils.ts                    # Test helpers
```

**Test flow**:

```typescript
// e2e-tests/run.test.ts
test("aop run creates worktree and spawns agent", async () => {
  // 1. Create temp git repo
  const repo = await createTempRepo();

  // 2. Copy fixture change to repo
  await copyFixture("cli-greeting-command", repo);

  // 3. Run aop run
  const result = await $`aop run ${repo}/openspec/changes/cli-greeting-command`;

  // 4. Verify worktree created
  expect(await exists(`${repo}/.worktrees/cli-greeting-command`)).toBe(true);

  // 5. Verify task status
  const task = await getTask("cli-greeting-command");
  expect(task.status).toBe("DONE");
});

// e2e-tests/apply.test.ts
test("aop apply transfers changes to main repo", async () => {
  // 1. Setup: run aop run first (or use pre-completed fixture)
  // 2. Run aop apply
  const result = await $`aop apply cli-greeting-command`;

  // 3. Verify changes in main repo (unstaged)
  const status = await $`git status --porcelain`.text();
  expect(status).toContain("greet.ts");
});
```

**Fixture: `cli-greeting-command`**:

A minimal change that asks the agent to add a greeting command:
- `proposal.md`: Add `aop greet <name>` command that prints "Hello, <name>!"
- `design.md`: Simple implementation in `commands/greet.ts`
- `tasks.md`: `[ ] Create greet command` `[ ] Add unit test`

**Verification criteria**: Implementation is complete when E2E tests pass.

**Rationale**: E2E tests prove the core loop works. The greeting command is trivial enough that an agent can reliably implement it, making tests deterministic.

## Risks / Trade-offs

**[No automatic retry]** → Agent failures require manual `aop run` again. Acceptable for validation milestone.

**[Single task at a time]** → Can't run parallel tasks yet. Acceptable for validation.

**[Worktree accumulation]** → Worktrees persist after apply. User must manually clean up or wait for dashboard (Milestone 4).

**[Hardcoded prompt]** → No workflow customization. Future milestones add server-controlled workflows.

**[No resume support]** → If `aop run` is interrupted, must restart. Session ID is stored but not used yet.

**[E2E test flakiness]** → Tests involve real LLM agent which may behave non-deterministically. Mitigation: Use trivial fixture task (greeting command) that any agent can reliably implement. If flaky, consider mocking llm-provider for deterministic tests.
