---
name: aop:audit-changes
description: Audit code changes to fit naturally into the codebase. Use after a POC works but before code review. Audit changes to find opportunities to adopt codebase patterns, eliminates duplication, removes dead code, and follows CLAUDE.md conventions. Triggers on /aop:audit-changes, "audit the changes".
---

# Audit Changes

Audit code changes to find issues that need to be fixed to fit naturally into the codebase.

## Audit Phase

1. Get diff: 
  - `git diff $(git merge-base HEAD <target_branch>)...HEAD` 
  - **PLUS** uncommitted changes
2. Extract new/modified symbols (types, functions, classes, exports, etc.)
3. Search codebase for each category below

**First:** Read CLAUDE.md (or AGENTS.md) to understand repo conventions.

Imagine the above changes is a proof of concept written in a rush. Now that it works, refine it to match codebase standards, patterns, and conventions.

### Audit categories

#### Duplication

| Category | Look for | Discovery heuristic |
|----------|----------|---------------------|
| Type duplication | Types defined in multiple places, or duplicating shared packages | Search type names from diff across codebase |
| Function duplication | Functions similar to existing utilities | Search function names/signatures in existing code |

```typescript
// Type duplication: TaskStatus defined here AND in @shared/types
type TaskStatus = 'pending' | 'running' | 'done';

// Function duplication: formatDate() exists in utils/date.ts
const formatDate = (d: Date) => d.toISOString().split('T')[0];
```

#### Dead/Incomplete Code

| Category | Look for | Discovery heuristic |
|----------|----------|---------------------|
| Dead code | Unused exports, orphaned functions, unreachable code | Grep for export usages, check import graphs |
| Incomplete implementation | Stubs, TODOs, placeholder logic, unwired code | Search for TODO, FIXME, NotImplemented, empty functions |

```typescript
// Dead code: exported but never imported anywhere
export const legacyHelper = () => { ... };

// Incomplete implementation: placeholder that fakes success
const saveToDatabase = async (data) => {
  // TODO: implement actual save
  return { success: true };
};
```

#### Design Issues

| Category | Look for | Discovery heuristic |
|----------|----------|---------------------|
| Over-engineering | Abstractions used once, premature generalization | Count usages of new abstractions |
| Pattern inconsistency | New code differs from existing codebase patterns | Compare structure/style to similar existing files |
| Misplaced code | Test helpers in src/, production code in test/, config in lib/ | Check file paths against code purpose |
| Unnecessary re-exports | Types/functions re-exported without added value | Check if re-export is used externally or just import directly |
| Inconsistent tooling | Using different libs/tools when codebase has established conventions | Check imports against existing patterns (ORM, HTTP client, etc.) |

```typescript
// Over-engineering: factory used exactly once
const createUserValidator = (config: ValidatorConfig) => { ... };
const validator = createUserValidator(defaultConfig); // only usage

// Pattern inconsistency: codebase uses classes, this uses functions
// Existing: class UserService { async getUser() {} }
// New code: const getUser = async () => {} // breaks pattern

// Misplaced code: test mock helper in production file
// In src/services/sync.ts (should be in test-utils.ts or *.test.ts)
export const createMockServerSync = (overrides = {}): ServerSync => {
  return { authenticate: async () => ({ clientId: "test" }), ...overrides };
};

// Unnecessary re-export: just import directly where needed
// In my-module.ts
export type { TaskStatus } from "@aop/common/protocol"; // why re-export?
// Better: import { TaskStatus } from "@aop/common/protocol" in consumers

// Inconsistent tooling: codebase uses Kysely, but this shells out to psql
const queryDatabase = async <T>(query: string): Promise<T[]> => {
  const result = await Bun.$`psql ${url} -c ${query}`.quiet(); // why not Kysely?
  return parseRows(result.stdout);
};
// Better: use Kysely like the rest of the codebase
```

#### Violations

| Category | Look for | Discovery heuristic |
|----------|----------|---------------------|
| Convention violations | Anything violating project's CLAUDE.md/AGENTS.md rules | Read project docs, compare diff against stated rules |
| Testing violations | Mocks where disallowed, shallow assertions, missing coverage | Check test files against project testing rules |
| Unsafe type assertions without a TRULY VALID reason | `as any`, `as unknown as`, `@ts-ignore` in production code without a valid reason | Grep for type casts and suppressions in non-test files |

```typescript
// Convention violation: CLAUDE.md says "no default exports"
export default function handler() {} // violates convention

// Testing violation: mock in integration test
jest.mock('../database'); // mocking DB in integration test
test('saves user', () => {
  expect(true).toBe(true); // shallow assertion
});

// Unsafe type assertion: hiding type mismatch in production code
const result = data as unknown as ExpectedType; // why doesn't it match?

// @ts-ignore - silencing compiler instead of fixing the issue
// @ts-ignore
someCall(wrongType);
```

## Report Format

Report findings back in the following format:

```markdown
## Duplication
- [ ] `TaskStatus` in `api/types.ts` duplicates shared types package

## Dead/Incomplete Code
- [x] `formatDate()` in `utils.ts` unused (iter 1)

## Design Issues
- [ ] `createMockServerSync` in `src/sync/server-sync.ts` - move to test-utils.ts

## Violations
- [ ] `as unknown as ServerSync` in `src/api/handler.ts:45` - fix type mismatch

## Notes
- Kept `ClientManager` - used in 2 places, intentional
```
