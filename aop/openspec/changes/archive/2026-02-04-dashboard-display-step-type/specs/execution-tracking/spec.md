## ADDED Requirements

### Requirement: Expose step executions in API response
The system SHALL include step execution data when returning execution history for a task.

#### Scenario: Steps included in executions response
- **WHEN** client requests `GET /api/repos/{repoId}/tasks/{taskId}/executions`
- **THEN** system returns each execution with a `steps` array containing step execution records

#### Scenario: Step data includes step type
- **WHEN** step execution records are returned
- **THEN** each step SHALL include `stepType` field indicating the type of work (implement, review, quick-review, etc.)

#### Scenario: Step data includes timing
- **WHEN** step execution records are returned
- **THEN** each step SHALL include `startedAt` and `endedAt` timestamps

#### Scenario: Step data includes status
- **WHEN** step execution records are returned
- **THEN** each step SHALL include `status` field (running, success, failure, cancelled)

#### Scenario: Steps ordered chronologically
- **WHEN** steps array is returned
- **THEN** steps SHALL be ordered by `startedAt` ascending (oldest first)

### Requirement: Display step type in dashboard
The system SHALL render step type information in the task detail page for each execution.

#### Scenario: Step type visible in expanded execution
- **WHEN** user expands an execution in execution history
- **THEN** system displays each step with its type badge (e.g., "implement", "review")

#### Scenario: Step status indicated visually
- **WHEN** steps are displayed
- **THEN** each step shows its status using consistent status colors (success=green, failure=red, running=amber)

#### Scenario: Step timing displayed
- **WHEN** steps are displayed
- **THEN** each step shows its duration or "running" indicator if still in progress
