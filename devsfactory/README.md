# devsfactory

Turn Claude Code into a dev team.

## What is devsfactory?

devsfactory is an orchestration layer that transforms Claude Code into a team of AI agents working in parallel on your codebase. You define a task, devsfactory breaks it into subtasks, and multiple agents implement them concurrently—each in isolated git worktrees to avoid conflicts.

## Features

- **Parallel agent execution** — Run multiple agents simultaneously (configurable concurrency)
- **Automatic task breakdown** — Tasks are split into subtasks with dependency management
- **Git worktree isolation** — Each agent works in its own worktree, no merge conflicts during development
- **Auto-merge with conflict resolution** — Completed subtasks merge automatically; a conflict-solver agent handles any conflicts
- **Real-time web dashboard** — Monitor agent progress, view live output, create tasks, and connect agents
- **WebSocket-based architecture** — Agents and dashboards connect to the server for real-time updates
- **Remote agent support** — Distribute agents across multiple machines
- **Agent-local SQLite storage** — Projects and tasks stored in `~/.aop/aop.db` on each agent machine
- **Priority-based scheduling** — Finishing work takes precedence over starting new work

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AOP Server (aop server)                       │
│                    (runs on cloud/remote machine)                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Stateless coordinator:                                          │
│  - Receives snapshots from agents                                │
│  - Keeps in-memory state per project                             │
│  - Dispatches job references to agents                           │
│  - Broadcasts events to dashboards                               │
│                                                                  │
│  WebSocket Endpoints:                                            │
│    /api/agents  - Agent connections (job dispatch)               │
│    /api/events  - Dashboard connections (real-time updates)      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
              ▲                              ▲
              │                              │
     WebSocket│(/api/agents)       WebSocket │(/api/events)
              │                              │
┌─────────────┴─────────────┐    ┌───────────┴───────────────────┐
│   Agent Machine (aop agent)│    │   Dashboard (aop dashboard)    │
│   (runs on user's machine) │    │   (runs on user's machine)     │
├───────────────────────────┤    ├────────────────────────────────┤
│                           │    │                                 │
│  ┌─────────────────────┐  │    │  ┌──────────────┐              │
│  │    Claude Code      │  │    │  │ Web Dashboard│  Real-time:  │
│  │    (local execution)│  │    │  │ localhost:3001│ - agents     │
│  └─────────────────────┘  │    │  └──────────────┘  - tasks     │
│                           │    │                    - subtasks  │
│  ┌─────────────────────┐  │    │                                 │
│  │   Local SQLite      │  │    └─────────────────────────────────┘
│  │   ~/.aop/aop.db     │  │
│  │   (task data)       │  │
│  └─────────────────────┘  │
│                           │
│  ┌─────────────────────┐  │
│  │   Local Codebase    │  │
│  │   + .devsfactory/   │  │
│  └─────────────────────┘  │
│                           │
│  Receives: job references │
│  Reads: task data locally │
│  Executes: Claude Code    │
│  Streams: results back    │
│                           │
└───────────────────────────┘
```

### Storage (Agent-Side)

Each agent machine stores project and task data locally in `~/.aop/`:

```
~/.aop/
├── config.yaml           # Agent configuration (server URL, secret)
├── aop.db                # SQLite database (projects, tasks, subtasks, plans)
├── worktrees/            # Git worktrees for agent isolation
├── logs/                 # Agent execution logs
└── brainstorm/           # Brainstorm session data
```

**Why local storage on agents:**
- Agents read task data locally (no server round-trips)
- Server only sends lightweight job references (task folder, subtask file)
- Agents generate prompts from local SQLite + markdown templates
- Enables fast, parallel execution across distributed agents

**Project workspace storage:**
- `.devsfactory/` still exists inside each repo to store generated markdown (`task.md`, `plan.md`, `001-*.md`)
- After `aop create-task`, the CLI syncs `.devsfactory/` into the agent’s SQLite
- SQLite is the source of truth for scheduling and status updates

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                         TASK                                │
│  .devsfactory/my-feature/task.md                            │
│  Status: PENDING → INPROGRESS → REVIEW → DONE               │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                         PLAN                                │
│  .devsfactory/my-feature/plan.md                            │
│  Created by: task-planner skill (human-driven brainstorm)   │
└─────────────────────────────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   Subtask 001   │ │   Subtask 002   │ │   Subtask 003   │
│   (parallel)    │ │ (depends on 001)│ │ (depends on 002)│
│                 │ │                 │ │                 │
│ Implementation  │ │ Implementation  │ │ Implementation  │
│      ↓          │ │      ↓          │ │      ↓          │
│    Review       │ │    Review       │ │    Review       │
│      ↓          │ │      ↓          │ │      ↓          │
│    Merge        │ │    Merge        │ │    Merge        │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

**The workflow:**

1. **Create a task** using CLI: `aop create-task "add user authentication"`
2. **CLI syncs** `.devsfactory/` into local SQLite with initial status **BACKLOG**
3. **Start the server**: `aop server --secret <your-secret>` — stateless coordinator
4. **Start the dashboard**: `aop dashboard` — local UI (proxies to remote server)
5. **Start an agent**: `aop agent` — connects and watches SQLite
6. **Move task to PENDING**: `aop start-task --task-id <id>`
7. **Agent publishes snapshot** when it sees `PENDING` in SQLite
8. **Server schedules jobs** and dispatches them to the agent
9. **Agent executes** subtasks locally, updates SQLite statuses
10. **Task moves to REVIEW** when all subtasks finish, ready for human approval

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.0 or later
- [Git](https://git-scm.com/)
- [Claude Code](https://github.com/anthropics/claude-code) (authenticated)

### Installation

```bash
# Clone the repository
git clone https://github.com/get-aop/aop.git
cd devsfactory

