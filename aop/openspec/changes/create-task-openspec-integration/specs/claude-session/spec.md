## ADDED Requirements

### Requirement: Spawn Claude subprocess
The system SHALL spawn Claude Code as a subprocess with stream-json output format.

#### Scenario: Spawn with prompt
- **WHEN** session starts with a prompt
- **THEN** system spawns `claude` binary with `--output-format stream-json` and `--print` flags
- **AND** passes prompt as positional argument
- **AND** closes stdin immediately after spawn

#### Scenario: Spawn with session resume
- **WHEN** session resumes with an existing session ID
- **THEN** system spawns `claude` binary with `--resume <sessionId>` flag
- **AND** passes the user's answer as positional argument

#### Scenario: Spawn with permissions skip
- **WHEN** session is configured for non-interactive mode
- **THEN** system includes `--dangerously-skip-permissions` flag

### Requirement: Stream JSON parsing
The system SHALL parse the JSON stream output from Claude.

#### Scenario: Parse assistant messages
- **WHEN** Claude outputs a message event
- **THEN** system emits `message` event with content

#### Scenario: Parse tool use
- **WHEN** Claude outputs a tool_use event
- **THEN** system emits `toolUse` event with tool name and input

#### Scenario: Detect AskUserQuestion tool
- **WHEN** Claude uses the `AskUserQuestion` tool
- **THEN** system emits `question` event with the question data
- **AND** immediately kills the subprocess

#### Scenario: Handle malformed JSON
- **WHEN** stream contains invalid JSON line
- **THEN** system logs warning and continues parsing

### Requirement: Kill/resume pattern
The system SHALL support killing and resuming sessions for interactive Q&A.

#### Scenario: Kill preserves session
- **WHEN** subprocess is killed
- **THEN** Claude's session file is preserved on disk
- **AND** session ID is retained for resume

#### Scenario: Resume with answer
- **WHEN** session resumes after kill
- **THEN** system spawns new subprocess with `--resume` flag
- **AND** Claude interprets prompt as response to pending question

#### Scenario: Multiple question rounds
- **WHEN** Claude asks multiple questions across conversation
- **THEN** system supports repeated kill/resume cycles
- **AND** maintains session continuity

### Requirement: Session lifecycle
The system SHALL manage session state through its lifecycle.

#### Scenario: Session created
- **WHEN** new session starts
- **THEN** system generates unique session ID
- **AND** records session start time

#### Scenario: Session active
- **WHEN** subprocess is running
- **THEN** system tracks process PID
- **AND** monitors process exit

#### Scenario: Session completed
- **WHEN** subprocess exits with code 0
- **THEN** system marks session as completed
- **AND** emits `completed` event

#### Scenario: Session error
- **WHEN** subprocess exits with non-zero code
- **THEN** system marks session as error
- **AND** emits `error` event with exit code

### Requirement: Event emission
The system SHALL emit events for session activity.

#### Scenario: Events emitted
- **WHEN** session activity occurs
- **THEN** system emits typed events: `message`, `toolUse`, `question`, `completed`, `error`

#### Scenario: Event subscription
- **WHEN** caller subscribes to events
- **THEN** system delivers events in order received
