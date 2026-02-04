## ADDED Requirements

### Requirement: Parse YAML workflow files
The system SHALL parse workflow definitions from YAML files.

#### Scenario: Parse valid YAML workflow
- **WHEN** system reads a `.yaml` file from the workflows directory
- **THEN** system parses YAML content into a workflow definition object

#### Scenario: Validate workflow schema
- **WHEN** YAML file is parsed
- **THEN** system validates the parsed object against `WorkflowDefinitionSchema`

#### Scenario: Reject invalid YAML syntax
- **WHEN** YAML file contains invalid syntax
- **THEN** system throws `WorkflowParseError` with descriptive message

#### Scenario: Reject invalid workflow structure
- **WHEN** YAML file parses but fails schema validation
- **THEN** system throws `WorkflowParseError` with validation details

### Requirement: Load workflows from directory
The system SHALL load all workflow files from a configured directory.

#### Scenario: Discover workflow files
- **WHEN** system starts up
- **THEN** system discovers all `*.yaml` files in `apps/server/workflows/` directory

#### Scenario: Load each workflow file
- **WHEN** workflow files are discovered
- **THEN** system parses and validates each file

#### Scenario: Handle empty directory
- **WHEN** workflows directory contains no `.yaml` files
- **THEN** system logs warning and continues (no workflows loaded)

#### Scenario: Handle missing directory
- **WHEN** workflows directory does not exist
- **THEN** system throws error with clear message about missing directory

### Requirement: Sync workflows to database
The system SHALL synchronize YAML workflows to the database at startup.

#### Scenario: Insert new workflow
- **WHEN** YAML workflow has no matching record in database (by name)
- **THEN** system inserts new workflow record with definition as JSONB

#### Scenario: Update existing workflow
- **WHEN** YAML workflow matches existing database record by name
- **THEN** system updates the definition and increments version

#### Scenario: Preserve database-only workflows
- **WHEN** database contains workflow not present in YAML files
- **THEN** system logs warning but does not delete the database record

#### Scenario: Sync completes before server accepts requests
- **WHEN** server starts
- **THEN** workflow sync completes before HTTP server begins accepting requests
