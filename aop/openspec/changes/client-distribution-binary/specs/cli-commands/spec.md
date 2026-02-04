## MODIFIED Requirements

### Requirement: Command registration is exportable
The CLI SHALL export its command registration as a reusable function so the unified entrypoint can mount the same commands without duplicating definitions.

#### Scenario: registerCommands accepts a cac instance
- **WHEN** the unified entrypoint imports `registerCommands` from `apps/cli`
- **AND** passes a `cac` CLI instance
- **THEN** all existing commands (status, repo:init, repo:remove, task:ready, task:remove, apply, config:get, config:set) are registered on that instance
- **AND** no commands are missing compared to the standalone CLI

#### Scenario: Standalone CLI still works
- **WHEN** `apps/cli/src/main.ts` is run directly (e.g., during development with `bun run`)
- **THEN** it creates its own `cac` instance, calls `registerCommands`, and behaves identically to before

#### Scenario: No side effects on import
- **WHEN** `registerCommands` is imported but not called
- **THEN** no CLI instance is created
- **AND** no commands are registered
- **AND** no logging is configured

### Requirement: Logging setup is exportable
The CLI SHALL export its logging setup function so the unified entrypoint can configure logging once for both CLI and server.

#### Scenario: setupLogging is importable
- **WHEN** the unified entrypoint imports `setupLogging` from `apps/cli`
- **THEN** it can configure logging with the same logic (log dir, log level, file sinks)

#### Scenario: Default log directory uses data directory
- **WHEN** `AOP_LOG_DIR` is not set
- **AND** running inside the compiled binary
- **THEN** logging defaults to `~/.aop/logs/` instead of no file logging
