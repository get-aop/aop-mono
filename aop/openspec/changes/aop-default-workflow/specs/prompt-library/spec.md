## MODIFIED Requirements

### Requirement: Template placeholder contract
The system SHALL define a fixed set of placeholder variables.

#### Scenario: Worktree placeholders
- **WHEN** template uses worktree context
- **THEN** available placeholders include `worktree.path`, `worktree.branch`

#### Scenario: Task placeholders
- **WHEN** template uses task context
- **THEN** available placeholders include `task.id`, `task.changePath`

#### Scenario: Step placeholders
- **WHEN** template uses step context
- **THEN** available placeholders include `step.type`, `step.executionId`, `step.iteration`

### Requirement: Step type templates
The system SHALL provide templates for each workflow step type.

#### Scenario: Implement template
- **WHEN** step type is implement
- **THEN** system uses `implement.md.hbs` template with chunked implementation pattern

#### Scenario: Test template
- **WHEN** step type is test
- **THEN** system uses `test.md.hbs` template

#### Scenario: Review template
- **WHEN** step type is review
- **THEN** system uses `review.md.hbs` template

#### Scenario: Debug template
- **WHEN** step type is debug
- **THEN** system uses `debug.md.hbs` template

#### Scenario: Full review template
- **WHEN** aop-default workflow requests full-review step
- **THEN** system uses `full-review.md.hbs` template with thorough review checklist

#### Scenario: Fix issues template
- **WHEN** aop-default workflow requests fix-issues step
- **THEN** system uses `fix-issues.md.hbs` template for addressing review findings

#### Scenario: Quick review template
- **WHEN** aop-default workflow requests quick-review step
- **THEN** system uses `quick-review.md.hbs` template with AOP audit checklist

## ADDED Requirements

### Requirement: Chunked implementation template
The system SHALL provide a template for chunked implementation with inline self-checks.

#### Scenario: Chunk size guidance
- **WHEN** implement.md.hbs is rendered
- **THEN** template instructs agent to work on cohesive chunks of 3-5 files

#### Scenario: Inline self-check
- **WHEN** implement.md.hbs is rendered
- **THEN** template includes self-check checklist before signaling

#### Scenario: Chunk completion signals
- **WHEN** implement.md.hbs is rendered
- **THEN** template documents CHUNK_DONE and ALL_TASKS_DONE signals

### Requirement: Full review template
The system SHALL provide a template for thorough code review.

#### Scenario: Review steps
- **WHEN** full-review.md.hbs is rendered
- **THEN** template includes code-review, verify, and AOP audit checklist steps

#### Scenario: Review report
- **WHEN** full-review.md.hbs is rendered
- **THEN** template instructs agent to create agent-review-report.md

#### Scenario: Review signals
- **WHEN** full-review.md.hbs is rendered
- **THEN** template documents REVIEW_PASSED and REVIEW_FAILED signals

### Requirement: Fix issues template
The system SHALL provide a template for addressing review findings.

#### Scenario: Read report
- **WHEN** fix-issues.md.hbs is rendered
- **THEN** template instructs agent to read agent-review-report.md

#### Scenario: Fix completion signal
- **WHEN** fix-issues.md.hbs is rendered
- **THEN** template documents FIX_COMPLETE signal

### Requirement: Quick review template
The system SHALL provide a template for verifying fixes.

#### Scenario: Verify fixes
- **WHEN** quick-review.md.hbs is rendered
- **THEN** template instructs agent to verify previous issues were addressed

#### Scenario: Include AOP audit
- **WHEN** quick-review.md.hbs is rendered
- **THEN** template includes AOP audit checklist (structural, quality, conventions, AI slop)

#### Scenario: Update report
- **WHEN** quick-review.md.hbs is rendered
- **THEN** template instructs agent to update agent-review-report.md with iteration results
