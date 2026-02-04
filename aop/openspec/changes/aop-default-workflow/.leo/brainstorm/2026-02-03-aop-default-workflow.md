# AOP Default Workflow Design

Date: 2026-02-03

## Problem

The current aop-implement and aop-review skills rely on LLM prompt compliance to enforce workflow steps. LLMs often skip steps or deviate from the expected flow. With YAML-based workflow templates now available, we can enforce these patterns programmatically.

## Goals

1. Enforce chunked implementation (3-5 files at a time) to manage context
2. Include inline self-checks after each implementation chunk
3. Run thorough final review after all tasks complete
4. Support fix iterations with max 2 cycles before blocking
5. Remove AI slop and enforce quality standards programmatically

## Design

### Overall Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      IMPLEMENTATION PHASE                            │
│                                                                       │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐            │
│  │  implement  │────▶│ self-check  │────▶│  CHUNK_DONE │            │
│  │  (3-5 files)│     │  (inline)   │     │  or DONE?   │            │
│  └─────────────┘     └─────────────┘     └──────┬──────┘            │
│                                                  │                    │
│                 ┌───────────────────────────────┐│                    │
│                 │ CHUNK_DONE → loop back       ││                    │
│                 │ ALL_TASKS_DONE → continue    │▼                    │
│                 └───────────────────────────────┘                     │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      REVIEW PHASE                                    │
│                                                                       │
│  ┌──────────────┐     ┌────────────┐     ┌───────────────┐          │
│  │ full-review  │────▶│  PASSED?   │────▶│  __done__     │          │
│  │ (thorough)   │     └──────┬─────┘     └───────────────┘          │
│  └──────────────┘            │                                       │
│                              │ FAILED                                │
│                              ▼                                       │
│  ┌──────────────┐     ┌──────────────┐     ┌───────────────┐        │
│  │  fix-issues  │────▶│ quick-review │────▶│  max 2 iters  │        │
│  └──────────────┘     └──────────────┘     └───────┬───────┘        │
│                                                     │                 │
│                              still failing after 2 │                 │
│                                                     ▼                 │
│                                           ┌───────────────┐          │
│                                           │  __blocked__  │          │
│                                           └───────────────┘          │
└──────────────────────────────────────────────────────────────────────┘
```

### Design Decisions

1. **Prompt-based chunking**: Agent naturally works on cohesive chunks of 3-5 files based on task context
2. **Inline self-check**: Same session verifies chunk before signaling (faster, less context switching)
3. **Thorough final review**: Fresh context, comprehensive checks (code-review, verify, audit checklist)
4. **2 fix iteration max**: Fix → quick review → fix → full review → BLOCKED if still failing

### Steps and Signals

| Step | Type | Purpose | Signals |
|------|------|---------|---------|
| `implement` | implement | Work on next chunk (3-5 files), inline self-check, TDD where applicable | `CHUNK_DONE`, `ALL_TASKS_DONE` |
| `full-review` | review | Thorough aop-review: code-review, verify, audit checklist | `REVIEW_PASSED`, `REVIEW_FAILED` |
| `fix-issues` | implement | Address review findings from report | `FIX_COMPLETE` |
| `quick-review` | review | Verify fixes, includes AOP audit checklist | `REVIEW_PASSED`, `REVIEW_FAILED` |

### Iteration Logic

```
full-review (iter 0) → REVIEW_FAILED
    → fix-issues
    → quick-review (iter 1) → REVIEW_PASSED → __done__
                            → REVIEW_FAILED
                                → fix-issues
                                → full-review (iter 2) → REVIEW_PASSED → __done__
                                                       → REVIEW_FAILED → __blocked__
```

### Transition Table

| From | Signal | Iteration | To |
|------|--------|-----------|-----|
| `implement` | `CHUNK_DONE` | any | `implement` |
| `implement` | `ALL_TASKS_DONE` | any | `full-review` |
| `full-review` | `REVIEW_PASSED` | any | `__done__` |
| `full-review` | `REVIEW_FAILED` | 0, 1 | `fix-issues` |
| `full-review` | `REVIEW_FAILED` | 2 | `__blocked__` |
| `fix-issues` | `FIX_COMPLETE` | 1 | `quick-review` |
| `fix-issues` | `FIX_COMPLETE` | 2 | `full-review` |
| `quick-review` | `REVIEW_PASSED` | 1 | `__done__` |
| `quick-review` | `REVIEW_FAILED` | 1 | `fix-issues` (bumps to iter 2) |

## YAML Workflow Definition

```yaml
version: 1
name: aop-default
description: |
  Default AOP workflow: chunked implementation with inline self-checks,
  followed by thorough review with fix iterations. Enforces TDD, code
  quality, and removes AI slop programmatically.

