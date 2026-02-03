## ADDED Requirements

### Requirement: LLMProvider interface

The system SHALL define an `LLMProvider` interface with:
- `name: string` - readonly identifier for the provider
- `run(options: RunOptions): Promise<RunResult>` - execute an LLM agent session

#### Scenario: Provider has a name
- **WHEN** a provider is instantiated
- **THEN** the `name` property SHALL return the provider's identifier

#### Scenario: Provider can run a session
- **WHEN** `run()` is called with valid options
- **THEN** the provider SHALL spawn the LLM agent and return a `RunResult`

### Requirement: RunOptions type

The `RunOptions` type SHALL include:
- `prompt: string` - the prompt to send to the LLM agent (required)
- `cwd?: string` - working directory for the agent session (optional)
- `resumeSessionId?: string` - session ID to resume (optional)
- `onOutput?: (data: Record<string, unknown>) => void` - callback for stream output (optional)

#### Scenario: Minimal options
- **WHEN** `run()` is called with only `prompt`
- **THEN** the provider SHALL execute with default working directory and no resume

#### Scenario: Resume session
- **WHEN** `run()` is called with `resumeSessionId`
- **THEN** the provider SHALL attempt to resume the specified session

#### Scenario: Output callback
- **WHEN** `run()` is called with `onOutput` callback
- **THEN** the provider SHALL call `onOutput` with parsed JSON for each stream message

### Requirement: RunResult type

The `RunResult` type SHALL include:
- `exitCode: number` - the exit code of the LLM agent process
- `sessionId?: string` - the session ID for potential resume (optional)

#### Scenario: Successful completion
- **WHEN** the LLM agent completes successfully
- **THEN** `RunResult.exitCode` SHALL be 0 and `sessionId` SHALL be populated if available

#### Scenario: Failed completion
- **WHEN** the LLM agent exits with error
- **THEN** `RunResult.exitCode` SHALL be non-zero

### Requirement: ClaudeCodeProvider implementation

The system SHALL provide a `ClaudeCodeProvider` class implementing `LLMProvider` that:
- Spawns the `claude` CLI with `--output-format stream-json --verbose --dangerously-skip-permissions`
- Parses JSON lines from stdout
- Extracts `session_id` from stream messages
- Passes parsed JSON objects to `onOutput` callback

#### Scenario: Spawn Claude CLI
- **WHEN** `run()` is called
- **THEN** the provider SHALL spawn `claude` with stream-json output format

#### Scenario: Parse stream output
- **WHEN** Claude CLI emits JSON lines to stdout
- **THEN** the provider SHALL parse each line and call `onOutput` with the parsed object

#### Scenario: Extract session ID
- **WHEN** a stream message contains `session_id`
- **THEN** the provider SHALL capture it and include in `RunResult.sessionId`

#### Scenario: Resume with session ID
- **WHEN** `resumeSessionId` is provided
- **THEN** the provider SHALL pass `--resume <sessionId>` to the Claude CLI