# Install dependencies
bun install

# Link globally (makes 'aop' command available)
bun link
```

### Register Your Project

```bash
# Navigate to your project (must be a git repository)
cd /path/to/my-project

# Register it with AOP
aop init
```

### Create Your First Task

```bash
# Create a task via CLI (interactive Claude session)
aop create-task "Add user authentication with JWT tokens"
```

### Start AOP

```bash
# Terminal 1: Start the server
aop server --secret <your-secret>

# Terminal 2: Start the dashboard
aop dashboard

# Terminal 3: Start an agent
aop agent

# Terminal 4: Move task to PENDING (uses SQLite task id printed by create-task)
aop start-task --task-id <id>
```

This will:
- Start the stateless coordinator server
- Launch the web dashboard at `http://localhost:3001`
- Connect an agent to process tasks
- Publish a snapshot when tasks become `PENDING`
- Show real-time agent progress in the dashboard

## Web Dashboard

The dashboard provides real-time monitoring and control of your AOP instance:

- **Task List** — View all tasks across projects with status indicators
- **Subtask Grid** — See subtask dependencies and completion status
- **Live Agent Output** — Watch agents work in real-time as they process subtasks
- **Agent Control** — Connect/disconnect local agents with a single click from the header
- **Quick Task Creation** — Create new tasks directly from the dashboard header input
- **Cross-Project View** — See tasks from all registered projects in one place

The dashboard connects to the server via WebSocket at `/api/events` for instant updates. When running locally, `aop dashboard` proxies `/api/events` to the remote server.

Note: Dashboard task creation writes a simple task into local SQLite with status `BACKLOG`. Use `aop create-task` for the full Claude breakdown flow.

### Using the Dashboard

1. **Start the server:** `aop server --secret <your-secret>` (can be on a remote machine)
2. **Start the dashboard:** `aop dashboard`
3. **Open browser:** Navigate to `http://localhost:3001`
4. **Start an agent:** `aop agent` (in another terminal)
5. **Create a task:** Enter a description in the header input and click "Create"
6. **Monitor progress:** Watch the agent work in the Activity Feed
7. **Start execution:** Use `aop start-task --task-id <id>` (UI support planned)

### Dashboard Events

The dashboard receives these real-time events:

| Event | Description |
|-------|-------------|
| `state` | Full state sync (tasks, subtasks, plans) |
| `agentStarted` | Agent began working on a subtask |
| `agentOutput` | Live output from an agent |
| `agentCompleted` | Agent finished its work |
| `subtaskChanged` | Subtask status updated |
| `taskChanged` | Task status updated |
| `jobFailed` | Agent job failed (will retry) |
| `jobRetrying` | Agent job retrying after failure |

## Configuration

Configuration is read from environment variables. Create a `.env` file in your project root:

```bash
cp .env.example .env
```

### Environment Variables

