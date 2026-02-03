## Why

The current Milestone 2 implementation runs workflows locally on the CLI, but the product vision is for workflow orchestration to be server-controlled (closed-source IP). This milestone transitions from local workflow execution to remote orchestration where the server owns the workflow engine, prompt library, and step coordination while the CLI executes agents locally.

## What Changes

- **New**: REST API server on remote backend that coordinates workflow execution
- **New**: HTTP client in CLI that syncs state and receives step commands
- **New**: Protocol types for CLI↔Server communication (request/response)
- **New**: PostgreSQL database on server for workflow state and analytics
- **New**: Workflow engine on server (parser, validator, state machine)
- **New**: Prompt library on server (templates for each step type)
- **BREAKING**: Remove local workflow runner from CLI (replaced by remote orchestration)
- **Modified**: Task status transitions now follow sync ownership model (local owns DRAFT↔READY, remote owns WORKING↔DONE/BLOCKED)

## Capabilities

### New Capabilities

- `protocol-messages`: REST API request/response types for CLI↔Server communication
- `rest-server`: HTTP server that accepts CLI requests, returns step commands, processes execution results
- `rest-client`: HTTP client that syncs task state, posts step results, receives next steps
- `workflow-engine`: Server-side workflow execution engine (parser, validator, state machine, step transitions, signal-based branching)
- `prompt-library`: Server-side prompt templates for workflow step types (implement, test, review, debug, etc.)
- `server-db`: PostgreSQL database with Kysely for server-side state (workflows, executions, analytics)

### Modified Capabilities

- `execution-tracking`: Step executions now report to remote; execution state owned by server
- `task-detector`: Tasks gain `remoteId` and `syncedAt` fields for server sync

## Impact

**New code**:
- `apps/server/` - New server application
- `apps/cli/src/sync/` - HTTP client and state sync
- `packages/common/src/types/protocol.ts` - Shared request/response types

**Modified code**:
- `apps/cli/src/tasks/` - Add sync fields, status transition restrictions
- `apps/cli/src/executions/` - Report to remote, receive commands
- `apps/cli/src/daemon/` - Sync with server on task transitions
- `packages/common/` - Add protocol types

**Deleted code**:
- Local workflow runner (temporary code from Milestone 2)

**Dependencies**:
- `hono` - HTTP framework for server (already in stack)
- `kysely` - Query builder (already used for SQLite, now also PostgreSQL)
- `Bun.sql` - PostgreSQL driver for server

**Infrastructure**:
- PostgreSQL database for server
- REST API endpoints for CLI communication
