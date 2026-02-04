## MODIFIED Requirements

### Requirement: Create execution record
The system SHALL create an execution record when a task begins running, now reported to remote server.

#### Scenario: Execution created on task start
- **WHEN** daemon starts executing a task
- **THEN** system creates execution record with TypeID (exec_xxx), task_id, status=running, started_at

#### Scenario: Execution completed on success
- **WHEN** agent completes successfully (exit code 0)
- **THEN** system updates execution status to completed and sets completed_at

#### Scenario: Execution failed on error
- **WHEN** agent fails (non-zero exit code or timeout)
- **THEN** system updates execution status to failed and sets completed_at

#### Scenario: Report execution to server
- **WHEN** execution status changes
- **THEN** system reports change via ServerSync (implicit via task status)

### Requirement: Track step execution
The system SHALL create step_execution records for each workflow step, now with server-assigned IDs.

#### Scenario: Step record created
- **WHEN** a workflow step begins
- **THEN** system creates step_execution with stepId from server response

#### Scenario: Step captures agent PID
- **WHEN** agent process is spawned
- **THEN** system stores agent_pid in step_execution record

#### Scenario: Step captures session ID
- **WHEN** agent reports session_id in stream output
- **THEN** system stores session_id in step_execution for potential resume

#### Scenario: Step captures exit code
- **WHEN** agent process exits
- **THEN** system stores exit_code and updates status to success (0) or failure (non-zero)

#### Scenario: Step captures error
- **WHEN** agent fails with error output
- **THEN** system stores error message in step_execution

#### Scenario: Report step result to server
- **WHEN** step completes (success or failure)
- **THEN** system calls `POST /steps/{stepId}/complete` with status, error, and durationMs

### Requirement: Stream agent output to log
The system SHALL stream agent output to a log file during execution.

#### Scenario: Log file per task
- **WHEN** task execution begins
- **THEN** system creates/appends to log file at `~/.aop/logs/<task_id>.jsonl`

#### Scenario: Stream JSON lines
- **WHEN** agent produces output
- **THEN** system writes each output event as JSON line to log file

### Requirement: Resume working tasks on restart
The system SHALL resume monitoring WORKING tasks when daemon restarts, coordinating with server.

#### Scenario: Reattach to live agent
- **WHEN** daemon starts and finds WORKING task with agent_pid that is still alive
- **THEN** system reattaches monitoring to existing process

#### Scenario: Respawn dead agent
- **WHEN** daemon starts and finds WORKING task with agent_pid that is not running
- **THEN** system restarts execution for that task (using existing worktree)

#### Scenario: Reconcile with server on restart
- **WHEN** daemon starts and ServerSync authenticates
- **THEN** system checks `GET /tasks/{taskId}/status` for WORKING tasks

#### Scenario: Handle awaiting result
- **WHEN** task status shows `awaitingResult: true`
- **THEN** system sends completed step result if available, or re-executes step

### Requirement: Inactivity timeout
The system SHALL timeout agents that stop producing output.

#### Scenario: Timeout on inactivity
- **WHEN** agent produces no output for agent_timeout_secs (default 1800s/30m)
- **THEN** system kills agent process and reports step failed with `agent_timeout` error code

#### Scenario: Active agent not timed out
- **WHEN** agent continuously produces output
- **THEN** system does not kill agent regardless of total runtime

### Requirement: Abort execution
The system SHALL support aborting running executions.

#### Scenario: Execution aborted on task remove
- **WHEN** user removes a WORKING task via `aop task:remove`
- **THEN** system updates execution status to aborted and sets completed_at

#### Scenario: Step aborted on task remove
- **WHEN** user removes a WORKING task via `aop task:remove`
- **THEN** system updates step_execution status to aborted and sets ended_at

#### Scenario: Abort kills agent process
- **WHEN** task is aborted while agent is running
- **THEN** system sends SIGTERM to agent_pid, waits briefly, sends SIGKILL if still alive

#### Scenario: ABORTED status in execution
- **WHEN** execution is aborted
- **THEN** system stores status as 'aborted' (distinct from 'failed' which indicates agent error)

#### Scenario: Report abort to server
- **WHEN** execution is aborted
- **THEN** system calls `POST /steps/{stepId}/complete` with `status: "failure"`, `error.code: "aborted"`, `error.reason: "task_removed"`

#### Scenario: Abort when step not started
- **WHEN** task is aborted before step execution begins
- **THEN** system still calls `POST /steps/{stepId}/complete` with aborted status (step may have no duration)

#### Scenario: Abort when change files deleted
- **WHEN** WORKING task completes and change directory no longer exists
- **THEN** system marks task as aborted with `error.reason: "change_files_deleted"`

## ADDED Requirements

### Requirement: Execute server step commands
The system SHALL execute workflow steps commanded by the server.

#### Scenario: Process step command
- **WHEN** ServerSync receives step command in HTTP response
- **THEN** executor creates step_execution and spawns agent with resolved prompt

#### Scenario: Use server prompt template
- **WHEN** executing step command
- **THEN** executor uses promptTemplate from response (resolved locally)

#### Scenario: Server controls concurrency
- **WHEN** step command is received
- **THEN** executor executes immediately (server enforces maxConcurrentTasks)

### Requirement: Template resolution
The system SHALL resolve Handlebars placeholders in prompts locally.

#### Scenario: Resolve worktree path
- **WHEN** prompt contains `{{ worktree.path }}`
- **THEN** executor substitutes actual local worktree path

#### Scenario: Resolve task context
- **WHEN** prompt contains `{{ task.id }}` or `{{ task.changePath }}`
- **THEN** executor substitutes actual task values

#### Scenario: Privacy preserved
- **WHEN** prompt is resolved
- **THEN** resolved values are never sent to server (only used locally)

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