| Variable                | Default        | Description                    |
| ----------------------- | -------------- | ------------------------------ |
| `DEVSFACTORY_DIR`       | `.devsfactory` | Task definitions directory     |
| `MAX_CONCURRENT_AGENTS` | `2`            | Maximum parallel agents        |
| `DASHBOARD_PORT`        | `3001`         | Dashboard server port          |
| `DEBOUNCE_MS`           | `100`          | SQLite poll debounce (ms)      |
| `RETRY_INITIAL_MS`      | `2000`         | Initial retry backoff (ms)     |
| `RETRY_MAX_MS`          | `300000`       | Maximum retry backoff (5 min)  |
| `RETRY_MAX_ATTEMPTS`    | `5`            | Maximum retry attempts         |
| `DEBUG`                 | `false`        | Enable debug logging           |
| `LOG_MODE`              | `pretty`       | Log format: `pretty` or `json` |
| `AOP_REMOTE_SECRET`     | -              | Secret for agent auth          |
| `AOP_PROJECT_NAME`      | -              | Project name (for agents)      |
| `AOP_DEVSFACTORY_DIR`   | -              | Devsfactory dir (for agents)   |
| `AOP_SERVER_URL`        | -              | Server URL (for agents)        |

## Tasks

Tasks are persisted in SQLite (`~/.aop/aop.db`) and still generated as markdown files in `.devsfactory/`:

```markdown
---
title: string # Task title
status: PENDING # DRAFT | BACKLOG | PENDING | INPROGRESS | BLOCKED | REVIEW | DONE
created: 2026-01-28 # ISO date
priority: high # high | medium | low
tags: [string] # Optional tags
assignee: null # Optional assignee
dependencies: [] # Other task folders this depends on
---

## Description

What needs to be done.

## Requirements

Specific requirements.

## Acceptance Criteria

- [ ] Checkbox items for verification
```

**Task statuses:**

- `DRAFT` — Work in progress, not ready for agents
- `BACKLOG` — Ready but not prioritized
- `PENDING` — Ready to execute (triggers snapshot to server)
- `INPROGRESS` — Agents are working on subtasks
- `BLOCKED` — Requires human intervention
- `REVIEW` — All work complete, ready for human review
- `DONE` — Completed and merged

## CLI Reference

The `aop` command provides project management, orchestration, and task creation capabilities.

```bash
aop [command] [options]
```

### Global Options

| Option | Description |
|--------|-------------|
| `-h, --help` | Show help message |
| `-v, --version` | Show version number |

### Commands Overview

| Command | Description |
|---------|-------------|
| `server` | Run the stateless coordinator (agent coordination) |
| `dashboard` | Run the web dashboard (connects to server) |
| `agent` | Run as an agent (connects to server) |
| `init` | Register a git repository with AOP |
| `projects` | List and manage registered projects |
| `status` | Show task status across projects |
| `create-task` | Create a new task via Claude Code |
| `start-task` | Move a task to PENDING (by folder or SQLite id) |
| `sys-debug` | Debug an issue via Claude Code |
| `stats` | Export timing statistics |

---

### `aop server`

Start the stateless AOP server. This coordinates agents and exposes WebSocket endpoints.

```bash
aop server [options]
```

**Options:**
- `-p, --port <port>` — Server port (default: 3001)
- `--max-agents <n>` — Max concurrent agents (default: 2)
- `--secret <secret>` — Shared secret for agent auth
- `--generate-secret` — Generate a new secret and exit

**Examples:**
```bash
aop server --secret mykey123            # Start server (secret required)
aop server -p 8080                      # Use custom port
aop server --max-agents 4               # Allow 4 concurrent agents
aop server --secret mykey123            # Set agent auth secret
```

**What happens:**
1. Accepts agent connections and requests task state snapshots
2. Maintains in-memory task state from agent updates
3. Exposes WebSocket endpoints for agents (`/api/agents`) and dashboards (`/api/events`)
4. Broadcasts state updates to connected dashboards

---

### `aop dashboard`

Start the web dashboard UI. Connects to a remote or local server.

```bash
aop dashboard [options]
```

**Options:**
- `-p, --port <port>` — Dashboard port (default: 3001)
- `--server <url>` — Server URL to connect to (default: from `~/.aop/config.yaml`)

**Examples:**
```bash
aop dashboard                           # Connect using config.yaml
aop dashboard --server http://192.168.1.10:3001
aop dashboard -p 8080                   # Run dashboard on different port
```

**Configuration:**

The server URL can be stored in `~/.aop/config.yaml`:
```yaml
server:
  url: http://192.168.1.10:3001
```

**What happens:**
1. Starts local web server for the dashboard UI
2. Connects to the server via WebSocket (proxying events to local clients)
3. Displays real-time task progress and agent activity

