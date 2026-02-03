## ADDED Requirements

### Requirement: Create execution record
The system SHALL create an execution record when a task begins running.

#### Scenario: Execution created on task start
- **WHEN** daemon starts executing a task
- **THEN** system creates execution record with TypeID (exec_xxx), task_id, status=running, started_at

#### Scenario: Execution completed on success
- **WHEN** agent completes successfully (exit code 0)
- **THEN** system updates execution status to completed and sets completed_at

#### Scenario: Execution failed on error
- **WHEN** agent fails (non-zero exit code or timeout)
- **THEN** system updates execution status to failed and sets completed_at

### Requirement: Track step execution
The system SHALL create step_execution records for each workflow step.

#### Scenario: Step record created
- **WHEN** a workflow step begins
- **THEN** system creates step_execution with TypeID (step_xxx), execution_id, status=running, started_at

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

### Requirement: Stream agent output to log
The system SHALL stream agent output to a log file during execution.

#### Scenario: Log file per task
- **WHEN** task execution begins
- **THEN** system creates/appends to log file at `~/.aop/logs/<task_id>.jsonl`

#### Scenario: Stream JSON lines
- **WHEN** agent produces output
- **THEN** system writes each output event as JSON line to log file

### Requirement: Resume working tasks on restart
The system SHALL resume monitoring WORKING tasks when daemon restarts.

#### Scenario: Reattach to live agent
- **WHEN** daemon starts and finds WORKING task with agent_pid that is still alive
- **THEN** system reattaches monitoring to existing process

#### Scenario: Respawn dead agent
- **WHEN** daemon starts and finds WORKING task with agent_pid that is not running
- **THEN** system restarts execution for that task (using existing worktree)

### Requirement: Inactivity timeout
The system SHALL timeout agents that stop producing output.

#### Scenario: Timeout on inactivity
- **WHEN** agent produces no output for agent_timeout_secs (default 1800s/30m)
- **THEN** system kills agent process and marks task BLOCKED

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
