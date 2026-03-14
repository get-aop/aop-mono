---
title: Add orchestration event spine and projected status foundation
status: PENDING
dependencies: []
---

### Description
Implement the first execution slice by introducing explicit orchestration commands, persisted domain events, and idempotency receipts for task claim, step lifecycle, pause, block, retry, resume, and runtime failure transitions. Add projection tables and a snapshot query layer so task, execution, step, dependency, and activity state can be served from durable read models instead of stitching together hot tables and in-memory state.

### Context
Relevant starting points are `apps/local-server/src/orchestrator/queue/processor.ts`, `apps/local-server/src/orchestrator/orchestrator.ts`, `apps/local-server/src/workflow/service.ts`, `apps/local-server/src/status/handlers.ts`, `apps/local-server/src/events/task-events.ts`, `apps/local-server/src/db/schema.ts`, and `apps/local-server/src/db/migrations.ts`. This slice should keep the repo-local task doc workflow intact while creating a single orchestration write path that later reactors can subscribe to.

### Result
The local server has an AOP-owned orchestration command and event model, durable storage for events and receipts, projection-backed status reads, and compatibility shims so existing status/SSE consumers continue working while the runtime migrates onto the new spine.

### Review
Confirm the command and event taxonomy covers current queue, workflow, executor, recovery, and manual resume paths without ambiguous ownership. Check that status endpoints and SSE initialization read from the projection layer rather than recomputing execution state ad hoc.

### Blockers
Final projection shape should be agreed before wiring dashboard-facing fields into `packages/common` so the first schema migration does not immediately churn.
