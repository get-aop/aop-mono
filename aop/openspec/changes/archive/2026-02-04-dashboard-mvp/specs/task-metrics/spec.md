## ADDED Requirements

### Requirement: Metrics API endpoint
The system SHALL expose aggregated task metrics via REST API.

#### Scenario: Get metrics
- **WHEN** client calls `GET /api/metrics`
- **THEN** server returns aggregated metrics object

#### Scenario: Metrics response format
- **WHEN** metrics are requested
- **THEN** response includes: total tasks by status, average execution duration, success/failure counts

### Requirement: Task duration tracking
The system SHALL track and report task execution duration.

#### Scenario: Calculate execution duration
- **WHEN** calculating task metrics
- **THEN** system computes duration from execution started_at to completed_at

#### Scenario: Average duration by status
- **WHEN** metrics include duration stats
- **THEN** system reports average duration for completed (DONE) and failed (BLOCKED) tasks separately

### Requirement: Success rate calculation
The system SHALL calculate task success rates.

#### Scenario: Calculate success rate
- **WHEN** metrics are computed
- **THEN** system calculates success_rate = DONE / (DONE + BLOCKED) * 100

#### Scenario: Handle zero completed tasks
- **WHEN** no tasks have completed (DONE or BLOCKED)
- **THEN** success rate is null (not 0 or 100)

### Requirement: Metrics display
The system SHALL display metrics in the dashboard.

#### Scenario: Show summary metrics
- **WHEN** dashboard loads
- **THEN** system displays: total tasks, tasks by status, success rate, average duration

#### Scenario: Metrics refresh
- **WHEN** task list refreshes
- **THEN** metrics refresh simultaneously

### Requirement: Per-repo metrics
The system SHALL support filtering metrics by repository.

#### Scenario: Filter metrics by repo
- **WHEN** client calls `GET /api/metrics?repoId=<id>`
- **THEN** server returns metrics filtered to that repository

#### Scenario: Display per-repo metrics
- **WHEN** user filters task list by repository
- **THEN** metrics display updates to show only that repo's metrics
