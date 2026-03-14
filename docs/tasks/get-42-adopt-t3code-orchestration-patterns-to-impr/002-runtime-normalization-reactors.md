---
title: Normalize provider runtime events and split reactors
status: PENDING
dependencies: [1]
---

### Description
Define a canonical AOP provider runtime event schema for approvals, user input, tool activity, assistant progress, plan updates, completion, and runtime errors. Refactor the current direct queue and executor control flow into focused reactors for provider command dispatch, provider runtime ingestion, and verification or checkpoint side effects, with orchestration events as the only coordination boundary.

### Context
Relevant files include `packages/llm-provider/src/types.ts`, `packages/llm-provider/src/logs/*`, `packages/llm-provider/src/providers/claude-code.ts`, `packages/llm-provider/src/providers/codex.ts`, `apps/local-server/src/executor/executor.ts`, `apps/local-server/src/executor/completion-handler.ts`, `apps/local-server/src/executor/step-launcher.ts`, and `apps/local-server/src/events/*`. The first subtask must land before this work so reactors can consume persisted orchestration events and update projections through a stable write model.

### Result
Provider-specific runtime noise is translated once into canonical AOP runtime events, orchestration consumers subscribe to those events instead of parsing logs inline, and queue or executor recursion is replaced by reactor-driven state transitions and side effects.

### Review
Check that provider adapters retain CommonJS and ESM compatibility while exposing enough structured runtime data for normalization. Verify that pause, resume, tool activity, and runtime failure handling no longer depend on log scraping alone once a step is in flight.

### Blockers
Codex currently writes primarily to files while Claude can stream pipe output, so the normalization design must work for both live-stream and file-tail ingestion without forking the orchestration model.
