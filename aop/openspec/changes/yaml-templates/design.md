## Context

Workflow definitions are currently:
1. Defined as JavaScript objects in database migration files (`008-seed-simple-workflow.ts`, `010-seed-ralph-loop-workflow.ts`)
2. Serialized to JSON and stored in PostgreSQL `workflows` table as JSONB
3. Parsed via `workflow-parser.ts` which expects JSON string input

This works but has friction:
- Editing workflows requires modifying TypeScript code in migrations
- YAML is more readable for state machine definitions
- Workflows are tied to database migration lifecycle

## Goals / Non-Goals

**Goals:**
- Store workflow definitions as `.yaml` files in a `workflows/` directory
- Parse YAML at server startup and sync to database
- Maintain existing Zod validation via `WorkflowDefinitionSchema`
- Keep workflows versioned in git, not just database

**Non-Goals:**
- Hot-reloading workflows without restart
- YAML-specific schema validation (continue using Zod)
- UI for editing workflows
- Breaking existing database storage format

## Decisions

### 1. YAML file location

**Decision**: Place workflow files in `apps/server/workflows/` directory.

**Rationale**: Co-located with the server app that uses them. Each file is `<name>.yaml` (e.g., `simple.yaml`, `ralph-loop.yaml`).

**Alternatives considered**:
- Root `workflows/` directory: Would work but separates from consumer
- `packages/common/workflows/`: Overkill for server-only concern

### 2. Parsing approach

**Decision**: Parse YAML to JavaScript object, then run through existing `WorkflowDefinitionSchema` validation.

```typescript
import YAML from "yaml";
const data = YAML.parse(yamlContent);
const result = WorkflowDefinitionSchema.safeParse(data);
```

**Rationale**: Reuses existing Zod schema. YAML parser produces plain objects identical to `JSON.parse` output.

**Alternatives considered**:
- YAML-specific schema: Unnecessary complexity, Zod works fine
- Custom YAML tags: Over-engineering for current needs

### 3. Sync strategy

**Decision**: Load all YAML files at startup and upsert into database.

```typescript
const syncWorkflows = async (db, workflowsDir) => {
  const files = await glob("*.yaml", { cwd: workflowsDir });
  for (const file of files) {
    const content = await Bun.file(join(workflowsDir, file)).text();
    const definition = parseWorkflowYaml(content);
    await upsertWorkflow(db, definition);
  }
};
```

**Rationale**: Simple and deterministic. Database remains source of truth at runtime, YAML is source of truth for definitions.

**Alternatives considered**:
- Load from YAML on every request: Performance overhead, inconsistent state
- Watch files for changes: Complexity for little benefit (restart is fine)

### 4. Migration file cleanup

**Decision**: Remove workflow definition objects from migration files but keep migrations that create the `workflows` table structure.

**Rationale**: Migrations should handle schema, not seed data. Workflow seeding moves to startup sync.

### 5. YAML structure

**Decision**: Mirror the existing JSON structure exactly.

```yaml
version: 1
name: simple
initialStep: implement
steps:
  implement:
    id: implement
    type: implement
    promptTemplate: implement.md.hbs
    maxAttempts: 1
    transitions:
      - condition: success
        target: __done__
      - condition: failure
        target: __blocked__
terminalStates:
  - __done__
  - __blocked__
```

**Rationale**: No schema changes needed. Existing tests and validation continue to work.

## Risks / Trade-offs

**[Startup dependency]** → YAML files must exist and be valid for server to start. Mitigation: Validate during development, fail fast with clear errors.

**[Database/file drift]** → Database could be edited directly and differ from YAML. Mitigation: Startup sync always overwrites with YAML content.

**[Missing files]** → If YAML file deleted but database has workflow. Mitigation: Consider warning logs, but don't delete from DB automatically.
