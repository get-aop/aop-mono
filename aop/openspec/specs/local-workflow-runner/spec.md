## ADDED Requirements

### Requirement: Execute single-step workflow
The system SHALL execute tasks using a single-step workflow (spawn agent, wait, done).

#### Scenario: Execute task from queue
- **WHEN** daemon picks a READY task and capacity allows
- **THEN** system transitions to WORKING, creates worktree, spawns agent, monitors completion

#### Scenario: Successful completion
- **WHEN** agent exits with code 0
- **THEN** system transitions task to DONE

#### Scenario: Failed completion
- **WHEN** agent exits with non-zero code
- **THEN** system transitions task to BLOCKED

### Requirement: Create worktree for isolation
The system SHALL create a git worktree for each task execution.

#### Scenario: Worktree created
- **WHEN** task execution begins
- **THEN** system calls git-manager to create worktree at `<repo>/.worktrees/<task_id>/`

#### Scenario: Worktree reused on restart
- **WHEN** task is resumed after daemon restart
- **THEN** system reuses existing worktree (does not recreate)

### Requirement: Render prompt from template
The system SHALL render the agent prompt using the naive-implement template.

#### Scenario: Prompt includes artifacts
- **WHEN** task execution begins
- **THEN** system renders `naive-implement.md.hbs` with changeName, proposal, design, tasks, specs from change directory

#### Scenario: Missing artifacts handled
- **WHEN** some artifacts (design, tasks, specs) don't exist
- **THEN** system renders template with available artifacts only

### Requirement: Spawn agent via llm-provider
The system SHALL spawn the agent using ClaudeCodeProvider.

#### Scenario: Agent spawned with prompt
- **WHEN** prompt is rendered
- **THEN** system calls provider.run() with prompt and worktree as cwd

#### Scenario: Stream output to log
- **WHEN** agent produces output
- **THEN** system writes to log file via onOutput callback

### Requirement: Queue processor loop
The system SHALL continuously process the READY queue while daemon is running.

#### Scenario: Pick next task
- **WHEN** global and repo capacity allows
- **THEN** system picks oldest READY task (by ready_at) that fits repo limit

#### Scenario: Wait when at capacity
- **WHEN** global or all eligible repos are at capacity
- **THEN** system waits queue_poll_interval_secs before checking again

#### Scenario: Non-blocking execution
- **WHEN** task is picked for execution
- **THEN** system starts execution asynchronously and continues processing queue

### Requirement: Enforce concurrency limits
The system SHALL enforce both global and per-repo concurrency limits.

#### Scenario: Global limit enforced
- **WHEN** WORKING task count equals max_concurrent_tasks
- **THEN** system does not start additional tasks

#### Scenario: Repo limit enforced
- **WHEN** repo's WORKING count equals repo's max_concurrent_tasks
- **THEN** system does not start additional tasks for that repo (even if global allows)
