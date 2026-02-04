## MODIFIED Requirements

### Requirement: Execute single-step workflow
The system SHALL execute tasks using a single-step workflow (spawn agent, wait, done).

#### Scenario: Execute task from queue
- **WHEN** server picks a READY task and capacity allows
- **THEN** system transitions to WORKING, creates worktree, spawns agent, monitors completion

#### Scenario: Successful completion
- **WHEN** agent exits with code 0
- **THEN** system transitions task to DONE

#### Scenario: Failed completion
- **WHEN** agent exits with non-zero code
- **THEN** system transitions task to BLOCKED

### Requirement: Queue processor loop
The system SHALL continuously process the READY queue while server is running.

#### Scenario: Pick next task
- **WHEN** global and repo capacity allows
- **THEN** system picks oldest READY task (by ready_at) that fits repo limit

#### Scenario: Wait when at capacity
- **WHEN** global or all eligible repos are at capacity
- **THEN** system waits queue_poll_interval_secs before checking again

#### Scenario: Non-blocking execution
- **WHEN** task is picked for execution
- **THEN** system starts execution asynchronously and continues processing queue
