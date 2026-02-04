## Why

Users cannot see what type of work is being performed during task execution. The dashboard shows executions and their logs, but not the individual step types (implement, review, quick review, etc.), making it harder to understand the workflow progress and debug issues.

## What Changes

- Extend the executions API endpoint to include step execution data with step types
- Add a step timeline/list component to the task details page showing each step's type and status
- Display step type badges (implement, review, quick review, etc.) alongside step timing and status

## Capabilities

### New Capabilities

(none - this is a UI enhancement to existing execution tracking)

### Modified Capabilities

- `execution-tracking`: Add step-level visibility to the dashboard by exposing step execution data (including step_type) through the API and rendering it in the UI

## Impact

- **API**: `GET /api/repos/{repoId}/tasks/{taskId}/executions` response will include step execution data
- **Frontend**: `apps/dashboard/src/views/TaskDetail.tsx` will render step details
- **Components**: New StepTimeline or similar component for rendering steps
