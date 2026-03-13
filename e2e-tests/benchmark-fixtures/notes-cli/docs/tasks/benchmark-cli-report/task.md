---
title: Benchmark CLI Report
status: DRAFT
created: 2026-03-13T00:00:00.000Z
priority: medium
tags:
  - benchmark
  - notes-cli
dependencies: []
source:
  provider: linear
  id: benchmark-cli-report
  ref: BENCH-3
  url: https://linear.app/aop/issue/BENCH-3/wire-cli-report-options
dependencySources:
  - provider: linear
    id: benchmark-filter-by-tag
    ref: BENCH-1
  - provider: linear
    id: benchmark-pretty-summary
    ref: BENCH-2
---

## Description

Wire the new filtering and pretty rendering behavior into the CLI so the benchmark scenario exercises a real integration task that depends on the two independent library tasks.

## Requirements

- Keep `runCli(args, inputOverride?)` as the CLI entrypoint in `src/cli.ts`.
- Add `--tag <tag>` support to the CLI.
- Add `--format pretty` support to the CLI.
- Add integration tests for plain and pretty CLI flows.
- Keep the integration work isolated to `src/cli.ts` and `tests/cli.test.ts`.

## Acceptance Criteria

- [ ] The CLI can filter notes by tag.
- [ ] The CLI can render the pretty summary format.
- [ ] `runCli(args, inputOverride?)` still returns the existing `{ exitCode, stdout, stderr }` shape.
- [ ] CLI tests cover plain output, filtered output, and pretty output.
