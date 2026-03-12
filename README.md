# AOP

AOP is a local-first operating layer for teams shipping software with AI agents. It turns task docs, workflow modules, and background orchestration into a repeatable delivery loop: capture work, queue it, run it in isolated git worktrees, and keep status visible from the CLI.

## What The App Brings

### Workflow modules instead of one-off prompting

AOP is built around workflow modules that move work through implementation, testing, review, retry, and completion. That gives teams a system for execution, not just a prompt library.

### Repo-local task operations

Task state lives in repository documents under `docs/tasks/<task-slug>/`. AOP watches those docs, tracks lifecycle changes, and turns them into executable work.

### Local-first execution

Agents run on your machine, in local git worktrees, against your real repository. The local server handles orchestration so the CLI can stay fast and focused.

### Import and planning flows

AOP supports idea-first planning with `/aop:from-scratch` and requirements-driven ingestion with `/aop:from-ticket`, including Linear-powered flows for teams managing work outside the repo.

### Operational visibility

You can inspect status, task progress, and background capacity from the CLI while the local server continues running after the terminal closes.

## Install

### Prerequisites

- Bun
- Git
- At least one supported agent CLI installed locally
- macOS or Linux

### One-command setup

```bash
git clone <repository-url>
cd <repository-directory>
./install
```

`./install` installs dependencies, links the `aop` CLI globally, initializes OpenSpec tooling, and starts the local server as a per-user background service.

## Run The App

After install, the local server should already be running.

```bash
# Check the system
aop status

# Register the current repository
aop repo:init .

# Mark a task ready for execution
aop task:ready <task-id>
```

### Main creation flows

```text
/aop:from-scratch <idea>
/aop:from-ticket <github-issue|linear-ticket|file|pasted-text>
```

`/aop:from-scratch` is the idea-first path. `/aop:from-ticket` is the import path for existing requirements, including Linear-backed work.

For Linear OAuth, tokens are stored in the OS credential store on macOS and Linux. Configure OAuth with `AOP_LINEAR_CLIENT_ID`, and optionally override the localhost callback base with `AOP_LINEAR_CALLBACK_BASE`. For CI or headless usage, `LINEAR_API_KEY` remains available as a read-only fallback.

### Service checks

```bash
# Linux
systemctl --user status aop-local-server

# macOS
launchctl list | grep com.aop.local-server
```

## How AOP Improves The Delivery Loop

1. Work is captured in repo-local task docs.
2. The watcher detects task changes and keeps the backlog current.
3. Tasks move through states such as `DRAFT`, `READY`, `WORKING`, `DONE`, and `BLOCKED`.
4. Workflow modules decide how implementation, verification, review, and failure handling progress.
5. The executor runs agents in isolated worktrees so the main branch stays stable while work is in flight.
6. The local server keeps the system alive in the background while the CLI remains a thin control surface.

The result is a more disciplined way to run AI-assisted development across repositories without collapsing into manual orchestration.

## Contributing

- Run `bun check` before opening a PR.
- Add or update relevant tests with every change.
- Keep functions and modules focused.
- Preserve the local-first, thin-CLI architecture.

For the technical contributor guide, architecture notes, workspace layout, and tooling setup, see [`aop/README.md`](./aop/README.md).
