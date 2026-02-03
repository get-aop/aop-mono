## ADDED Requirements

### Requirement: Prompt template storage
The system SHALL store prompt templates as version-controlled files.

#### Scenario: Template file location
- **WHEN** server loads prompt templates
- **THEN** templates are loaded from `apps/server/src/prompts/templates/*.md.hbs`

#### Scenario: Handlebars format
- **WHEN** template is defined
- **THEN** template uses Handlebars syntax for placeholders (e.g., `{{ worktree.path }}`)

### Requirement: Template loading
The system SHALL load templates at runtime.

#### Scenario: Load template by name
- **WHEN** workflow engine requests template by filename
- **THEN** system loads template content from file

#### Scenario: Template not found
- **WHEN** requested template does not exist
- **THEN** system returns error with `prompt_not_found` code

#### Scenario: Cache templates
- **WHEN** template is loaded
- **THEN** system caches template in memory for performance

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
- **THEN** available placeholders include `step.type`, `step.executionId`

### Requirement: Template validation
The system SHALL validate templates at startup.

#### Scenario: Validate all templates on start
- **WHEN** server starts
- **THEN** system loads and validates all templates exist

#### Scenario: Warn on unknown placeholders
- **WHEN** template contains undefined placeholder
- **THEN** system logs warning during validation

### Requirement: Step type templates
The system SHALL provide templates for each workflow step type.

#### Scenario: Implement template
- **WHEN** step type is implement
- **THEN** system uses `implement.md.hbs` template

#### Scenario: Test template
- **WHEN** step type is test
- **THEN** system uses `test.md.hbs` template

#### Scenario: Review template
- **WHEN** step type is review
- **THEN** system uses `review.md.hbs` template

#### Scenario: Debug template
- **WHEN** step type is debug
- **THEN** system uses `debug.md.hbs` template

### Requirement: Move existing prompts to server
The system SHALL move local prompt templates from CLI to server.

#### Scenario: Relocate naive-implement
- **WHEN** server prompt library is implemented
- **THEN** `naive-implement.md.hbs` is moved from CLI to `apps/server/src/prompts/templates/`

#### Scenario: Remove CLI prompts
- **WHEN** migration is complete
- **THEN** `apps/cli/src/prompt/` directory is deleted
