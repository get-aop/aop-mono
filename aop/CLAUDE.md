# AOP - Agents Operating Platform

## Coding Conventions

Optimize for AI agent context windows (the 40% rule).

### Size Limits
- **Files**: Max 500 lines - split into focused modules if exceeded
- **Functions**: cyclomatic complexity under 10

### Architecture
- **Vertical slices**: Organize by domain, not technical layer (no `repositories/`, `services/`, `controllers/` folders)
- **Single responsibility**: Each module does one thing well
- **Newspaper style**: Public functions at top, private helpers below

### Data Flow (CRITICAL)
```
thin entrypoints (routes, commands, etc.) → domain services → repositories
```
- **Entrypoints** (routes, commands): ONLY parse input, call one service, return response
- **Services**: Business logic, orchestration
- **Repositories**: Data access only

Entrypoints must NEVER import repositories or contain business logic. If you're importing a repository into a route, create a service.

### Package Structure
```
apps/           # Apps (cli, server, dashboard)
packages/       # Shared code (common for types, infra for utilities)
```

Within apps, organize by domain:
```
apps/server/src/
  api/        # Routes (thin)
  db/         # Connection, migrations
  clients/    # Domain: service + repository
  tasks/      # Domain: service + repository
  executions/ # Domain: service + repository
  workflow/   # Domain: service + repository
```

### DRY
- **Shared types** live in `@aop/common` - never duplicate types between apps
- **Shared utilities** live in `@aop/infra` - check before creating new ones
- **Test helpers** go in colocated `test-utils.ts` - never copy-paste setup code
- One field per value - don't hold same reference in multiple fields

### Code Quality
- Tests colocated: `*.test.ts` next to `*.ts`
- No dead code - delete unused functions/imports
- Comments explain "why", not "what"
- `bun check` must pass before finishing
- Never disable lint rules

### Testing
- **Unit/Integration**: Real assertions on return values and state - no `expect(true).toBe(true)`
- **E2E**: Real agents, real API calls - never mock the agent
- **Repositories**: Integration tests with real database

## IMPORTANT!

**ALWAYS** verify your code changes after modifying code with `bun check` and `bun test:coverage`.
**IMPORTANT!** Do not skip this step.

---

## Reference

### Bun Runtime
Use Bun instead of Node.js: `bun`, `bun test`, `bun install`, `bunx`.

### Bun APIs
- `Bun.serve()` for HTTP/WebSocket (not express)
- `bun:sqlite` for SQLite (not better-sqlite3)
- `Bun.sql` for Postgres (not pg)
- `Bun.file` for file I/O (not fs)
- `Bun.$` for shell commands (not execa)

### Logging
Use `@aop/infra` logger with structured logging. Use `{placeholder}` syntax with properties object, never template literals. Use `logger.with()` for persistent context in a function scope.

### Frontend
Use `Bun.serve()` with HTML imports for React/CSS/Tailwind. No vite. See `node_modules/bun-types/docs/**.mdx` for details.
