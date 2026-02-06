## Why

The reconciler re-processes REMOVED tasks every cycle because it only checks active (non-REMOVED) tasks when determining which changes on disk need new tasks. This produces misleading "Created task" log messages and unnecessary DB lookups on every reconciliation cycle. (GitHub issue #148)

## What Changes

- Reconciler includes REMOVED task paths when checking for existing tasks, so it skips changes that were already dismissed
- `createIdempotent` no longer emits `task-created` events for already-existing (REMOVED) tasks it returns without modification
- Reconciler logs now accurately reflect only genuinely new tasks

## Capabilities

### New Capabilities

_None — this is a bugfix to existing behavior._

### Modified Capabilities

- `task-detector`: The reconciler's "duplicate detection" scenario must also account for REMOVED tasks, not just active ones. The requirement "Duplicate detection" needs to explicitly cover the case where a task exists with REMOVED status.

## Impact

- **Code**: `apps/local-server/src/orchestrator/watcher/reconcile.ts` (main fix), `apps/local-server/src/task/repository.ts` (createIdempotent event guard)
- **Behavior**: REMOVED tasks stay dismissed across reconciliation cycles. No new DB rows or spurious events.
- **APIs/Dependencies**: No API changes. No new dependencies.
