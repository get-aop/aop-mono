## ADDED Requirements

### Requirement: CLI command entrypoint
The system SHALL provide an `aop create-task` CLI command.

#### Scenario: Start with description
- **WHEN** user runs `aop create-task "build user auth"`
- **THEN** system starts brainstorming session with the description as context

#### Scenario: Start without description
- **WHEN** user runs `aop create-task` without arguments
- **THEN** system prompts for task description interactively

#### Scenario: Command options
- **WHEN** user runs `aop create-task --help`
- **THEN** system shows available options: `--debug`, `--raw`

### Requirement: Orchestration service
The system SHALL orchestrate the brainstorming and handoff flow.

#### Scenario: Start brainstorming session
- **WHEN** create-task command starts
- **THEN** system creates session record in database
- **AND** spawns Claude session with brainstorming skill prompt

#### Scenario: Question loop
- **WHEN** Claude asks a question via AskUserQuestion
- **THEN** system kills subprocess, displays question via terminal UI
- **AND** collects user answer, resumes session with answer
- **AND** repeats until brainstorming completes

#### Scenario: Detect brainstorming complete
- **WHEN** Claude outputs `[BRAINSTORM_COMPLETE]` marker with JSON
- **THEN** system extracts gathered requirements (title, description, requirements, acceptance criteria)

#### Scenario: Handoff to opsx:new
- **WHEN** brainstorming completes successfully
- **THEN** system invokes opsx:new skill with gathered context
- **AND** passes title, description, and requirements as input

#### Scenario: Continuation on incomplete workflow
- **WHEN** session ends without expected completion marker
- **THEN** system resumes with continuation prompt (max 3 retries)

### Requirement: Question enforcer
The system SHALL enforce one-question-at-a-time rule.

#### Scenario: Single question allowed
- **WHEN** Claude sends AskUserQuestion with exactly 1 question
- **THEN** system accepts and displays the question

#### Scenario: Multiple questions rejected
- **WHEN** Claude sends AskUserQuestion with more than 1 question
- **THEN** system auto-resumes with error message
- **AND** logs multi-question violation

#### Scenario: Max retries on violation
- **WHEN** Claude repeatedly sends multiple questions (5 times)
- **THEN** system fails with enforcement error

#### Scenario: Question count limit
- **WHEN** question count reaches configured maximum (default 7)
- **THEN** system signals to Claude to conclude brainstorming

### Requirement: Terminal UI
The system SHALL display questions and collect answers interactively.

#### Scenario: Display single-select question
- **WHEN** question has options with multiSelect=false
- **THEN** system displays numbered options
- **AND** user selects by entering number

#### Scenario: Display multi-select question
- **WHEN** question has options with multiSelect=true
- **THEN** system displays numbered options
- **AND** user selects multiple by entering comma-separated numbers

#### Scenario: Display open-ended question
- **WHEN** question has no predefined options
- **THEN** system prompts for free-text input

#### Scenario: Show tool use indicators
- **WHEN** Claude uses tools (Read, Write, Glob, etc.)
- **THEN** system displays tool name as status indicator

#### Scenario: Show progress
- **WHEN** question is displayed
- **THEN** system shows question count (e.g., "Question 2/7")

### Requirement: Session persistence
The system SHALL persist session state for resume capability.

#### Scenario: Create session record
- **WHEN** brainstorming starts
- **THEN** system creates record in interactive_sessions table
- **AND** records repo_id, claude_session_id, status=active

#### Scenario: Track question count
- **WHEN** question is asked
- **THEN** system increments question_count in session record

#### Scenario: Store messages
- **WHEN** user answers question
- **THEN** system stores message in session_messages table
- **AND** records role, content, timestamp

#### Scenario: Resume interrupted session
- **WHEN** CLI restarts with active session
- **THEN** system can resume from last state using stored claude_session_id

#### Scenario: Mark session completed
- **WHEN** brainstorming completes and handoff succeeds
- **THEN** system updates session status to completed
- **AND** records change_path created by opsx:new

### Requirement: Error handling
The system SHALL handle errors gracefully.

#### Scenario: Claude process crash
- **WHEN** Claude subprocess exits unexpectedly
- **THEN** system logs error, updates session status
- **AND** displays user-friendly error message

#### Scenario: User cancellation
- **WHEN** user presses Ctrl+C during question
- **THEN** system updates session status to cancelled
- **AND** exits cleanly

#### Scenario: Timeout
- **WHEN** Claude does not respond within timeout (default 5 minutes)
- **THEN** system kills subprocess, marks session as timeout error
