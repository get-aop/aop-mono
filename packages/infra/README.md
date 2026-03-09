# @aop/infra

Infrastructure layer providing shared utilities for AOP packages and apps.

## Modules

### Logger

Structured logging with pretty console output for development and JSON format for production/servers. Supports file sinks for persistent logging.

```ts
import { configureLogging, getLogger } from "@aop/infra";

// Configure once at app startup
await configureLogging(); // pretty format (default)
await configureLogging({ format: "json" }); // for servers
await configureLogging({ level: "info" }); // custom level

// Get a logger with hierarchical categories
const logger = getLogger("aop", "orchestrator");

// Log with template literals - {placeholder} gets replaced
logger.info("Task {taskId} assigned to agent {agentId}", {
  taskId: "task-7f3a",
  agentId: "agent-12",
});

logger.error("Connection failed: {error}", { error: new Error("timeout") });

// Use .with() for persistent context
const log = logger.with({ taskId: "task-7f3a" });
log.info("Starting execution");  // taskId included automatically
log.info("Worktree created");    // taskId included automatically
```

**Pretty format** (development):
```
17:09:53.625  ✨ info    aop·orchestrator  Task 'task-7f3a' assigned to agent 'agent-12'
                                          taskId: 'task-7f3a'
                                          agentId: 'agent-12'
```

**JSON format** (production):
```json
{"@timestamp":"2026-02-01T17:09:53.632Z","level":"INFO","message":"Task 'task-7f3a' assigned to agent 'agent-12'","logger":"aop.orchestrator","taskId":"task-7f3a","agentId":"agent-12"}
```

#### File Logging

Write logs to files in addition to (or instead of) console:

```ts
await configureLogging({
  level: "info",
  sinks: {
    console: true,
    files: [
      { path: "./logs/app.jsonl", format: "json" },
      { path: "./logs/app.log", format: "pretty" },
    ],
  },
});
```

### TypeID

Type-safe prefixed IDs using the TypeID specification:

```ts
import { generateTypeId } from "@aop/infra";

const taskId = generateTypeId("task");    // "task_01h455vb4pex5vsknk084sn02q"
const repoId = generateTypeId("repo");    // "repo_01h455vb4pex5vsknk084sn02r"
const execId = generateTypeId("exec");    // "exec_01h455vb4pex5vsknk084sn02s"
```

## Scripts

```bash
bun run build      # Build the package
bun run typecheck  # Run TypeScript type checking
```
