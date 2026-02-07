## Code Review: Global AOP Paths Architecture (Iteration 2)

**Date**: 2026-02-06
**Branch**: task_01kgrvk95mecz8pard6t1n9k0e
**Change Path**: /home/eng/Workspace/my-agent/aop/openspec/changes/global-aop-paths
**Scope**: 34 files (28 modified + 6 new), ~846 lines changed (346 added, 500 removed)
**Mode**: git diff (unstaged changes vs main)

### Summary

This change centralizes AOP-managed directories under `~/.aop/repos/<repoId>/` instead of storing them inside user repositories. Key components:

1. **`aopPaths` module** (`@aop/infra`): Single source of truth for all path resolution
2. **`GitManager` refactor**: Accepts `repoId`, creates worktrees at global paths
3. **Env file sync**: Discovers and symlinks `.env*` files into worktrees
4. **Watcher/reconciler**: Watches global paths with repo-local fallback + auto-relocation
5. **Dead code removal**: `resolveTaskByChangePath` and path-based task resolution removed
6. **E2E test suite**: New `global-paths.e2e.ts` covering full lifecycle

### Previous Review Findings (Iteration 1) — Resolution

| # | Finding | Status |
|---|---------|--------|
| 1 | Unused `_repoRepository` parameter in `resolve.ts` | **FIXED** — parameter removed, function simplified to 2 params |
| 2 | 11 new `noNonNullAssertion` lint warnings | **FIXED** — `getRepo` helper with throw guard, no `!` assertions |
| 3 | `reconcileAllRepos` function untested | **FIXED** — 2 new tests: multi-repo aggregation + empty repos |

### Verification

- **Lint**: `biome check` — 296 files checked, no issues ✅
- **Type checking**: All 10 packages pass ✅
- **Build**: All packages build successfully ✅
- **Tests**: 1011 tests pass, 0 failures, 2273 assertions ✅
- **Coverage**: 98.87% functions, 98.62% lines — all new files at 100% ✅

### Findings

No significant issues found (confidence ≥80).

### AOP Audit Checklist

- [x] **DRY**: No duplicated types or utilities — `aopPaths` properly centralizes all path logic
- [x] **Dead code**: No unused functions, imports, or parameters
- [x] **AI slop**: No unnecessary comments, over-defensive code, or style inconsistencies
- [x] **Data flow**: Follows established patterns — thin routes → services → repositories
- [x] **Function responsibility**: All functions have single responsibility
- [x] **Naming**: Clear and consistent (`aopPaths`, `syncEnvFiles`, `discoverEnvFiles`, `reconcileRepo`)
- [x] **Error handling**: Appropriate — symlink errors surface, discovery failures return empty, relocation handles conflicts
- [x] **Lint compliance**: Zero lint warnings/errors
- [x] **Tests colocated**: All tests properly colocated next to implementation
- [x] **Security**: No secrets, proper `validateTaskId` for path traversal protection, no injection vectors
- [x] **Performance**: Efficient — Set-based lookups in reconciler, parallel git commands in env discovery

### Good Patterns Observed

- Clean `aopPaths` API with 100% test coverage (8 path resolvers, 8 tests)
- Proper `cpSync` + `rmSync` for cross-device moves (avoids EXDEV errors)
- Env file discovery handles tracked + untracked with deduplication via Set
- Reconciler relocates before scanning — correct ordering prevents missed changes
- Tests clean up global dirs in `afterEach` — no filesystem leakage
- E2E test covers full lifecycle: registration → relocation → task creation → worktree → env sync → cleanup verification
- `reconcileAllRepos` tested with multi-repo aggregation
- Net reduction of 154 lines — cleaner codebase
- Removed dead `resolveTaskByChangePath` code path cleanly (no backwards-compatibility hacks)

### Summary

- **Critical**: 0 issues
- **Quality**: All 3 previous findings resolved
- **Test coverage**: Excellent — 100% on all new files, comprehensive scenarios including E2E
- **Security**: No concerns
- **Performance**: No concerns
- **Recommendation**: Approve
