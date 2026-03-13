---
title: Benchmark Pretty Summary
status: DRAFT
created: 2026-03-13T00:00:00.000Z
priority: medium
tags:
  - benchmark
  - notes-cli
dependencies: []
source:
  provider: linear
  id: benchmark-pretty-summary
  ref: BENCH-2
  url: https://linear.app/aop/issue/BENCH-2/render-pretty-summary
dependencySources: []
---

## Description

Add a richer pretty summary renderer that groups notes by status, reports counts, and includes tags in the rendered output so the CLI can provide a more reviewable report mode.

## Requirements

- Keep `renderPlainReport` unchanged as the plain renderer export from `src/report.ts`.
- Add a new `renderPrettyReport` renderer alongside the plain renderer.
- Include per-status counts and readable note lines in the output.
- Cover the pretty renderer with focused tests.

## Acceptance Criteria

- [ ] Pretty output groups notes by status.
- [ ] Pretty output includes counts for todo, doing, and done notes.
- [ ] Pretty output includes tags for each rendered note.
- [ ] `renderPlainReport` remains available with the same output behavior for the existing tests.
