## ADDED Requirements

### Requirement: Kanban board view
The system SHALL display tasks in a Kanban board layout with columns by status.

#### Scenario: Display Kanban columns
- **WHEN** user opens the dashboard
- **THEN** system displays four columns: DRAFT, READY, WORKING, DONE

#### Scenario: Tasks in columns
- **WHEN** tasks exist in the system
- **THEN** each task appears as a card in its corresponding status column

#### Scenario: Task card content
- **WHEN** displaying a task card
- **THEN** card shows task name (from change path), repository name, and timestamps

#### Scenario: Filter by repository
- **WHEN** user selects a repository filter
- **THEN** all columns display only tasks from the selected repository

### Requirement: Real-time task updates via SSE
The system SHALL receive task status changes in real-time via Server-Sent Events.

#### Scenario: Connect to events stream
- **WHEN** dashboard loads
- **THEN** system establishes SSE connection to `/api/events`

#### Scenario: Task created event
- **WHEN** server sends task-created event
- **THEN** system adds new task card to appropriate column

#### Scenario: Task status changed event
- **WHEN** server sends task-status-changed event
- **THEN** system moves task card to new status column (or blocked banner)

#### Scenario: Task removed event
- **WHEN** server sends task-removed event
- **THEN** system removes task card from display

#### Scenario: Reconnect on disconnect
- **WHEN** SSE connection drops
- **THEN** system reconnects with exponential backoff and fetches current state

### Requirement: Blocked tasks banner
The system SHALL display blocked tasks in a prominent footer banner.

#### Scenario: Show blocked banner
- **WHEN** one or more tasks have BLOCKED status
- **THEN** system displays a red banner at the bottom of the screen listing blocked tasks

#### Scenario: Hide blocked banner
- **WHEN** no tasks have BLOCKED status
- **THEN** system hides the blocked banner

#### Scenario: Blocked task actions
- **WHEN** user views blocked banner
- **THEN** each blocked task shows Retry and Remove action buttons inline

#### Scenario: Blocked task error summary
- **WHEN** displaying a blocked task in the banner
- **THEN** system shows task name, repo, and error summary from last execution

### Requirement: Task detail view
The system SHALL display detailed information about a selected task.

#### Scenario: View task details
- **WHEN** user clicks on a task card
- **THEN** system displays task detail panel with status, timestamps, execution history, and actions

#### Scenario: View execution history
- **WHEN** user views task detail for a task with executions
- **THEN** system displays list of executions with status, duration, and step count

#### Scenario: View step details
- **WHEN** user expands an execution in task detail
- **THEN** system displays step executions with type, status, duration, and exit code

### Requirement: Task actions
The system SHALL allow users to perform actions on tasks.

#### Scenario: Mark task ready
- **WHEN** user clicks "Mark Ready" on a DRAFT task
- **THEN** system calls `POST /api/repos/:repoId/tasks/:taskId/ready` and task moves to READY column

#### Scenario: Retry blocked task
- **WHEN** user clicks "Retry" on a BLOCKED task in the banner
- **THEN** system calls `POST /api/repos/:repoId/tasks/:taskId/ready` and task moves to READY column

#### Scenario: Remove task
- **WHEN** user clicks "Remove" on a task and confirms
- **THEN** system calls `DELETE /api/repos/:repoId/tasks/:taskId` and removes from display

#### Scenario: Force remove working task
- **WHEN** user clicks "Remove" on a WORKING task and confirms force removal
- **THEN** system calls `DELETE /api/repos/:repoId/tasks/:taskId?force=true` and removes from display

### Requirement: Status indicators
The system SHALL display clear visual status indicators.

#### Scenario: Column header colors
- **WHEN** displaying Kanban columns
- **THEN** system uses distinct header colors: DRAFT (gray), READY (blue), WORKING (yellow), DONE (green)

#### Scenario: Working task indicator
- **WHEN** a task has status WORKING
- **THEN** task card displays an animated indicator showing active execution

### Requirement: Capacity display
The system SHALL display current execution capacity.

#### Scenario: Show global capacity
- **WHEN** dashboard loads
- **THEN** header displays "X / Y tasks running" where X is working count and Y is max concurrent

### Requirement: Metrics page
The system SHALL provide a dedicated page for viewing task metrics.

#### Scenario: Navigate to metrics
- **WHEN** user clicks "Metrics" link in header
- **THEN** system navigates to metrics page

#### Scenario: Display summary metrics
- **WHEN** user views metrics page
- **THEN** system displays: total tasks by status, success rate, average task duration

#### Scenario: Filter metrics by repository
- **WHEN** user selects a repository filter on metrics page
- **THEN** metrics update to show only that repository's data

#### Scenario: Duration breakdown
- **WHEN** displaying duration metrics
- **THEN** system shows average duration for completed tasks and failed tasks separately
