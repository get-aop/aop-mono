## ADDED Requirements

### Requirement: SSE log endpoint
The system SHALL stream agent execution logs via Server-Sent Events.

#### Scenario: Connect to log stream
- **WHEN** client connects to `GET /api/executions/:executionId/logs`
- **THEN** server establishes SSE connection and streams log events

#### Scenario: Log event format
- **WHEN** agent produces output
- **THEN** server sends SSE event with `data: {"timestamp": "<ISO>", "stream": "stdout|stderr", "content": "<line>"}`

#### Scenario: Execution not found
- **WHEN** client connects to log stream for non-existent execution
- **THEN** server responds with 404 Not Found (not SSE)

#### Scenario: Execution completed
- **WHEN** execution completes while client is connected
- **THEN** server sends `event: complete` with final status and closes connection

#### Scenario: Client disconnect
- **WHEN** client disconnects from SSE stream
- **THEN** server stops streaming and cleans up resources

### Requirement: Log buffer
The system SHALL buffer recent log lines for late-joining clients.

#### Scenario: Replay recent logs
- **WHEN** client connects to active execution log stream
- **THEN** server first sends buffered log lines (up to 500 lines) then continues live streaming

#### Scenario: Buffer overflow
- **WHEN** log buffer exceeds 500 lines
- **THEN** system discards oldest lines to maintain buffer limit

### Requirement: Log viewer component
The system SHALL display streaming logs in the dashboard.

#### Scenario: Display live logs
- **WHEN** user views a WORKING task detail
- **THEN** system opens SSE connection and displays logs in real-time

#### Scenario: Auto-scroll logs
- **WHEN** new log lines arrive and user has not scrolled up
- **THEN** system auto-scrolls to show latest logs

#### Scenario: Pause auto-scroll
- **WHEN** user scrolls up in log viewer
- **THEN** system pauses auto-scroll and shows "Jump to bottom" button

#### Scenario: Distinguish stdout/stderr
- **WHEN** displaying log lines
- **THEN** system uses different styling for stdout (default) and stderr (red)

#### Scenario: Close connection on navigate
- **WHEN** user navigates away from task detail
- **THEN** system closes the SSE connection
