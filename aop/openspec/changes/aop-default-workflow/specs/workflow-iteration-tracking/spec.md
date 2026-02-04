## ADDED Requirements

### Requirement: Iteration counter per execution
The system SHALL track iteration count for looping workflow patterns.

#### Scenario: Initialize iteration counter
- **WHEN** execution starts
- **THEN** system initializes `iteration` to 0 in execution state

#### Scenario: Increment iteration on loop-back
- **WHEN** transition targets a step that has already been visited in this execution
- **THEN** system increments the `iteration` counter

#### Scenario: Iteration counter in step context
- **WHEN** generating step command
- **THEN** step context includes `iteration` field with current count

### Requirement: Max iterations enforcement
The system SHALL enforce maximum iteration limits on transitions.

#### Scenario: Define max iterations on transition
- **WHEN** transition specifies `maxIterations` field
- **THEN** system tracks how many times that transition has been taken

#### Scenario: Block when max iterations exceeded
- **WHEN** transition would be taken but `maxIterations` limit is reached
- **THEN** system evaluates `onMaxIterations` target instead (defaults to `__blocked__`)

#### Scenario: Max iterations with custom fallback
- **WHEN** transition specifies `maxIterations: 2` and `onMaxIterations: "some-step"`
- **THEN** system redirects to `some-step` after 2 iterations instead of blocking

### Requirement: Conditional routing by iteration
The system SHALL support iteration-based transition routing.

#### Scenario: First iteration routing
- **WHEN** transition specifies `afterIteration: 1` with `thenTarget`
- **THEN** system uses default `target` for iteration 0, switches to `thenTarget` for iteration >= 1

#### Scenario: Review loop pattern
- **WHEN** fix-issues step completes with iteration 0
- **THEN** system routes to quick-review
- **WHEN** fix-issues step completes with iteration >= 1
- **THEN** system routes to full-review
