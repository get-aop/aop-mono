## ADDED Requirements

### Requirement: Steps grouped under single execution

The local-server SHALL create one execution record per workflow run, with multiple step records under that execution as the workflow progresses.

#### Scenario: Multi-step workflow execution
- **WHEN** a workflow with steps [implement, review] runs to completion
- **THEN** the database contains exactly 1 execution record with 2 step_execution records

#### Scenario: Step transition reuses execution
- **WHEN** the first step completes and transitions to the next step
- **THEN** the new step_execution record references the same execution_id as the first step
