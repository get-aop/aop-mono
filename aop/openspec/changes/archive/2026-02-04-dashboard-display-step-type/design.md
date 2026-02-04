## Context

The dashboard's task detail page shows execution history but only displays high-level execution data (status, start time, duration). Step execution data including `step_type` is tracked in the database (`step_executions` table) but not exposed to the frontend.

The repository already has `getStepExecutionsByExecutionId` method that returns all step data including `step_type`, `status`, `started_at`, `ended_at`, and `error`.

## Goals / Non-Goals

**Goals:**
- Display step type (implement, review, quick review, etc.) for each execution step in the task details page
- Show step status and timing alongside the step type
- Maintain clean separation between API layer and UI components

**Non-Goals:**
- Step-level log viewing (logs remain at execution level)
- Real-time step status updates via SSE (existing execution-level updates suffice)
- Editing or interacting with individual steps

## Decisions

### 1. Extend existing executions endpoint vs new endpoint

**Decision**: Extend the existing `GET /api/repos/{repoId}/tasks/{taskId}/executions` endpoint to include steps array for each execution.

**Rationale**: Simpler client implementation with single fetch. Steps are directly related to executions - no need for separate round-trips.

**Alternative considered**: New `/executions/{id}/steps` endpoint - rejected due to N+1 query pattern from frontend.

### 2. Step data structure

**Decision**: Return steps as a nested array within each execution object:
```typescript
{
  executions: [{
    id, status, startedAt, finishedAt,
    steps: [{ id, stepType, status, startedAt, endedAt, error }]
  }]
}
```

**Rationale**: Groups steps with their parent execution, easy to render in UI.

### 3. UI presentation

**Decision**: Show steps inline within the execution item when expanded, using a simple timeline/list format with step type badges.

**Rationale**: Minimal UI change, consistent with existing expand/collapse pattern for executions.

## Risks / Trade-offs

- **Larger API response** → Acceptable since step count per execution is typically small (1-5 steps)
- **Breaking API change** → Not breaking - additive change (new `steps` field)
