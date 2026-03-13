# Notes CLI Benchmark Scenario

This repository is the live benchmark fixture for AOP.

## Goal

Implement three related task folders under `docs/tasks/`:

1. `benchmark-filter-by-tag`
2. `benchmark-pretty-summary`
3. `benchmark-cli-report`

The first two tasks are independent and should be able to run in parallel. The third depends on both.

## Task Boundaries

- `BENCH-1` owns `src/notes.ts` and `tests/notes.test.ts`
- `BENCH-2` owns `src/report.ts` and `tests/report.test.ts`
- `BENCH-3` owns `src/cli.ts` and `tests/cli.test.ts`

Treat those boundaries as part of the benchmark design. Do not move independent task work into another task's files unless the task docs explicitly require it.

## Success Condition

- `bun test` passes
- all three task folders reach `status: DONE`
- the implementation stays within the intended source/test/task-doc files
- existing public entrypoints stay stable:
  - `parseNotes` remains the parser export from `src/notes.ts`
  - `renderPlainReport` remains the plain renderer export from `src/report.ts`
  - `runCli(args, inputOverride?)` remains the CLI entrypoint in `src/cli.ts`

## Repository Shape

- `src/notes.ts` parses the note input format
- `src/report.ts` renders the report output
- `src/cli.ts` exposes the CLI entrypoint
- `tests/` contains the repo verification harness
