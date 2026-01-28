---
name: code-review
description: Review implementation changes for code quality, test coverage, security issues, performance concerns, and conformance to repository patterns. Use when user requests a code review, asks to review changes, review a PR, or check implementation quality. Supports git diff-based review (uncommitted changes, branch comparisons) and GitHub PR review via gh CLI.
---

# Code Review

Review implementation changes and produce a checklist of findings with confidence scores. Only report issues with confidence ≥80.

## Review Modes

**Git diff mode** (default): Review uncommitted changes or compare branches.
```bash
git diff                    # unstaged changes
git diff --staged           # staged changes
git diff main...HEAD        # current branch vs main
```

**PR mode**: Review pull request via GitHub CLI.
```bash
gh pr diff <number>
gh pr view <number> --json files,additions,deletions
```

## Review Process

1. **Gather context**: Read repository guidelines (AGENT.md, CLAUDE.md, CONTRIBUTING.md, etc.)
2. **Get the diff**: Use appropriate mode to retrieve changes
3. **Read modified files**: Read full files for context, not just diff hunks
4. **Analyze against checklist**: Evaluate each category below
5. **Output findings**: Report issues ≥80 confidence only

## Review Checklist

### Code Quality (Q)
- [ ] Functions have single responsibility
- [ ] No code duplication (DRY violations)
- [ ] Clear naming (variables, functions, types)
- [ ] Appropriate error handling
- [ ] No dead code or commented-out blocks
- [ ] Consistent style with existing codebase

### Test Coverage (T) 
**Important**: If the code relates to a test-suite already, you don't need to add tests (eg writing helper functions for tests, e2e playwright etc).
- [ ] New code has corresponding tests
- [ ] Edge cases covered
- [ ] Tests actually assert behavior (not just run)
- [ ] Mocks/stubs used appropriately
- [ ] No flaky test patterns

### Security (S)
- [ ] No hardcoded secrets/credentials
- [ ] Input validation at boundaries
- [ ] No SQL/command injection vectors
- [ ] Proper authentication/authorization checks
- [ ] Sensitive data not logged
- [ ] Dependencies are trustworthy

### Performance (P)
- [ ] No N+1 query patterns
- [ ] Appropriate data structures used
- [ ] No unnecessary re-renders (frontend)
- [ ] Large operations are async/chunked
- [ ] No memory leaks (event listeners, subscriptions)

### Repository Conformance (R)
- [ ] Follows existing patterns in codebase
- [ ] Matches project architecture
- [ ] Uses established utilities/helpers
- [ ] Consistent with repo's error handling approach
- [ ] Adheres to CLAUDE.md / CONTRIBUTING.md guidelines

## Output Format

```markdown
## Code Review: [brief description]

**Scope**: [files reviewed count] files, [lines changed] lines
**Mode**: [git diff | PR #N]

### Findings

| # | Cat | Issue | Location | Confidence |
|---|-----|-------|----------|------------|
| 1 | S   | API key exposed in config | src/config.ts:42 | 95 |
| 2 | Q   | Duplicated validation logic | src/utils.ts:15, src/handlers.ts:88 | 85 |
| 3 | T   | Missing test for error path | src/api.ts:newEndpoint | 82 |

### Details

#### 1. API key exposed in config (S, 95)
**Location**: `src/config.ts:42`
**Issue**: Hardcoded API key should use environment variable.
**Suggestion**: Move to `.env` and access via `process.env.API_KEY`.

[... additional details for each finding ...]

### Summary
- **Critical**: [count] issues requiring immediate attention
- **Quality**: [brief assessment]
- **Test coverage**: [adequate | needs improvement | missing]
- **Recommendation**: [approve | approve with comments | request changes]
```

## Confidence Scoring

Score each finding 0-100 based on:
- **Evidence strength**: Is the issue clearly visible in the code? (+30)
- **Impact severity**: Could this cause bugs, security issues, or maintenance burden? (+30)
- **Context certainty**: Do you have enough context to be sure? (+20)
- **Pattern match**: Does this match known anti-patterns? (+20)

Only report findings with confidence ≥80. When uncertain, read more context before scoring.

## Guidelines

- Focus on meaningful issues, not style nitpicks (unless they violate repo standards)
- Consider the PR/change in context of the broader system
- Acknowledge good patterns when reviewing, but keep brief
- If no issues found ≥80 confidence, report "No significant issues found"
- For large changes, prioritize security and correctness over style
