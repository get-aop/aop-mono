---
title: Benchmark Filter By Tag
status: DRAFT
created: 2026-03-13T00:00:00.000Z
priority: medium
tags:
  - benchmark
  - notes-cli
dependencies: []
source:
  provider: linear
  id: benchmark-filter-by-tag
  ref: BENCH-1
  url: https://linear.app/aop/issue/BENCH-1/filter-notes-by-tag
dependencySources: []
---

## Description

Add tag-based note filtering to the shared notes helpers so downstream callers can request only the notes for a specific tag without changing the plain report behavior for the full note set.

## Requirements

- Keep `parseNotes` unchanged as the parser entrypoint in `src/notes.ts`.
- Add reusable note filtering behavior in the source layer via a new helper.
- Cover the filtering behavior with focused tests.
- Keep existing plain report output unchanged when no filter is applied.

## Acceptance Criteria

- [ ] A note collection can be filtered by tag without mutating the original list.
- [ ] Filtering returns only notes that contain the requested tag.
- [ ] `parseNotes` remains the parser export from `src/notes.ts`.
- [ ] Existing parse and plain report behavior still passes its tests.
