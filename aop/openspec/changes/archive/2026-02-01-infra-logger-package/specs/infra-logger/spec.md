## ADDED Requirements

### Requirement: Logger Retrieval

The system SHALL allow consumers to obtain a logger instance for any category without prior configuration.

#### Scenario: Get logger by category

- **WHEN** a module calls `getLogger("aop", "orchestrator")`
- **THEN** it receives a Logger instance bound to category `["aop", "orchestrator"]`
- **AND** the logger can be used immediately (no-op if logging not configured)

### Requirement: Logging Configuration

The system SHALL allow applications to configure logging behavior at startup.

#### Scenario: Configure console sink

- **WHEN** an app calls `configureLogging({ sinks: { console: true } })`
- **THEN** all subsequent log messages are written to the console
- **AND** messages include timestamp, level, and category

#### Scenario: Configure with log level

- **WHEN** an app calls `configureLogging({ level: "info" })`
- **THEN** only messages at "info" level or higher are emitted
- **AND** debug/trace messages are suppressed

### Requirement: Runtime Compatibility

The logger SHALL work across all AOP runtime contexts.

#### Scenario: Browser usage

- **WHEN** the logger is imported in a browser environment
- **THEN** it uses `console` methods appropriate for browsers
- **AND** no Node/Bun-specific APIs are required

#### Scenario: Server usage

- **WHEN** the logger is imported in Bun/Node
- **THEN** it can optionally write to file sinks
- **AND** structured JSON output is available
