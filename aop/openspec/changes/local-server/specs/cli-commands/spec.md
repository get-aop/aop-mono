## MODIFIED Requirements

### Requirement: Show status
The system SHALL display server and task status via `aop status`.

#### Scenario: Status with running server
- **WHEN** user runs `aop status` with server running
- **THEN** system calls GET /api/status and displays: server state (running + port), global capacity, repos with tasks

#### Scenario: Status when server not running
- **WHEN** user runs `aop status` with server not running
- **THEN** system displays error: "Local server not running. Start it with: bun run apps/local-server/src/run.ts"

#### Scenario: Status output format
- **WHEN** user runs `aop status`
- **THEN** system displays tasks as: `<task_id> <status> <change_name>`

### Requirement: Register repository
The system SHALL register current directory via `aop repo:init`.

#### Scenario: Register repo via API
- **WHEN** user runs `aop repo:init` in a git repository with server running
- **THEN** system calls POST /api/repos with current path and displays confirmation

#### Scenario: Register repo when server not running
- **WHEN** user runs `aop repo:init` with server not running
- **THEN** system displays error: "Local server not running. Start it with: bun run apps/local-server/src/run.ts"

### Requirement: Remove repository
The system SHALL unregister a repository via `aop repo:remove`.

#### Scenario: Remove repo via API
- **WHEN** user runs `aop repo:remove [path]` with server running
- **THEN** system calls DELETE /api/repos/:id and displays confirmation

#### Scenario: Remove repo when server not running
- **WHEN** user runs `aop repo:remove [path]` with server not running
- **THEN** system displays error: "Local server not running. Start it with: bun run apps/local-server/src/run.ts"

### Requirement: Mark task ready
The system SHALL mark a task as ready via `aop task:ready`.

#### Scenario: Mark task ready via API
- **WHEN** user runs `aop task:ready <task_id>` with server running
- **THEN** system calls POST /api/repos/:repoId/tasks/:taskId/ready and displays confirmation

#### Scenario: Mark task ready when server not running
- **WHEN** user runs `aop task:ready <task_id>` with server not running
- **THEN** system displays error: "Local server not running. Start it with: bun run apps/local-server/src/run.ts"

### Requirement: Get configuration
The system SHALL display configuration values via `aop config:get`.

#### Scenario: Get single value via API
- **WHEN** user runs `aop config:get <key>` with server running
- **THEN** system calls GET /api/config/:key and displays the value

#### Scenario: Get all values via API
- **WHEN** user runs `aop config:get` without key with server running
- **THEN** system calls GET /api/config and displays all keys and values

#### Scenario: Get config when server not running
- **WHEN** user runs `aop config:get` with server not running
- **THEN** system displays error: "Local server not running. Start it with: bun run apps/local-server/src/run.ts"

### Requirement: Set configuration
The system SHALL update configuration values via `aop config:set`.

#### Scenario: Set valid value via API
- **WHEN** user runs `aop config:set <key> <value>` with server running
- **THEN** system calls PUT /api/config/:key with value and displays confirmation

#### Scenario: Set config when server not running
- **WHEN** user runs `aop config:set <key> <value>` with server not running
- **THEN** system displays error: "Local server not running. Start it with: bun run apps/local-server/src/run.ts"

### Requirement: Remove task
The system SHALL remove a task via `aop task:remove`.

#### Scenario: Remove task via API
- **WHEN** user runs `aop task:remove <task_id>` with server running
- **THEN** system calls DELETE /api/repos/:repoId/tasks/:taskId

#### Scenario: Remove working task
- **WHEN** user runs `aop task:remove <task_id>` for a WORKING task
- **THEN** system prompts for confirmation, then server aborts agent and marks task REMOVED

#### Scenario: Remove task when server not running
- **WHEN** user runs `aop task:remove <task_id>` with server not running
- **THEN** system displays error: "Local server not running. Start it with: bun run apps/local-server/src/run.ts"

### Requirement: Force remove repository
The system SHALL allow force removal of repositories with working tasks via `aop repo:remove --force`.

#### Scenario: Force remove repo via API
- **WHEN** user runs `aop repo:remove --force` for a repo with WORKING tasks and server running
- **THEN** system calls DELETE /api/repos/:id?force=true, server aborts tasks and removes repo

## REMOVED Requirements

### Requirement: Start daemon
**Reason**: Server is now a standalone app. Users start it directly via `bun run apps/local-server/src/run.ts` or system service manager (systemd, launchd, Docker).
**Migration**: Run `bun run apps/local-server/src/run.ts` or configure a system service.

### Requirement: Stop daemon
**Reason**: Server is now a standalone app. Users stop it via Ctrl+C, `kill`, or system service manager.
**Migration**: Use Ctrl+C in terminal, `kill <pid>`, or stop via system service manager.

### Requirement: Manual task execution
**Reason**: POC feature no longer needed. Task execution is handled by the queue processor.
**Migration**: Use `aop task:ready` to queue a task for execution instead of running it manually.
