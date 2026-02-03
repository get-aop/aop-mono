## ADDED Requirements

### Requirement: PostgreSQL database
The system SHALL use PostgreSQL for server-side state persistence.

#### Scenario: Database connection
- **WHEN** server starts
- **THEN** server connects to PostgreSQL using Bun.sql

#### Scenario: Connection pooling
- **WHEN** multiple concurrent operations occur
- **THEN** system uses connection pooling for performance

### Requirement: Kysely query builder
The system SHALL use Kysely for type-safe database queries.

#### Scenario: Query builder integration
- **WHEN** repository performs database operation
- **THEN** repository uses Kysely with PostgreSQL dialect

#### Scenario: Type safety
- **WHEN** queries are written
- **THEN** TypeScript validates query correctness at compile time

### Requirement: Client table
The system SHALL store client records with API keys and plan-based limits.

#### Scenario: Client schema
- **WHEN** client table is created
- **THEN** table contains: id (TypeID), api_key, max_concurrent_tasks (default 5), created_at, last_seen_at

#### Scenario: API key lookup
- **WHEN** CLI authenticates
- **THEN** system looks up client by api_key

#### Scenario: Default concurrency limit
- **WHEN** new client is created
- **THEN** max_concurrent_tasks defaults to 5

#### Scenario: Plan-based limit adjustment
- **WHEN** customer upgrades plan (future)
- **THEN** admin can increase max_concurrent_tasks for that client

### Requirement: Remote repo table
The system SHALL store minimal repo metadata for metrics.

#### Scenario: Repo schema
- **WHEN** repo table is created
- **THEN** table contains: id (synced from CLI), client_id, synced_at

#### Scenario: Denormalized client_id
- **WHEN** repo is synced
- **THEN** repo record includes client_id for efficient querying

### Requirement: Remote task table
The system SHALL store task IDs and status for metrics and concurrency control.

#### Scenario: Task schema
- **WHEN** task table is created
- **THEN** table contains: id (synced from CLI), client_id, repo_id, status, synced_at

#### Scenario: Status only
- **WHEN** task is synced
- **THEN** system stores status but NOT change_path or other content

#### Scenario: Valid status values
- **WHEN** task status is stored
- **THEN** status is one of: DRAFT, READY, WORKING, BLOCKED, DONE, REMOVED

#### Scenario: Count WORKING tasks for concurrency
- **WHEN** server evaluates whether to send step.command
- **THEN** system counts tasks with status=WORKING for the client against effectiveMaxConcurrentTasks

### Requirement: Execution table
The system SHALL store execution records.

#### Scenario: Execution schema
- **WHEN** execution table is created
- **THEN** table contains: id (TypeID), client_id, task_id, workflow_id, status, started_at, completed_at

#### Scenario: Execution lifecycle
- **WHEN** workflow starts for task
- **THEN** system creates execution with status=running

### Requirement: Step execution table
The system SHALL store step execution records.

#### Scenario: Step execution schema
- **WHEN** step_execution table is created
- **THEN** table contains: id (TypeID), client_id, execution_id, step_type, prompt_template, status, error_code, started_at, ended_at

#### Scenario: Track prompt template
- **WHEN** step command is sent
- **THEN** system stores prompt_template filename for metrics optimization

### Requirement: Workflow table
The system SHALL store workflow definitions.

#### Scenario: Workflow schema
- **WHEN** workflow table is created
- **THEN** table contains: id (TypeID), name, definition (JSON), version, created_at

#### Scenario: Global workflows
- **WHEN** workflow is queried
- **THEN** workflow is NOT scoped to client_id (global for all clients)

### Requirement: Database migrations
The system SHALL use Kysely migrations for schema management.

#### Scenario: Run migrations on startup
- **WHEN** server starts
- **THEN** system runs pending Kysely migrations

#### Scenario: Migration files
- **WHEN** migrations are created
- **THEN** migrations are stored in `apps/server/src/db/migrations/`

### Requirement: Test API key seeding
The system SHALL seed a test API key for development.

#### Scenario: Seed test key
- **WHEN** migrations run in development
- **THEN** system creates test client with known API key and max_concurrent_tasks=5

#### Scenario: Test key value
- **WHEN** test key is seeded
- **THEN** key value is `aop_test_key_dev` for easy testing

### Requirement: Repository pattern
The system SHALL use repository classes for data access.

#### Scenario: Repository naming
- **WHEN** data access classes are created
- **THEN** classes are named `*-repository.ts` (e.g., `client-repository.ts`)

#### Scenario: Repository location
- **WHEN** repositories are created
- **THEN** repositories are located in `apps/server/src/repositories/`
