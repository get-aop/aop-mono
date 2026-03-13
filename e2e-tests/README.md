# @aop/e2e-tests

End-to-end tests for the AOP CLI.

There are three benchmark/testing lanes:
- `bun run test:e2e`: deterministic orchestration coverage using the `e2e-fixture` provider
- `bun run test:e2e:codex-benchmark`: live AOP+Codex benchmark coverage on the benchmark fixture repo
- `bun run benchmark:codex:pure`: the same benchmark fixture run by a single Codex session without AOP orchestration

## Test Cases

### Task Execution
- **automatic-handoff.e2e.ts**: Tests the orchestrator-owned flow from `task:ready` through automatic DONE handoff into the main repo branch
- **real-concurrency.e2e.ts**: Tests three real repo tasks where two independent tasks run in parallel while a dependent task waits
- **linear-import.e2e.ts**: Tests multi-ticket Linear import with dependency-aware parallel execution and automatic handoff

### Live Benchmark
- **benchmark-fixtures/notes-cli/**: Small Bun/TypeScript CLI repo with three benchmark tasks: two independent library tasks and one dependent integration task

### Local Server Lifecycle
- **local-server.e2e.ts**: Tests local server start/stop lifecycle, health checks, graceful shutdown

### Backlog Management
- **backlog.e2e.ts**: Tests full task flow from DRAFT to READY to DONE through the queue processor, including automatic worktree handoff
- **concurrency.e2e.ts**: Tests global concurrency limit enforcement across multiple repositories

## Running Tests

```bash
# From repository root
bun run test:e2e

# Live AOP+Codex benchmark on the benchmark fixture repo
bun run test:e2e:codex-benchmark

# Pure Codex baseline on the same benchmark fixture repo
bun run benchmark:codex:pure

# Compare the latest AOP vs pure Codex benchmark results
bun run benchmark:codex:compare

# Specific test
bun test ./src/local-server.e2e.ts
```

The live Codex benchmark commands require:
- `codex` in `PATH`
- `~/.codex/auth.json` present

When a live benchmark succeeds it writes the run artifacts and JSON result to `~/.aop/benchmarks/`.

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
| `concurrency-test-3/` | Third repo fixture used as a dependent task in the real concurrency benchmark |
| `benchmark-fixtures/notes-cli/` | Live benchmark repo for AOP vs pure Codex comparisons |
| `linear-issues.json` | Deterministic Linear fixture data for multi-ticket import coverage |

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

- The default `test:e2e` suite does **not** use a live model; it uses the deterministic `e2e-fixture` provider so orchestration stays stable and repeatable.
- The dedicated Codex benchmark command uses a live model and is intended for benchmarking real end-to-end behavior.
- Tests create temporary git repositories in `/tmp/aop-e2e-test/`
- Timeout is 5-10 minutes per test to allow for agent execution
- Cleanup happens automatically after tests complete
