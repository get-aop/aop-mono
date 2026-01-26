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