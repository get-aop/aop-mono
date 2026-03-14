---
title: Add deterministic orchestration harnesses and migration coverage
status: PENDING
dependencies: [1, 2, 3]
---

### Description
Build orchestration integration harnesses that run the local server runtime against repo fixtures, fake provider runtime events, SQLite state, and drainable workers so lifecycle assertions are deterministic. Cover the new event spine, projector updates, reactor flows, restart or recovery behavior, checkpoint or verification side effects, and provider readiness gating with both focused local-server tests and fixture-backed end-to-end regressions.

### Context
Current coverage anchors include `apps/local-server/src/orchestrator/queue/processor.test.ts`, `apps/local-server/src/executor/recovery.test.ts`, `apps/local-server/src/orchestrator/orchestrator.test.ts`, `apps/local-server/src/workflow/service.test.ts`, and `e2e-tests/src/backlog.e2e.ts` plus `e2e-tests/src/concurrency.e2e.ts`. The `packages/llm-provider/src/providers/e2e-fixture.ts` provider is a good base for deterministic execution, but it will need extension to emit canonical runtime activities instead of only terminal fixture logs.

### Result
The orchestration upgrade ships with deterministic tests that prove claim idempotency, projection correctness, runtime ingestion, session recovery, readiness gating, and queue or reactor lifecycle behavior across restart scenarios.

### Review
Prefer harnesses that can drain and assert on emitted events rather than sleeping on timers. Check that the verification suite fails when projections, receipts, or recovery semantics regress, not only when terminal task status changes.

### Blockers
If the new reactors rely on background timers or unmanaged listeners, the harness will become flaky; drainable worker controls should be treated as part of the deliverable, not incidental test scaffolding.
