## Context

The AOP system has two execution tracking layers:
1. **Server** (`apps/server`): Central execution tracking via `execution-service.ts`
2. **Local-server** (`apps/local-server`): Local execution tracking via `executor.ts`

Currently, the local-server's `executeTask` loop (line 55-117 in `executor.ts`) calls `createExecutionRecords` for each step iteration. This creates a new local execution record per step, fragmenting the execution history.

The server correctly reuses the same execution across step transitions (via `handleTransition` in `execution-service.ts`), but the local-server ignores the server's execution ID and creates its own.

## Goals / Non-Goals

**Goals:**
- Single execution record per workflow run on the local-server
- Steps are added to the existing execution, not creating new executions
- Local execution ID aligns with server execution ID

**Non-Goals:**
- Changing server-side execution logic (already correct)
- Migrating existing fragmented data
- Dashboard changes (will automatically display correctly after fix)

## Decisions

### Decision 1: Reuse execution ID across step loop

**Change**: Modify `executeTask` to create execution record once before the loop, then only create step records inside the loop.

**Current flow:**
```
while (true) {
  createExecutionRecords() // creates BOTH execution + step
  runAgent()
  finalizeAndGetNextStep()
}
```

**New flow:**
```
executionId = createExecutionRecord() // once
while (true) {
  stepId = createStepRecord(executionId) // step only
  runAgent()
  finalizeAndGetNextStep()
}
```

**Rationale**: Matches the server's behavior where execution is created once and steps are added to it.

### Decision 2: Use server execution ID when available

The server returns `execution.id` in the `TaskReadyResponse`. The local-server should use this ID (or map to it) rather than generating its own.

**Alternative considered**: Keep local IDs separate, map via foreign key → Rejected because it adds complexity and the IDs should match for debugging.

## Risks / Trade-offs

- **Risk**: Existing data remains fragmented → Acceptable, only affects historical view
- **Risk**: If step creation fails mid-workflow, orphaned execution record → Mitigated by existing transaction handling
