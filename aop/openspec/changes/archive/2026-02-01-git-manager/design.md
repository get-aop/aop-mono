## Context

AOP orchestrates AI agents that work on coding tasks. When multiple agents run in parallel, they need isolated filesystems to avoid stepping on each other. Git worktrees provide this isolation natively - each worktree is a separate working directory with its own branch, sharing the same `.git` object store.

Current state: No git management exists. The orchestrator will need to call git-manager before dispatching work to agents.

## Goals / Non-Goals

**Goals:**
- Provide simple API for worktree lifecycle (create, squash-merge, remove)
- Auto-initialize `.worktrees/` directory and `.gitignore` on first use
- Surface merge conflicts clearly so orchestrator can delegate to conflict resolution
- Support parallel worktrees in the same repository

**Non-Goals:**
- State management (CLI/SQLite handles worktree tracking)
- Conflict resolution (orchestrator invokes separate agent for this)
- Push/pull operations (user handles remote interactions)
- Branch protection or policy enforcement

## Decisions

### 1. Use `Bun.$` for git commands
**Decision:** Shell out to git CLI via `Bun.$` rather than using a git library like isomorphic-git.

**Rationale:** Git CLI is battle-tested, always available, and worktree operations are simple commands. Libraries add dependency weight and may lag behind git features.

**Alternatives considered:**
- isomorphic-git: Doesn't support worktrees
- simple-git: Extra dependency, we only need 3 operations

### 2. Worktrees at `.worktrees/<taskId>`
**Decision:** Store all worktrees in a `.worktrees/` directory at repo root, with taskId as subdirectory name.

**Rationale:** Predictable location, easy to gitignore, taskId ensures uniqueness. Matches common conventions (like `.git`, `.vscode`).

**Alternatives considered:**
- System temp directory: Harder to find, varies by OS
- Configurable path: Over-engineering for v1

### 3. Branch naming matches taskId
**Decision:** Work branch name equals taskId (e.g., task `feat-auth` creates branch `feat-auth`).

**Rationale:** Simple 1:1 mapping, easy to understand, no translation layer needed.

**Alternatives considered:**
- Prefixed branches (`aop/feat-auth`): Adds complexity, unclear benefit

### 4. Squash merge creates new PR branch
**Decision:** `squashMerge` creates a new branch (targetBranch) from the original base, then squash-merges the work branch into it.

**Rationale:** Keeps work branch intact for reference, gives user a clean single-commit branch for PR. User controls the final destination.

**Mechanism:**
```bash
git checkout -b <targetBranch> <baseCommit>   # Create PR branch from original base
git merge --squash <workBranch>               # Stage all changes as single commit
git commit -m "<message>"                     # Commit with user's message
```

### 5. Throw on conflicts, don't resolve
**Decision:** `squashMerge` throws `GitConflictError` with list of conflicting files. Does not attempt resolution.

**Rationale:** Conflict resolution is complex and context-dependent. Orchestrator can dispatch a specialized agent for this. Keeps git-manager focused.

### 6. Auto-initialize on first createWorktree
**Decision:** First `createWorktree` call automatically creates `.worktrees/` directory and adds it to `.gitignore` if not present.

**Rationale:** Zero setup friction. Idempotent - safe to run multiple times.

## Risks / Trade-offs

**[Git version compatibility]** → Worktree support requires git 2.5+ (2015). Mitigation: Document minimum version, fail fast with clear error.

**[Dirty worktree on remove]** → User might have uncommitted changes. Mitigation: Check for uncommitted changes before remove, throw if dirty.

**[Stale worktrees]** → Crashed agents may leave orphan worktrees. Mitigation: CLI tracks worktrees in SQLite, can garbage collect orphans.

**[Large repos]** → Worktree creation is fast (no clone), but initial checkout of large repos still takes time. Mitigation: Acceptable trade-off, still faster than alternatives.

## Open Questions

- Should `removeWorktree` have a `force` option to delete even with uncommitted changes?
- Should we validate that taskId is a valid branch name before creating?

---

## Refactoring: Single Responsibility Components

### 7. Decompose GitManager into SRP modules
**Decision:** Split the monolithic `GitManager` class into focused, single-responsibility modules.

**Rationale:** The current 273-line class handles 6 distinct concerns: command execution, branch operations, worktree lifecycle, merge operations, metadata persistence, and filesystem setup. This violates SRP and makes the code harder to test, maintain, and extend. AOP conventions target max 300 lines per file, but more importantly, each module should have one reason to change.

**New Module Structure:**

| Module | Responsibility | ~Lines |
|--------|---------------|--------|
| `git-executor.ts` | Low-level git command execution via `Bun.$` | ~30 |
| `branch-ops.ts` | Branch existence checks and validation | ~25 |
| `worktree-ops.ts` | Worktree create/remove lifecycle | ~60 |
| `merge-ops.ts` | Squash merge, conflict detection, abort | ~70 |
| `metadata.ts` | Worktree metadata persistence | ~40 |
| `git-manager.ts` | Thin facade composing services | ~50 |

**Alternatives considered:**
- Keep monolithic class: Violates SRP, harder to test individual concerns
- Over-decompose (one class per function): Too granular, adds unnecessary indirection

### 8. Dependency injection for testability
**Decision:** Each module receives its dependencies (executor, paths) via constructor/options rather than creating them internally.

**Rationale:** Enables unit testing without touching the filesystem. Mock the executor to test branch-ops logic in isolation.
