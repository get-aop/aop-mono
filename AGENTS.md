# Coding Guidelines

- **General**:
  - We are in 2026. When adding or updating dependencies, always consider using the latest stable versions of packages.
  - Follow newspaper style (Clean Code): main/public functions at top, private helpers below
  - Write small, focused functions with a single responsibilityls
  - Avoid self-explanatory comments. Comments should explain why the code is doing something, not what the code is doing. Public interfaces should be documented accordingly.
- **golang**:
  - Standard Go Idioms
  - Interfaces defined where they're consumed, not where implemented
  - Consume interfaces, return structs
- **JavaScript/TypeScript**:
  - Modern ES6+ features
  - Use arrow functions
  - Strict TypeScript configuration
  - Maintain CommonJS/ESM compatibility

IMPORTANT! After a set of changes, make sure to update existing and create new relevant tests and make sure all of them are passing.

Follow the repo guidelines to run tests, builds and correct way of verifying changes. If not found, ask the user.

# Git

- **Never** push any commits unless explicitly asked
- Only make code changes and let the user handle all git operations
- Same for writing operations on external systems (eg. never create a Linear Ticket, GitHub issue, POST/PATCH to APIs), unless explicitly asked.

## Repo Skills

This repository vendors a small repo-owned AOP skill bundle locally so task workflows do not depend on globally installed skills.

Canonical skill paths:
- `.claude/skills/aop-brainstorming/SKILL.md`
- `.claude/skills/aop-create-task/SKILL.md`
- `.claude/skills/aop-task-planner/SKILL.md`
- `.claude/skills/aop-task-review/SKILL.md`
- `.claude/skills/aop-code-review/SKILL.md`
- `.claude/skills/aop-remove-ai-slop/SKILL.md`
- `.claude/skills/aop-systematic-debugging/SKILL.md`
- `.claude/skills/aop-test-driven-development/SKILL.md`

Matching copies also live under `.codex/skills/` for Codex-based runs.