settings:
  maxAttempts: 3  # Per-step retry on infrastructure failures

initialStep: implement

steps:
  # ============================================
  # IMPLEMENTATION PHASE
  # ============================================
  implement:
    id: implement
    type: implement
    promptTemplate: implement.md.hbs
    maxAttempts: 1
    signals:
      - CHUNK_DONE
      - ALL_TASKS_DONE
    transitions:
      - condition: CHUNK_DONE
        target: implement  # Loop: continue with next chunk
      - condition: ALL_TASKS_DONE
        target: full-review  # Done implementing, start review
      - condition: failure
        target: __blocked__

  # ============================================
  # REVIEW PHASE
  # ============================================
  full-review:
    id: full-review
    type: review
    promptTemplate: full-review.md.hbs
    maxAttempts: 1
    signals:
      - REVIEW_PASSED
      - REVIEW_FAILED
    transitions:
      - condition: REVIEW_PASSED
        target: __done__
      - condition: REVIEW_FAILED
        target: fix-issues
        maxIterations: 2  # After 2 fix cycles, block
        onMaxIterations: __blocked__
      - condition: failure
        target: __blocked__

  fix-issues:
    id: fix-issues
    type: implement
    promptTemplate: fix-issues.md.hbs
    maxAttempts: 1
    signals:
      - FIX_COMPLETE
    transitions:
      - condition: FIX_COMPLETE
        target: quick-review  # First fix → quick review
        afterIteration: 1
        thenTarget: full-review  # Second fix → full review
      - condition: failure
        target: __blocked__

  quick-review:
    id: quick-review
    type: review
    promptTemplate: quick-review.md.hbs
    maxAttempts: 1
    signals:
      - REVIEW_PASSED
      - REVIEW_FAILED
    transitions:
      - condition: REVIEW_PASSED
        target: __done__
      - condition: REVIEW_FAILED
        target: fix-issues  # Back to fix (bumps iteration)
      - condition: failure
        target: __blocked__

terminalStates:
  - __done__
  - __blocked__
```

## Prompt Templates

### implement.md.hbs

```handlebars
You are implementing a task in a software project.

## Context
- **Worktree**: {{worktree.path}} (branch: {{worktree.branch}})
- **Task**: {{task.id}}
- **Change**: {{task.changePath}}

## Instructions

Work on the **next cohesive chunk of tasks** (targeting 3-5 files). Follow this process:

### 1. Read Task Context
Read `tasks.md` in the change directory to understand remaining work.

### 2. Implement the Chunk
- Apply TDD for new code (functions, classes, modules)
- Skip TDD for: infrastructure/config, existing test files, frontend/UI, pure refactoring
- Wire up all functionality - no dangling TODOs
- Run verification commands (`bun run check` or equivalent)

### 3. Inline Self-Check
Before signaling, verify your chunk:
- [ ] Tests pass for new code
- [ ] No dead code introduced
- [ ] No excessive comments or defensive code
- [ ] Imports/exports connected
- [ ] Feature usable end-to-end (for the chunk)

### 4. Signal (REQUIRED)

When done with this chunk, output exactly ONE signal:

- `<aop>CHUNK_DONE</aop>` - Chunk complete, **more tasks remain** in tasks.md
- `<aop>ALL_TASKS_DONE</aop>` - **All tasks** in tasks.md are complete

**Important**: Check tasks.md before signaling. Only use ALL_TASKS_DONE when nothing remains.
```

### full-review.md.hbs

```handlebars
You are conducting a thorough code review for agent-generated code.

## Context
- **Worktree**: {{worktree.path}} (branch: {{worktree.branch}})
- **Task**: {{task.id}}
- **Change**: {{task.changePath}}
- **Review iteration**: {{step.iteration}} of 2

## Review Process

Execute ALL checks, then signal result.

### 1. Code Review
Run `/code-review` against the branch changes. Check:
- Code quality and test coverage
- Security and performance concerns
- Repository pattern conformance

