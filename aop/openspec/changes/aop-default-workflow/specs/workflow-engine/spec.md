## MODIFIED Requirements

### Requirement: Execution state machine
The system SHALL manage workflow execution state.

#### Scenario: Start workflow on ready request
- **WHEN** server receives `POST /tasks/{taskId}/ready`
- **THEN** system creates execution record and returns first step command in response

#### Scenario: Track current step
- **WHEN** execution is in progress
- **THEN** system tracks current step, pending result, execution history, and iteration counter

#### Scenario: Process step result
- **WHEN** server receives `POST /steps/{stepId}/complete`
- **THEN** system evaluates transitions (including iteration-based routing) and returns next step in response

#### Scenario: Signal-based transition evaluation
- **WHEN** step result includes `signal` field
- **THEN** system first checks for transition matching that signal keyword
- **AND** if no match, checks for `__none__` transition
- **AND** if no match, falls back to legacy success/failure evaluation

#### Scenario: Track iteration counter
- **WHEN** transition targets a previously visited step
- **THEN** system increments iteration counter in execution record

#### Scenario: Evaluate iteration constraints
- **WHEN** evaluating transition with `maxIterations` specified
- **THEN** system checks iteration count and redirects to `onMaxIterations` target if exceeded

## ADDED Requirements

### Requirement: Workflow definition schema extensions
The system SHALL support iteration-related fields in workflow YAML schema.

#### Scenario: Parse maxIterations on transition
- **WHEN** YAML transition specifies `maxIterations` field
- **THEN** system parses as positive integer

#### Scenario: Parse onMaxIterations on transition
- **WHEN** YAML transition specifies `onMaxIterations` field
- **THEN** system parses as step ID or terminal state

#### Scenario: Parse afterIteration routing
- **WHEN** YAML transition specifies `afterIteration` and `thenTarget` fields
- **THEN** system parses for conditional routing based on iteration count

#### Scenario: Validate iteration schema
- **WHEN** workflow YAML is validated
- **THEN** system validates `onMaxIterations` references valid step or terminal state

### Requirement: AOP default workflow
The system SHALL provide aop-default workflow for chunked implementation with review.

#### Scenario: Load aop-default workflow
- **WHEN** server starts with `aop-default.yaml` in workflows directory
- **THEN** system syncs "aop-default" workflow to database

#### Scenario: AOP default workflow steps
- **WHEN** aop-default workflow is loaded
- **THEN** workflow contains steps: implement, full-review, fix-issues, quick-review

#### Scenario: AOP default workflow signals
- **WHEN** aop-default workflow is loaded
- **THEN** implement step accepts signals: CHUNK_DONE, ALL_TASKS_DONE
- **AND** review steps accept signals: REVIEW_PASSED, REVIEW_FAILED
- **AND** fix-issues step accepts signal: FIX_COMPLETE
