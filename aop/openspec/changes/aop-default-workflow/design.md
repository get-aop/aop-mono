## Context

The workflow engine currently supports signal-based transitions and the `__none__` loopback pattern (as seen in ralph-loop). However, it lacks iteration tracking needed for bounded review loops. The aop-implement and aop-review skills encode quality gates in prompt text, but LLMs often skip steps. We need to enforce these patterns at the workflow engine level.

Current state:
- `TransitionSchema` has only `condition` and `target`
- `ExecutionsTable` has no iteration counter
- `step_executions` tracks individual step runs but not loop iterations
- Prompt templates have `step.type` and `step.executionId` but no `step.iteration`

## Goals / Non-Goals

**Goals:**
- Add iteration tracking to workflow engine execution state
- Support `maxIterations` and `onMaxIterations` on transitions
- Support `afterIteration` conditional routing for review loop pattern
- Create aop-default workflow with 4 steps: implement, full-review, fix-issues, quick-review
- Add `step.iteration` to prompt template context
- Maintain backward compatibility with existing workflows (simple, ralph-loop)

**Non-Goals:**
- Changing how signals are detected or parsed
- Adding new step types beyond existing (implement, test, review, debug, iterate)
- Modifying the CLI or local-server components
- Per-step iteration counters (we use a single execution-level counter)

## Decisions

### 1. Single iteration counter on execution record

**Choice**: Add `iteration INTEGER DEFAULT 0` column to `executions` table.

**Alternatives considered**:
- Per-step counters: More complex, harder to reason about shared iteration across review steps
- In-memory only: Lost on server restart, breaks resumability

**Rationale**: Simple, persistent, shared across all steps in an execution. The counter increments when transitioning to a previously-visited step.

### 2. Track visited steps in execution state

**Choice**: Add `visited_steps TEXT` column (JSON array) to track which step IDs have been executed.

**Rationale**: To detect loop-back (and trigger iteration increment), we need to know if a step was already visited. Stored as JSON array for simplicity.

### 3. Extend TransitionSchema for iteration constraints

**Choice**: Add optional fields to `TransitionSchema`:
```typescript
TransitionSchema = z.object({
  condition: z.string(),
  target: z.string(),
  maxIterations: z.number().int().positive().optional(),
  onMaxIterations: z.string().optional(),  // defaults to __blocked__
  afterIteration: z.number().int().nonnegative().optional(),
  thenTarget: z.string().optional(),
});
```

**Rationale**: Keeps iteration logic in transition definitions, not scattered across engine logic. YAML remains declarative.

### 4. Iteration increment logic

**Choice**: Increment `iteration` when:
1. Transition target is in `visited_steps`, AND
2. Transition does not have `afterIteration` (which handles its own routing)

**Rationale**: Prevents double-increment when `afterIteration` already routes based on iteration.

### 5. Transition evaluation order with iteration

**Choice**: Evaluation order:
1. Check if `maxIterations` exceeded → use `onMaxIterations` target
2. Check if `afterIteration` applies → use `thenTarget` if iteration >= afterIteration
3. Use default `target`

**Rationale**: Max iterations is a hard stop, takes precedence. Conditional routing is next. Default is fallback.

### 6. YAML workflow structure for aop-default

**Choice**:
```yaml
version: 1
name: aop-default
initialStep: implement
steps:
  implement:
    signals: [CHUNK_DONE, ALL_TASKS_DONE]
    transitions:
      - condition: CHUNK_DONE
        target: implement
      - condition: ALL_TASKS_DONE
        target: full-review
      - condition: failure
        target: __blocked__

  full-review:
    signals: [REVIEW_PASSED, REVIEW_FAILED]
    transitions:
      - condition: REVIEW_PASSED
        target: __done__
      - condition: REVIEW_FAILED
        target: fix-issues
        maxIterations: 2
        onMaxIterations: __blocked__

  fix-issues:
    signals: [FIX_COMPLETE]
    transitions:
      - condition: FIX_COMPLETE
        target: quick-review
        afterIteration: 1
        thenTarget: full-review

  quick-review:
    signals: [REVIEW_PASSED, REVIEW_FAILED]
    transitions:
      - condition: REVIEW_PASSED
        target: __done__
      - condition: REVIEW_FAILED
        target: fix-issues
```

**Rationale**: Clean separation of concerns. `maxIterations` on the review→fix transition caps total fix attempts. `afterIteration` on fix→review routes to quick-review first, then full-review on subsequent iterations.

### 7. Prompt template changes

**Choice**: Replace `implement.md.hbs` with chunked version. Add 3 new templates.

**Breaking change mitigation**: Document signal requirements. Existing workflows using old implement.md.hbs without signals will hit `__none__` or `failure` transitions as before.

## Risks / Trade-offs

**[Iteration counter precision]** Counter increments on any loop-back, not specifically on review failures. → Acceptable for our use case. If more granularity needed later, can add per-transition counters.

**[Backward compatibility]** New transition fields are optional, existing workflows parse without changes. → Test simple.yaml and ralph-loop.yaml after changes.

**[DB migration]** Adding columns to executions table. → Use nullable columns with defaults, no data migration needed.

**[Prompt template breaking change]** implement.md.hbs now expects signals. → Document in migration notes. Existing simple.yaml workflow uses success/failure, continues working.