---

### `aop agent`

Run as an agent that connects to a server and executes Claude Code locally.

```bash
aop agent [options]
```

**Options:**
- `--server <url>` — WebSocket URL of the server (default: from `~/.aop/config.yaml`)
- `--secret <secret>` — Shared secret for authentication
- `--init` — Initialize agent configuration
- `-m, --model <model>` — Default model (opus, sonnet, haiku)
- `--project-name <name>` — Project name for local storage access
- `--devsfactory-dir <path>` — Devsfactory directory path
- `--no-reconnect` — Disable automatic reconnection

**Examples:**
```bash
aop agent --init                        # Set up agent config
aop agent                               # Connect using saved config
aop agent --server ws://192.168.1.10:3001/api/agents --secret mykey
```

**Configuration:**

Agent settings can be stored in `~/.aop/config.yaml`:
```yaml
agent:
  server: ws://192.168.1.10:3001/api/agents
  secret: your-secret-here
  projectName: my-project
  devsfactoryDir: /path/to/.devsfactory
```

**Agent Flow:**
1. Agent connects to server via WebSocket
2. Authenticates with HMAC challenge-response
3. Receives lightweight job assignments (task references)
4. Reads task data from local SQLite database
5. Generates prompts locally and executes Claude Code
6. Streams results back to server

---

### `aop init`

Register a git repository with AOP for global access.

```bash
aop init [path]
```

**Arguments:**
- `path` — Path to the git repository (default: current directory)

**Examples:**
```bash
aop init                    # Register current directory
aop init /path/to/my-repo   # Register a specific repository
```

---

### `aop projects`

List and manage registered projects.

```bash
aop projects [subcommand] [name]
```

**Subcommands:**
- `(none)` — List all registered projects
- `remove <name>` — Unregister a project

**Examples:**
```bash
aop projects                # List all projects
aop projects remove my-app  # Unregister 'my-app'
```

---

### `aop status`

Show task status for one or more projects.

```bash
aop status [project]
```

**Arguments:**
- `project` — Project name (optional)

**Examples:**
```bash
aop status              # Show current project or all projects
aop status my-app       # Show detailed status for 'my-app'
```

---

### `aop create-task`

Create a new task by launching an interactive Claude Code session.

```bash
aop create-task <description> [options]
```

**Arguments:**
- `description` — Task description (use quotes for multi-word descriptions)

**Options:**
- `-p, --project <name>` — Project name (default: auto-detect from cwd)
- `-s, --slug <name>` — Custom slug for the task folder name
- `-d, --debug` — Enable Claude debug mode

**Examples:**
```bash
aop create-task "Add user authentication with JWT"
aop create-task "Fix the login bug" -p my-app
aop create-task "Implement dark mode" --slug dark-mode
```

**Notes:**
- Creates `.devsfactory/` markdown via Claude Code
- Syncs the result into SQLite with initial status `BACKLOG`
- Prints the SQLite task id for later `start-task`

---

### `aop start-task`

Move a task to `PENDING` so the agent will snapshot to the server.

```bash
aop start-task <task-folder> [--project <name>]
aop start-task --task-id <id> [--project <name>]
```

**Examples:**
```bash
aop start-task 20260201123000-add-auth
aop start-task --task-id 42
```

---

### `aop sys-debug`

Launch a systematic debugging session via Claude Code.

```bash
aop sys-debug <description> [options]
```

**Arguments:**
- `description` — Bug or issue description

**Options:**
- `-p, --project <name>` — Project name (default: auto-detect from cwd)
- `-d, --debug` — Enable Claude debug mode

**Examples:**
```bash
aop sys-debug "Tests are failing with timeout errors"
aop sys-debug "Login page crashes on submit" -p my-app
```

---

### `aop stats`

Export timing statistics for a completed task as JSON.

```bash
aop stats <task-folder>
```

**Examples:**
```bash
aop stats add-authentication
aop stats fix-login-bug > stats.json
```

---

## Distributed Mode

AOP supports distributed execution across multiple machines.

### Setup

1. **Generate a shared secret:**
   ```bash
   aop server --generate-secret
   ```

2. **Start the server (on central machine):**
   ```bash
   aop server --secret <your-secret>
   ```

3. **Start the dashboard (on your machine):**
   ```bash
   aop dashboard --server http://<server-ip>:3001
   ```

4. **Connect agents (on any machine):**
   ```bash
   aop agent --server ws://<server-ip>:3001/api/agents --secret <your-secret>
   ```

