---
name: aop:review
description: Comprehensive code review for agent-generated code. Runs code-review, verifies implementation completeness via opsx:verify, and checks AOP quality standards (file size, function size, tests, conventions, AI slop). Use when reviewing agent work, verifying implementation quality, or before merging changes.
---

# AOP Review

Verify agent-generated code meets quality standards.

## Arguments

```
/aop:review {{change}}
```

`change` is optional. If omitted, review current changes.

## Workflow

Execute ALL steps, then output the required signal at the end.

**IMPORTANT**: Execute ALL 5 steps in sequence. Do NOT end the session early.

**Copy this tracker into your response and update as you complete each step:**

AOP Review Progress:
[ ] Step 1: Code Review - /code-review executed
[ ] Step 2: Verification - /opsx:verify executed
[ ] Step 3: AOP Checklist - all items evaluated
[ ] Step 4: Report Written - agent-review-report.md created
[ ] Step 5: Signal Output - REVIEW_PASSED or REVIEW_FAILED

### 1. Run Code Review

Execute `/code-review against the base of opened pr, or the current branch if no pr is opened -- always include ALL files in the git diff as well` to analyze:
- Code quality
- Test coverage
- Security issues
- Performance concerns
- Repository conformance

**Gate**: Mark Step 1 complete in tracker. Do not proceed until code review output is visible.

**Continue to Step 2**

### 2. Verify Implementation

Execute `/opsx:verify {{change}}` to confirm:
- All tasks fully implemented according to change artifacts (design, proposal, specs)
- Features wired properly
- No dangling TODOs
- Exports/imports connected

**Gate**: Mark Step 2 complete in tracker. Do not proceed until verification output is visible.

**Continue to Step 3**

### 3. AOP Checklist

Evaluate against these criteria:

#### Structural
- [ ] No file exceeds 300 lines
- [ ] No function exceeds 50 lines
- [ ] Vertical slice structure maintained
- [ ] No duplicate filenames introduced

#### Quality
- [ ] Tests colocated and passing
- [ ] No dead code introduced
- [ ] Comments explain "why" not "what"
- [ ] No abbreviations in new code

#### Documentation
- [ ] README updated if feature changed
- [ ] Public APIs have type definitions
- [ ] Complex logic has explanatory comments

#### Conventions
- [ ] Follows existing patterns in codebase
- [ ] Lint passes
- [ ] Type check passes

#### No AI Slop
- [ ] No excessive comments that a human wouldn't add
- [ ] No excessive defensive checks or try/catch blocks
- [ ] No casts to `any` to work around type issues
- [ ] Style consistent with the rest of the file

**Gate**: Mark Step 3 complete in tracker. Do not proceed until all AOP checklist items are evaluated.

**Continue to Step 4**

### 4. Write Report

Create `agent-review-report.md` next to the `tasks.md` file containing:
1. Code review findings
2. Verification results
3. Checklist with pass/fail for each item

**Gate**: Mark Step 4 complete in tracker. Do not proceed until report is created.

**Continue to Step 5**

### 5. Output Signal (REQUIRED)

**You MUST end with one of these signals on its own line:**

If all checks pass:
```
<aop>REVIEW_PASSED</aop>
```

If any checks fail:
1. Add remediation tasks to `tasks.md` addressing failures
2. Output:
```
<aop>REVIEW_FAILED</aop>
```
