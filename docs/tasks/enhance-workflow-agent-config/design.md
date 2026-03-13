# Per-Step Workflow Agent Configuration

## Goal

Allow AOP workflows to choose a different model and reasoning level per step instead of forcing the whole workflow to run on one default provider.

Initial scope:

- workflow-authored YAML only
- supported agent families: Codex/OpenAI and Claude Code/Anthropic
- supported curated models only:
  - `gpt-5.4`
  - `gpt-5.3-codex`
  - `claude-opus-4-6`
  - `claude-sonnet-4-6`

## Current Problem

Today a workflow step only defines prompt, type, signals, and transitions. At execution time AOP resolves one provider from settings and uses that for every step in the workflow. That blocks mixes like:

- `quick-review` on `gpt-5.4` with medium reasoning
- `iterate` on `gpt-5.4` with high reasoning
- `full-review` on `gpt-5.3-codex` with extra-high reasoning
- Claude workflows that switch between `claude-sonnet-4-6` and `claude-opus-4-6`

## Recommended Design

Add an optional `agent` block to each workflow step:

```yaml
steps:
  quick-review:
    id: quick-review
    type: review
    promptTemplate: quick-review.md.hbs
    agent:
      provider: openai
      model: gpt-5.4
      reasoning: medium
```

Schema:

- `provider`: `openai` | `anthropic`
- `model`:
  - OpenAI: `gpt-5.4` | `gpt-5.3-codex`
  - Anthropic: `claude-opus-4-6` | `claude-sonnet-4-6`
- `reasoning`: `low` | `medium` | `high` | `extra-high`

Rules:

- `agent` is optional. Missing `agent` keeps existing behavior and falls back to the global/default provider.
- `model` must belong to the selected `provider`.
- reasoning names are workflow-level normalized values. Runtime maps them to provider-specific flags:
  - OpenAI/Codex: `extra-high` -> `xhigh`
  - Claude Code: `extra-high` -> `max`

## Runtime Changes

1. Extend workflow step schema and YAML parsing to validate the new `agent` block.
2. Extend `StepCommand` so generated step commands carry the step agent config.
3. Update step command generation to copy `agent` from the workflow definition.
4. Update execution launch logic to prefer `stepCommand.agent` over the global provider.
5. Extend provider run options so model and reasoning can be passed cleanly at launch time.
6. Implement provider-specific command mapping:
   - Codex:
     - `--model <model>`
     - `-c model_reasoning_effort="<mapped-value>"`
   - Claude Code:
     - `--model <model>`
     - `--effort <mapped-value>`

## Built-In Workflow Update

Update `apps/local-server/workflows/aop-default.yaml` to demonstrate the new capability with curated latest models only:

- `iterate`: `gpt-5.4` + `high`
- `cleanup-review`: `gpt-5.4` + `medium`
- `full-review`: `gpt-5.3-codex` + `extra-high`
- `fix-issues`: `gpt-5.4` + `high`
- `quick-review`: `gpt-5.4` + `medium`

Claude-specific built-in workflows do not need to be rewritten unless an existing workflow clearly benefits from it. The main requirement is that the schema and runtime support them.

## Testing Plan

- workflow parser tests for valid and invalid `agent` blocks
- protocol tests for the new `StepCommand.agent` shape
- step command generator tests proving `agent` is copied into the step command
- Codex provider tests for model and reasoning flags
- Claude Code provider tests for model and effort flags
- executor/step-launcher tests proving a step-level agent config overrides the default provider choice

## Assumptions

- There is no existing workflow editor UI in this repo, so “create a workflow” means authoring repo-owned workflow YAML.
- The curated model list is intentionally closed for now because the request was to expose only the latest approved models.