Task creation and status changes still happen on the agent machine (SQLite). Use `aop create-task` and then `aop start-task --task-id <id>` to trigger execution.

### Lightweight Protocol

The agent protocol is designed for efficiency:

- Server sends **task references** (not full prompts)
- Agents read task data from local SQLite database (`~/.aop/aop.db`)
- Prompts are generated locally by the agent
- When a task status becomes `PENDING`, the agent sends a full state snapshot
- Only results are streamed back to server

This minimizes network traffic and allows agents to work with full local context.

### How It Works

- Server coordinates work and broadcasts state via WebSocket
- Agents receive lightweight job assignments and execute Claude Code locally
- Agent output is streamed back to the server in real-time
- Dashboard connects to server and displays all agent activity

### Security

- All agent connections require the shared secret
- Agents authenticate on WebSocket handshake via HMAC challenge-response
- Invalid secrets are rejected immediately

## Workflow Examples

**Setting up a new project:**
```bash
cd /path/to/my-project
aop init                           # Register the project
aop create-task "Add user login"   # Create first task
aop start-task --task-id <id>      # Move to PENDING
```

**Local development (single machine):**
```bash
# Terminal 1
aop server

# Terminal 2
aop dashboard

# Terminal 3
aop agent

# Terminal 4
aop start-task --task-id <id>
```

**Distributed setup (multiple machines):**
```bash
# On server machine:
aop server --secret mysecret123

# On your machine:
aop dashboard --server http://server-ip:3001

# On agent machines:
aop agent --server ws://server-ip:3001/api/agents --secret mysecret123

# On agent machine (per task):
aop start-task --task-id <id>
```

**Quick debugging session:**
```bash
aop sys-debug "Users can't upload files larger than 1MB"
```

## API Reference

Notes:
- Remote server endpoints are read-only coordination endpoints.
- Local dashboard server (running on the agent machine) handles task creation and status updates by writing to SQLite.

### REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/state` | GET | Get current server state |
| `/api/projects` | GET | List all projects |
| `/api/projects/:name/tasks` | GET | Get tasks for a project |
| `/api/tasks/:folder/status` | POST | Update task status (local dashboard server) |
| `/api/subtasks/:folder/:file/status` | POST | Update subtask status (local dashboard server) |
| `/api/tasks/:folder/subtasks/:file/logs` | GET | Get subtask logs |
| `/api/tasks/create` | POST | Create a task from description (local dashboard server) |

### WebSocket Endpoints

| Endpoint | Description |
|----------|-------------|
| `/api/events` | Dashboard event stream |
| `/api/agents` | Remote agent connection (requires HMAC auth) |

### WebSocket Events (Dashboard)

| Event | Direction | Description |
|-------|-----------|-------------|
| `state` | Server → Client | Full state sync |
| `agentStarted` | Server → Client | Agent began working |
| `agentOutput` | Server → Client | Live agent output |
| `agentCompleted` | Server → Client | Agent finished work |
| `taskChanged` | Server → Client | Task status updated |
| `subtaskChanged` | Server → Client | Subtask status updated |
| `jobFailed` | Server → Client | Agent job failed |
| `jobRetrying` | Server → Client | Agent job retrying |

### WebSocket Protocol (Agents)

| Message | Direction | Description |
|---------|-----------|-------------|
| `auth:challenge` | Server → Agent | Send HMAC authentication challenge |
| `auth:hello` | Agent → Server | Initial connection with capabilities |
| `auth:response` | Agent → Server | HMAC signature response |
| `auth:success` | Server → Agent | Authentication succeeded |
| `job:assign` | Server → Agent | Lightweight job assignment (task reference) |
| `job:output` | Agent → Server | Stream Claude CLI output |
| `job:completed` | Agent → Server | Job finished successfully |
| `job:failed` | Agent → Server | Job failed |
| `state:snapshot` | Agent → Server | Full state snapshot from SQLite |
| `state:delta` | Agent → Server | Incremental state updates |
| `heartbeat` | Agent → Server | Keep-alive with status |

## Development

```bash
# Run unit tests
bun test src/

# Run dashboard tests
bun test packages/dashboard/

# Run e2e tests
bun run test:e2e

# Type checking
bun run typecheck

# Linting
bun run lint
bun run lint:fix

# Build
bun run build
```

## Links

- [RUNBOOK.md](./docs/RUNBOOK.md) — Troubleshooting and recovery guide
