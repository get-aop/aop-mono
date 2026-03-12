# AOP Developer Guide

This document is for contributors working on AOP itself. The product-facing overview, install flow, and runtime usage live in the root [`README.md`](../README.md).

## Architecture

AOP is organized around three operational layers:

- `apps/local-server`: the local control plane that watches repos, manages the backlog, persists state, and spawns agents
- `apps/cli`: a thin client that talks to the local server over HTTP
- `apps/dashboard` and `apps/server`: operational UI plus the remote workflow-backed product surface

The local server is the center of gravity. It is why the source install flow now sets up a background user service on macOS and Linux and serves the built dashboard from that same process.

## Core Concepts

### Task lifecycle

```text
DRAFT -> READY -> WORKING -> DONE
                    |
                    -> BLOCKED
```

### Workflow modules

Workflow modules control how a `READY` task moves through execution. In practice that means:

- selecting the execution path
- running implementation and verification steps
- interpreting agent signals
- deciding whether work is done, blocked, or needs review/retry

See [`docs/WORKFLOW.md`](../docs/WORKFLOW.md) for the deeper workflow model.

### Local-first execution

Code execution happens in local git worktrees. The remote side coordinates workflow logic, but the source tree and agent execution stay on the developer machine.

## Workspace Layout

```text
apps/
  cli/              thin CLI client
  dashboard/        operational UI
  local-server/     orchestrator, task system, SQLite, execution runtime
  server/           remote workflow-backed services
packages/
  common/           shared schemas and types
  git-manager/      git worktree lifecycle
  infra/            logging and shared infrastructure
  llm-provider/     agent integrations
scripts/
  dev.ts            full development stack
  source-install.ts source setup flow
docs/
  WORKFLOW.md       execution model
  superpowers/      planning artifacts
```

## Development Setup

### Source install

From the repository root:

```bash
./install
```

That is the fastest way to get the CLI and local server working from source.

### Full contributor stack

Run this from the repository root:

```bash
bun dev
```

Useful variants:

```bash
bun dev --db-only
bun dev --no-local
bun dev --no-dashboard
```

## Verification

Run these from the repository root:

```bash
bun test
bun test:e2e
bun test:coverage
bun check
```

If you are changing a focused subsystem, run the narrowest relevant test first and then expand outward.

## Contributor Expectations

- Follow the thin-entrypoint, service-first architecture in [`CLAUDE.md`](../CLAUDE.md).
- Keep functions small and domain-focused.
- Add tests with behavior changes.
- Reuse shared packages before adding one-off helpers.
- Treat workflow behavior changes as product-level changes.

## Documentation Map

- [`docs/WORKFLOW.md`](../docs/WORKFLOW.md): task-doc and execution workflow model
- [`apps/local-server/README.md`](../apps/local-server/README.md): local server details
- [`apps/cli/README.md`](../apps/cli/README.md): CLI command surface
- [`e2e-tests/README.md`](../e2e-tests/README.md): end-to-end coverage

## Agent Tooling Setup

If you want to use the repo's Claude configuration globally:

```sh
cp -R ~/.claude .claude-bkp
rm -rf ~/.claude/commands ~/.claude/skills ~/.claude/songs

ln -sf $(pwd)/AGENTS.md ~/.claude/CLAUDE.md
ln -sfn $(pwd)/.claude/commands ~/.claude/commands
ln -sfn $(pwd)/.claude/skills ~/.claude/skills
ln -sf $(pwd)/.claude/settings.json ~/.claude/settings.json
ln -sfn $(pwd)/.claude/songs ~/.claude/songs
```