### 2. Verify Implementation
Run `/opsx:verify {{task.changePath}}` to confirm:
- All tasks fully implemented per change artifacts
- Features wired properly, no dangling TODOs
- Exports/imports connected

### 3. AOP Audit Checklist
Run `/aop:audit-changes` then evaluate:

**Structural**: Files < 500 lines, vertical slices maintained
**Quality**: Tests colocated and passing, no dead code, comments explain "why"
**Conventions**: Follows existing patterns, lint/typecheck pass
**AI Slop**: No excessive comments, no unnecessary defensive code, no `any` casts

### 4. Write Report
Create `agent-review-report.md` next to `tasks.md` with findings.

### 5. Signal (REQUIRED)

- `<aop>REVIEW_PASSED</aop>` - All checks pass, ready for human review
- `<aop>REVIEW_FAILED</aop>` - Issues found (add remediation tasks to tasks.md)
```

### fix-issues.md.hbs

```handlebars
You are fixing issues identified in code review.

## Context
- **Worktree**: {{worktree.path}} (branch: {{worktree.branch}})
- **Task**: {{task.id}}
- **Change**: {{task.changePath}}

## Instructions

### 1. Read Review Report
Read `agent-review-report.md` next to `tasks.md` to understand the issues.

### 2. Address Each Finding
Work through each issue systematically:
- Fix code quality issues
- Add missing tests
- Remove AI slop (excessive comments, defensive code, `any` casts)
- Ensure patterns match codebase conventions

### 3. Run Verification
- Run `bun run check` (or equivalent)
- Ensure all tests pass
- Verify the fixes address the reported issues

### 4. Signal (REQUIRED)

When all issues are addressed:

`<aop>FIX_COMPLETE</aop>`
```

### quick-review.md.hbs

```handlebars
You are verifying that review findings have been addressed.

## Context
- **Worktree**: {{worktree.path}} (branch: {{worktree.branch}})
- **Task**: {{task.id}}
- **Change**: {{task.changePath}}
- **Review iteration**: {{step.iteration}} of 2

## Instructions

### 1. Check Previous Report
Read `agent-review-report.md` and verify each issue from the previous review was addressed.

### 2. Run Verification
- Run `bun run check` (lint, typecheck, tests)
- All tests must pass

### 3. AOP Audit Checklist
Evaluate the current changes against:

**Structural**: Files < 500 lines, vertical slices maintained
**Quality**: Tests colocated and passing, no dead code, comments explain "why"
**Conventions**: Follows existing patterns, lint/typecheck pass
**AI Slop**: No excessive comments, no unnecessary defensive code, no `any` casts

### 4. Update Report
Update `agent-review-report.md`:
- Add "Iteration {{step.iteration}} Review" section
- Note which previous issues were fixed
- Note any NEW or REMAINING issues found

### 5. Signal (REQUIRED)

- `<aop>REVIEW_PASSED</aop>` - All previous issues fixed AND audit checklist passes
- `<aop>REVIEW_FAILED</aop>` - Issues remain or new issues found (must be documented in report)

**Important**: If you signal REVIEW_FAILED, the report MUST contain the specific issues that need to be addressed.
```

## Implementation Notes

### Files to Create/Modify

1. `apps/server/workflows/aop-default.yaml` - The workflow definition
2. `apps/server/src/prompts/templates/implement.md.hbs` - Replace existing with chunked version
3. `apps/server/src/prompts/templates/full-review.md.hbs` - New template (thorough review)
4. `apps/server/src/prompts/templates/fix-issues.md.hbs` - New template
5. `apps/server/src/prompts/templates/quick-review.md.hbs` - New template

### Workflow Engine Enhancements Needed

The current workflow engine schema supports basic `maxIterations` but may need enhancements for:

1. **`afterIteration` conditional routing**: First fix → quick-review, second fix → full-review
2. **`step.iteration` variable injection**: Pass iteration count to prompt templates
3. **Iteration tracking across related steps**: `full-review` and `quick-review` share the same iteration counter

### Alternative: Simpler Iteration Model

If `afterIteration` is complex to implement, consider a simpler model where:
- `fix-issues` always goes to `quick-review`
- `quick-review` FAILED always goes back to `fix-issues`
- Track iteration globally, block after 2 `quick-review` failures

This removes the "second fix goes to full-review" complexity at the cost of less thorough final verification.
