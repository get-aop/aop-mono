---
title: Persist recovery state and add provider readiness hardening
status: PENDING
dependencies: [1, 2]
---

### Description
Persist execution-session bindings and recoverable runtime metadata per active task or step so restart, reattach, and resume behavior use explicit state instead of heuristics. Add provider health and readiness probes, surface provider availability in health or status APIs before dispatch, and centralize subprocess, buffer, timeout, kill, git, and repeated repo-scan guardrails that the new orchestration flow depends on.

### Context
Relevant modules are `apps/local-server/src/executor/recovery.ts`, `apps/local-server/src/executor/process-utils.ts`, `apps/local-server/src/executor/step-launcher.ts`, `apps/local-server/src/health/handlers.ts`, `apps/local-server/src/status/handlers.ts`, `packages/git-manager/src/*`, `packages/infra/src/aop-paths.ts`, and the provider implementations under `packages/llm-provider/src/providers/`. This work depends on the event spine and runtime normalization so persisted recovery state can reference stable command, event, and session concepts.

### Result
Active executions have durable provider binding records, restart logic can deterministically recover or degrade, health endpoints expose provider readiness alongside DB and orchestrator status, and runtime support limits are enforced consistently across provider and git boundaries.

### Review
Confirm that recovery decisions are explainable from stored session metadata and emitted orchestration events. Verify that unhealthy or misconfigured providers are reported before dispatch and that readiness failures do not leave tasks half-claimed.

### Blockers
Provider readiness checks may require version and auth probing that differs by CLI, so the implementation should define a minimal shared contract first and layer provider-specific diagnostics behind it.
