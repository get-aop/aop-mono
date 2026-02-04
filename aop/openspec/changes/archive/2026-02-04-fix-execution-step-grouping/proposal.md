## Why

Workflow step transitions create new executions instead of adding steps to the existing execution. This fragments execution history and makes it harder to track the complete workflow lifecycle for a task.

## What Changes

- Fix workflow continuation to reuse existing execution when transitioning between steps
- Ensure `processStepResult` handles step transitions rather than re-calling `startWorkflow`
- Steps (implement → review) should be grouped under a single execution record

## Capabilities

### New Capabilities

None - this is a bug fix to existing behavior.

### Modified Capabilities

None - the spec-level behavior (workflow execution) is correct, only the implementation is broken.

## Impact

- `execution-service.ts`: Verify transition logic reuses execution correctly
- Client/agent code: Investigate if client is calling `startWorkflow` multiple times
- Dashboard: Will correctly show single execution with multiple steps after fix
- Database: Existing fragmented data will remain; only new executions will be correct
