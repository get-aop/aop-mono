## Context

This is the first package in the AOP monorepo. It establishes patterns for how shared infrastructure will be structured and consumed by apps.

## Goals / Non-Goals

**Goals:**
- Thin wrapper around logtape that's easy to use
- Zero configuration required for library consumers (loggers work as no-ops until configured)
- Single point of configuration for applications
- Sensible defaults so `configureLogging()` works out of the box

**Non-Goals:**
- Custom log transports (use logtape's built-in sinks)
- Log aggregation or shipping (that's infrastructure, not code)
- Structured logging schema enforcement (keep it flexible)

## Decisions

### Decision 1: Wrap logtape, don't abstract it

We'll expose logtape's `Logger` type directly rather than creating our own interface. This keeps the API familiar to logtape users and avoids maintaining a parallel abstraction.

```typescript
import { getLogger } from "@aop/infra";
const logger = getLogger("aop", "orchestrator");
logger.info("Task started", { taskId });
```

### Decision 2: Configuration with sensible defaults

Apps call `configureLogging()` once at startup. With no arguments, it just works:

```typescript
// Simplest usage - console output at "debug" level
import { configureLogging } from "@aop/infra";
configureLogging();
```

**Default options:**
- `level`: `"debug"` — show everything during development
- `sinks.console`: `true` — output to console by default
- `format`: `"pretty"` — human-readable with colors (falls back to plain in browsers)

```typescript
// Override only what you need
configureLogging({ level: "info" }); // less verbose
configureLogging({ format: "json" }); // structured output for production
```

### Decision 3: Package structure

```
packages/infra/
├── src/
│   ├── index.ts      # Re-exports public API
│   └── logger.ts     # Logger implementation
├── package.json
└── tsconfig.json
```
