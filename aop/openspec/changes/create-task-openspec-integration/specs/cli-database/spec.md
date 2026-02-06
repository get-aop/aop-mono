## MODIFIED Requirements

### Requirement: Interactive sessions table
The system SHALL store interactive brainstorming sessions.

#### Scenario: Create session
- **WHEN** brainstorming session starts
- **THEN** system inserts record with id, repo_id, claude_session_id, status, created_at

#### Scenario: Session fields
- **WHEN** session record exists
- **THEN** record includes:
  - `id` (TEXT PRIMARY KEY) - unique session identifier
  - `repo_id` (TEXT, nullable) - reference to repos table if session is repo-scoped
  - `change_path` (TEXT, nullable) - path to OpenSpec change folder when created
  - `claude_session_id` (TEXT) - Claude's session file identifier for resume
  - `status` (TEXT) - one of: active, brainstorming, completed, cancelled, error
  - `question_count` (INTEGER) - number of questions asked
  - `continuation_count` (INTEGER) - number of continuation attempts
  - `created_at` (TEXT) - ISO timestamp
  - `updated_at` (TEXT) - ISO timestamp

#### Scenario: Update session status
- **WHEN** session state changes
- **THEN** system updates status and updated_at fields

#### Scenario: Query active sessions
- **WHEN** CLI needs to find resumable sessions
- **THEN** system can query by status = 'active' or 'brainstorming'

### Requirement: Session messages table
The system SHALL store conversation messages for session history.

#### Scenario: Store message
- **WHEN** message is exchanged in session
- **THEN** system inserts record with session_id, role, content, created_at

#### Scenario: Message fields
- **WHEN** message record exists
- **THEN** record includes:
  - `id` (TEXT PRIMARY KEY) - unique message identifier
  - `session_id` (TEXT) - reference to interactive_sessions table
  - `role` (TEXT) - one of: user, assistant
  - `content` (TEXT) - message content
  - `tool_use_id` (TEXT, nullable) - tool use identifier if message is tool response
  - `created_at` (TEXT) - ISO timestamp

#### Scenario: Query messages by session
- **WHEN** resuming or reviewing session
- **THEN** system can query all messages for a session ordered by created_at

#### Scenario: Foreign key constraint
- **WHEN** session is deleted
- **THEN** associated messages are cascade deleted

### Requirement: Migration
The system SHALL migrate existing databases to include new tables.

#### Scenario: Add tables on startup
- **WHEN** CLI database initializes
- **THEN** system creates interactive_sessions and session_messages tables if not exist

#### Scenario: Preserve existing data
- **WHEN** migration runs on existing database
- **THEN** existing repos, tasks, executions data is preserved
