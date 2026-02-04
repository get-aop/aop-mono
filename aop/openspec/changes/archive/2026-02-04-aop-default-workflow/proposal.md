## Why

The aop-implement and aop-review skills rely on LLM prompt compliance to enforce workflow steps. LLMs frequently skip steps or deviate from expected behavior. With YAML-based workflow templates now operational, we can enforce these patterns programmatically through the workflow engine.

## What Changes

- Add `aop-default.yaml` workflow implementing chunked implementation with inline self-checks and iterative review
- Add 4 new prompt templates: `implement.md.hbs` (chunked), `full-review.md.hbs`, `fix-issues.md.hbs`, `quick-review.md.hbs`
- **BREAKING**: Replace existing `implement.md.hbs` with chunked version that emits `CHUNK_DONE` or `ALL_TASKS_DONE` signals
- Add iteration tracking to workflow engine for review loop pattern (max 2 fix iterations)
- Add `step.iteration` placeholder support in prompt templates

## Capabilities

### New Capabilities

- `workflow-iteration-tracking`: Track iteration count across related steps (full-review, quick-review share counter). Support `maxIterations` on transitions and `afterIteration` conditional routing.

### Modified Capabilities

- `workflow-engine`: Add iteration tracking to execution state. Transitions can specify `maxIterations` with `onMaxIterations` fallback. Step context includes `iteration` field.
- `prompt-library`: Add `step.iteration` placeholder. Update existing templates to chunked pattern with new signals.

## Impact

- `apps/server/workflows/aop-default.yaml` - new workflow file
- `apps/server/src/prompts/templates/*.md.hbs` - new and modified templates
- `apps/server/src/workflows/engine.ts` - iteration tracking in execution state
- `apps/server/src/workflows/types.ts` - schema changes for `maxIterations`, `afterIteration`
- `packages/common/src/types/protocol.ts` - step context includes iteration
- Existing `simple.yaml` and `ralph-loop.yaml` workflows continue working unchanged
