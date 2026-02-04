## Why

Workflow definitions are currently embedded as JavaScript objects in database migration files, making them hard to edit, version, and share. Moving to YAML files in a dedicated directory provides a cleaner authoring experience, better readability for non-technical users, and enables workflow versioning outside of database migrations.

## What Changes

- Add a `workflows/` directory containing YAML workflow definition files (e.g., `simple.yaml`, `ralph-loop.yaml`)
- Implement a YAML parser on the server to load and validate workflow definitions
- Load workflows from YAML files at startup instead of relying solely on database migrations
- Remove inline JavaScript workflow definitions from migration files (migrations become references to YAML files)
- Update the workflow parser to accept YAML input in addition to (or instead of) JSON

## Capabilities

### New Capabilities

- `yaml-workflow-loader`: Loading and parsing workflow definitions from YAML files on disk

### Modified Capabilities

- `workflow-engine`: Workflow definitions can be loaded from YAML files instead of only from database JSONB columns

## Impact

- **Code**: Add YAML parser dependency, create workflow loader service, update workflow repository
- **Files**: New `workflows/` directory with `.yaml` files for each workflow
- **Dependencies**: Add `yaml` package for YAML parsing
- **Migration**: Existing JSON definitions in database remain valid; YAML becomes the source of truth for new/updated workflows
- **Dev experience**: Workflows editable as plain text YAML files, easier to review in PRs
