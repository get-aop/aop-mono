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

AOP supports idea-first planning with the `/aop:from-scratch` skill and requirements-driven ingestion with the `/aop:from-ticket` skill inside Codex or Claude Code, including Linear-powered flows for teams managing work outside the repo.

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

The dashboard is available by default at `http://localhost:25160`.

### Main creation flows

```text
/aop:from-scratch <idea>
/aop:from-ticket <github-issue|linear-ticket|file|pasted-text>
```

These are AOP skills that you run inside Codex or Claude Code, not terminal commands.

`/aop:from-scratch` is the idea-first path. `/aop:from-ticket` is the import path for existing requirements, including Linear-backed work.

That is the normal way to start using AOP after install. AOP runs the creation flow, writes the task docs under `docs/tasks/<task-slug>/`, and then asks whether the imported or generated tasks should be marked `READY` immediately.

If you choose `yes`, AOP marks the task `READY` and execution starts automatically.

If you choose `no`, you can review or edit the generated task files first and then start execution later either from the dashboard or from the CLI with:

```bash
aop task:ready <task-id>
```

You can also inspect the system state at any time with:

```bash
aop status
```

### Linear OAuth

For interactive use, configure Linear from the dashboard Settings page or from the CLI:

```bash
aop linear:configure --client-id <linear-client-id> --callback-url http://127.0.0.1:25150/api/linear/callback
aop linear:connect
aop linear:status
aop linear:unlock
aop linear:disconnect
```

OAuth tokens are stored in the OS credential store on macOS and Linux. For CI or headless usage, `LINEAR_API_KEY` remains available as a read-only fallback. Environment variables `AOP_LINEAR_CLIENT_ID` and `AOP_LINEAR_CALLBACK_BASE` still work as fallbacks, but the preferred interactive flow is to save the client ID and callback URL through the dashboard or `aop linear:configure`.

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
