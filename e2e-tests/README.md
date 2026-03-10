# @aop/e2e-tests

End-to-end tests for the AOP CLI. These tests exercise the full system with real AI agents.

## Test Cases

### Task Execution
- **automatic-handoff.e2e.ts**: Tests the orchestrator-owned flow from `task:ready` through automatic DONE handoff into the main repo branch

### Local Server Lifecycle
- **local-server.e2e.ts**: Tests local server start/stop lifecycle, health checks, graceful shutdown

### Backlog Management
- **backlog.e2e.ts**: Tests full task flow from DRAFT to READY to DONE through the queue processor, including automatic worktree handoff
- **concurrency.e2e.ts**: Tests global concurrency limit enforcement across multiple repositories

## Running Tests

```bash
# From repository root
bun run test:e2e

# Specific test
bun test ./src/local-server.e2e.ts
```

## Logging

E2E tests set `AOP_LOG_DIR=./tmp` which causes the CLI to write logs to:
- `./tmp/aop-<timestamp>.jsonl` - JSON Lines format for parsing
- `./tmp/aop-<timestamp>.log` - Pretty format for reading

Agent output streams to stdout in real-time during test execution.

## Test Fixtures

Located in `fixtures/`, these provide sample task document artifacts for testing:

| Fixture | Purpose |
|---------|---------|
| `cli-greeting-command/` | Simple greeting command implementation (proposal, design, tasks) |
| `backlog-test/` | Basic task for backlog flow testing |
| `concurrency-test-1/` | First repo for concurrency limit testing |
| `concurrency-test-2/` | Second repo for concurrency limit testing |

## Test Utilities

The `src/utils.ts` module provides shared helpers:

- `createTestRepo()`: Creates temporary git repository with repo-local task document structure
- `copyFixture()`: Copies fixture files into test repo
- `runAopCommand()`: Executes CLI commands with proper environment
- `waitForTaskStatus()`: Polls task status until condition met
- `cleanupTestRepo()`: Removes temporary test artifacts

## Environment Variables

Tests use isolated environments via:

| Variable | Test Value |
|----------|------------|
| `AOP_DB_PATH` | Unique temp path per test |
| `AOP_PID_FILE` | Unique temp path per test |
| `AOP_LOG_DIR` | `./tmp` |

## Notes

- E2E tests use **real agents** - they are not mocked
- Tests create temporary git repositories in `/tmp/aop-e2e-test/`
- Timeout is 5-10 minutes per test to allow for agent execution
- Cleanup happens automatically after tests complete
- Tests are skipped in CI unless Claude CLI is available
