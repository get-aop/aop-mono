# Workflow System

This document explains the local workflow engine in `apps/local-server/src/workflow-engine/` and `apps/local-server/src/workflow/service.ts`.

## Overview

The workflow system orchestrates multi-step task execution for AI agents. When a task transitions to `WORKING`, the local server loads a workflow definition from `apps/local-server/workflows/`, decides which step to run next, and advances the task until it reaches `DONE`, `PAUSED`, or `BLOCKED`.

```text
Task marked READY -> Local server starts workflow -> Agent executes steps -> Task becomes DONE, PAUSED, or BLOCKED
```

Workflow definitions are repo-owned assets. They are loaded from disk, not from a remote service.

## Core Concepts

### Workflow Definition

A workflow is a YAML document with:

- `name`: human-readable identifier such as `simple`
- `initialStep`: where execution begins
- `steps`: map of step ID to step configuration
- `terminalStates`: states that end the workflow

Each step can also declare an optional `agent` block when that step should run on a specific model and reasoning level instead of the global default.

### Step Types

| Type | Purpose |
| --- | --- |
| `implement` | Write or modify code |
| `test` | Run test suites |
| `review` | Review implementation |
| `debug` | Investigate failures |
| `iterate` | Refine existing work |
| `research` | Gather information before implementation |

### Step Agent Overrides

Use the optional `agent` block to pin a specific provider, model, and reasoning level for a step:

```yaml
steps:
  full-review:
    id: full-review
    type: review
    promptTemplate: full-review.md.hbs
    agent:
      provider: openai
      model: gpt-5.3-codex
      reasoning: extra-high
```

Current curated workflow models:

- OpenAI: `gpt-5.4`, `gpt-5.3-codex`
- Anthropic: `claude-opus-4-6`, `claude-sonnet-4-6`

Workflow reasoning values are normalized across providers:

- `low`
- `medium`
- `high`
- `extra-high`

At runtime AOP maps them to provider-specific flags:

- Codex: `extra-high` -> `xhigh`
- Claude Code: `extra-high` -> `max`

### Transitions

Each step declares transitions based on:

- success or failure
- detected signals such as `TASK_COMPLETE`
- loop/iteration limits

Targets can be:

- another step ID
- `__done__`
- `__paused__`
- `__blocked__`

## Main Components

### Workflow State Machine

`apps/local-server/src/workflow-engine/workflow-state-machine.ts` evaluates the next transition for a completed step.

### Workflow Loader and Parser

`apps/local-server/src/workflow-engine/workflow-loader.ts` loads workflow YAML files from disk.

`apps/local-server/src/workflow-engine/workflow-parser.ts` validates definitions and rejects broken step references.

### Step Command Generator

`apps/local-server/src/workflow-engine/step-command-generator.ts` turns a workflow step into the command payload the executor will run, including any per-step `agent` override.

### Template Loader

`apps/local-server/src/prompts/template-loader.ts` loads the prompt templates used by each workflow step.

### Local Workflow Service

`apps/local-server/src/workflow/service.ts` is the runtime entry point. It:

- lists available workflows
- starts a task on its initial step
- completes a step and advances to the next transition
- resumes paused tasks

## Execution Flow

### Starting a Workflow

When a task is marked `READY`:

1. The queue processor claims the task.
2. The local workflow service loads the selected workflow YAML.
3. The state machine resolves the initial step.
4. A step command is generated from the step definition and template.
5. Local execution and step records are created.
6. The executor launches the agent in the task worktree, using either the step-level agent override or the default configured provider.

### Completing a Step

When the agent exits:

1. The executor reads the log output and detects success, failure, and any emitted signal.
2. The local workflow service evaluates the transition for the current step.
3. The task is moved to:
   - `DONE` when the workflow reaches `__done__`
   - `PAUSED` when the workflow reaches `__paused__`
   - `BLOCKED` when retries are exhausted or the workflow reaches `__blocked__`
   - `WORKING` with a new step when another step should run

The default AOP workflow uses an explicit local verification step before final review. That test step is responsible for matching the local non-E2E CI bar with the smallest command set that still covers the changed code.

## Default Workflow Setting

The local settings table also stores a configurable fallback workflow:

- Setting key: `default_workflow`
- Default value: `aop-default`

When a task has no `preferred_workflow`, the local workflow service starts the workflow named by `default_workflow`.

## Storage Model

Task content and progress live in repository documents under `docs/tasks/<task-slug>/`.

SQLite is only used for local app metadata such as:

- registered repositories
- settings
- interactive session records

The workflow engine itself is local-only and does not depend on a hosted server.
