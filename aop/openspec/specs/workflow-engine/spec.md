## ADDED Requirements

### Requirement: Workflow definition
The system SHALL define workflows as state machines with steps and transitions.

#### Scenario: Workflow structure
- **WHEN** workflow is defined
- **THEN** workflow contains steps, each with type, promptTemplate, and transitions

#### Scenario: Step types
- **WHEN** workflow defines steps
- **THEN** step types include: implement, test, review, debug, iterate

#### Scenario: Transition conditions
- **WHEN** step completes
- **THEN** transitions define next step based on signal keyword, `__none__`, or legacy success/failure

#### Scenario: Signal keywords
- **WHEN** workflow step defines `signals` array
- **THEN** transitions can use signal keywords as conditions (e.g., `TASK_COMPLETE`, `NEEDS_REVIEW`)

#### Scenario: No signal transition
- **WHEN** step completes with no signal detected
- **THEN** system evaluates transition with condition `__none__` (enables loop-back patterns)

### Requirement: Workflow storage
The system SHALL store workflow definitions in database.

#### Scenario: Load workflow
- **WHEN** task becomes READY
- **THEN** system loads workflow definition for that task type

#### Scenario: Workflow versioning
- **WHEN** workflows are updated
- **THEN** running executions continue with original version

#### Scenario: Default workflow
- **WHEN** server is seeded
- **THEN** system creates "simple" workflow with single implement step that transitions to done on success

#### Scenario: Ralph loop workflow
- **WHEN** server is seeded
- **THEN** system creates "ralph-loop" workflow with iterate step that loops on `__none__` and completes on `TASK_COMPLETE` signal

### Requirement: Execution state machine
The system SHALL manage workflow execution state.

#### Scenario: Start workflow on ready request
- **WHEN** server receives `POST /tasks/{taskId}/ready`
- **THEN** system creates execution record and returns first step command in response

#### Scenario: Track current step
- **WHEN** execution is in progress
- **THEN** system tracks current step, pending result, and execution history

#### Scenario: Process step result
- **WHEN** server receives `POST /steps/{stepId}/complete`
- **THEN** system evaluates transitions and returns next step in response

#### Scenario: Signal-based transition evaluation
- **WHEN** step result includes `signal` field
- **THEN** system first checks for transition matching that signal keyword
- **AND** if no match, checks for `__none__` transition
- **AND** if no match, falls back to legacy success/failure evaluation

### Requirement: Step command generation
The system SHALL generate step commands with prompt templates.

#### Scenario: Generate step command
- **WHEN** system determines next step
- **THEN** system returns step command with stepId, stepType, promptTemplate, and attempt

#### Scenario: Load prompt template
- **WHEN** generating step command
- **THEN** system loads promptTemplate from prompt library by filename

#### Scenario: Track prompt for metrics
- **WHEN** returning step command
- **THEN** system stores promptTemplate filename in step_execution record

### Requirement: Workflow completion
The system SHALL detect and handle workflow completion.

#### Scenario: Workflow completes successfully
- **WHEN** step result triggers terminal success transition
- **THEN** system returns `taskStatus: "DONE"`, `step: null` in response

#### Scenario: Workflow blocked
- **WHEN** step fails and no retry transition available
- **THEN** system returns `taskStatus: "BLOCKED"`, `step: null`, error in response

### Requirement: Request-response model
The system SHALL process workflow events synchronously in HTTP request handlers.

#### Scenario: Immediate step evaluation
- **WHEN** `POST /tasks/{taskId}/ready` or `POST /steps/{stepId}/complete` is received
- **THEN** system immediately evaluates and returns next command in same HTTP response

#### Scenario: No polling required
- **WHEN** workflow step completes
- **THEN** next step is returned in completion response (no separate fetch needed)

#### Scenario: Enforce client concurrency limit
- **WHEN** evaluating `POST /tasks/{taskId}/ready`
- **THEN** system counts client's WORKING tasks and only returns step if below effectiveMaxConcurrentTasks

#### Scenario: Return queued status when at capacity
- **WHEN** client is at max concurrent tasks
- **THEN** system returns `status: "READY"`, `queued: true` instead of starting workflow

### Requirement: Process deferred workflows
The system SHALL start queued workflows when capacity becomes available.

#### Scenario: Evaluate queue on task completion
- **WHEN** task status changes from WORKING to DONE/BLOCKED
- **THEN** system marks capacity as available for next READY task

#### Scenario: Client polls for queued task
- **WHEN** client has queued READY task and retries `POST /tasks/{taskId}/ready`
- **THEN** system may now return step command if capacity available

### Requirement: Race condition handling
The system SHALL handle concurrent requests safely.

#### Scenario: Acquire execution lock
- **WHEN** processing step completion
- **THEN** system uses `SELECT ... FOR UPDATE SKIP LOCKED` to prevent races

#### Scenario: Idempotent step processing
- **WHEN** duplicate step completion is received (same executionId, stepId, attempt)
- **THEN** system returns same response without side effects
