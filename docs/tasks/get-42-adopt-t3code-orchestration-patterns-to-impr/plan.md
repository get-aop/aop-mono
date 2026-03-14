---
status: INPROGRESS
task: get-42-adopt-t3code-orchestration-patterns-to-impr
created: 2026-03-14T06:19:28Z
---

## Summary

This plan upgrades AOP's local-server runtime from a queue-plus-recursive executor into an explicit orchestration system with durable events, projected reads, and recoverable provider session state. The implementation starts with an event spine and read model foundation, then layers provider runtime normalization, dedicated reactors, readiness/recovery hardening, and deterministic orchestration harnesses.

## Context

Primary planning inputs were `docs/tasks/get-42-adopt-t3code-orchestration-patterns-to-impr/task.md`, `docs/superpowers/research/2026-03-13-t3code-investigation-log.md`, and `docs/superpowers/research/2026-03-13-t3code-aop-recommendations.md`.

Codebase exploration showed that AOP currently coordinates execution through direct calls across `apps/local-server/src/orchestrator/orchestrator.ts`, `apps/local-server/src/orchestrator/queue/processor.ts`, `apps/local-server/src/workflow/service.ts`, `apps/local-server/src/executor/executor.ts`, `apps/local-server/src/executor/recovery.ts`, and `apps/local-server/src/status/handlers.ts`. SQLite schema in `apps/local-server/src/db/schema.ts` and `apps/local-server/src/db/migrations.ts` has task/execution tables but no orchestration event store, receipts, projection tables, or persisted provider binding state. `packages/llm-provider` already exposes raw provider JSON lines, inferred outcomes, and session IDs, which is enough to define a canonical AOP runtime event layer, but the provider interface does not yet expose a durable runtime event stream or readiness contract.

## Subtasks

1. 001-event-spine-projections (Add orchestration event spine and projected status foundation)
2. 002-runtime-normalization-reactors (Normalize provider runtime events and split reactors) -> depends on: 1
3. 003-recovery-readiness-hardening (Persist recovery state and add provider readiness hardening) -> depends on: 1, 2
4. 004-deterministic-orchestration-harnesses (Add deterministic orchestration harnesses and migration coverage) -> depends on: 1, 2, 3

## Verification

- [ ] `bun test apps/local-server`
- [ ] `bun run --filter @aop/local-server typecheck`
- [ ] `bun run --filter @aop/local-server build`
- [ ] `bun test e2e-tests/src/backlog.e2e.ts e2e-tests/src/concurrency.e2e.ts`
