## MODIFIED Requirements

### Requirement: Workflow storage
The system SHALL store workflow definitions in database, sourced from YAML files.

#### Scenario: Load workflow
- **WHEN** task becomes READY
- **THEN** system loads workflow definition for that task type from database

#### Scenario: Workflow versioning
- **WHEN** workflows are updated via YAML file changes
- **THEN** running executions continue with original version

#### Scenario: Default workflow
- **WHEN** server starts with `simple.yaml` in workflows directory
- **THEN** system syncs "simple" workflow to database with single implement step

#### Scenario: Ralph loop workflow
- **WHEN** server starts with `ralph-loop.yaml` in workflows directory
- **THEN** system syncs "ralph-loop" workflow to database with iterate/review steps

#### Scenario: YAML as source of truth
- **WHEN** server starts
- **THEN** system syncs all YAML workflow definitions to database before accepting requests
