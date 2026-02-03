# Workflow System

This document explains the workflow engine in `apps/server/src/workflow/`.

## Overview

The workflow system orchestrates multi-step task execution for AI agents. When a task transitions to WORKING status, the server assigns a workflow that defines what steps the agent should execute (implement, test, debug, review) and how to transition between them based on success or failure.

```
Task marked READY → Server starts workflow → Agent executes steps → Task becomes DONE or BLOCKED
```

The workflow engine is **closed-source IP** that runs on the remote server. Code never leaves the user's machine—only task metadata and step results flow to the server.

## Core Concepts

### Workflow Definition

A workflow is a JSON document stored in the database that defines:

- **name**: Human-readable identifier (e.g., "simple", "tdd-strict")
- **initialStep**: Where execution begins
- **steps**: Map of step ID → step configuration
- **terminalStates**: States that end the workflow (`__done__`, `__blocked__`)

```json
{
  "version": 1,
  "name": "simple",
  "initialStep": "implement",
  "steps": {
    "implement": {
      "id": "implement",
      "type": "implement",
      "promptTemplate": "implement.md.hbs",
      "maxAttempts": 1,
      "transitions": [
        { "condition": "success", "target": "__done__" },
        { "condition": "failure", "target": "__blocked__" }
      ]
    }
  },
  "terminalStates": ["__done__", "__blocked__"]
}
```

### Step Types

| Type | Purpose |
|------|---------|
| `implement` | Write or modify code |
| `test` | Run test suite |
| `review` | Code review |
| `debug` | Fix failing tests/issues |
| `iterate` | Refine existing implementation |

### Transitions

Each step defines transitions based on the step result. Conditions can be:

| Condition | When |
|-----------|------|
| `<signal>` | CLI detected this keyword in agent output (e.g., `TASK_COMPLETE`) |
| `__none__` | No signal keyword was found in output |
| `success` | Step completed successfully (legacy, or when not using signals) |
| `failure` | Step failed (legacy, or when not using signals) |

Transition targets can be:
- Another step ID (e.g., `"test"`, `"debug"`)
- `__done__` — workflow completes, task → DONE
- `__blocked__` — workflow fails, task → BLOCKED

If no matching transition exists, the workflow defaults to BLOCKED.

See [Ralph Loop with Signal Keywords](#example-ralph-loop-with-signal-keywords) for signal-based branching.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Execution Service                            │
│  (apps/server/src/executions/execution-service.ts)              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  startWorkflow()          processStepResult()                   │
│       │                          │                               │
│       ▼                          ▼                               │
│  ┌─────────────┐          ┌─────────────────────┐               │
│  │ Workflow    │          │ Workflow            │               │
│  │ Repository  │──────────│ State Machine       │               │
│  └─────────────┘          └─────────────────────┘               │
│       │                          │                               │
│       │ load definition          │ evaluateTransition()         │
│       ▼                          ▼                               │
│  ┌─────────────┐          ┌─────────────────────┐               │
│  │ Workflow    │          │ Step Command        │               │
│  │ Parser      │          │ Generator           │               │
│  └─────────────┘          └─────────────────────┘               │
│                                  │                               │
│                                  │ load prompt template          │
│                                  ▼                               │
│                          ┌─────────────────────┐                │
│                          │ Template Loader     │                │
│                          │ (prompts/)          │                │
│                          └─────────────────────┘                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Workflow State Machine (`workflow-state-machine.ts`)

The core logic that determines workflow progression:

```typescript
interface WorkflowStateMachine {
  getInitialStep: () => WorkflowStep;
  evaluateTransition: (stepId: string, result: StepResult) => TransitionResult;
  getStep: (stepId: string) => WorkflowStep | undefined;
}
```

**Usage:**
```typescript
const stateMachine = createWorkflowStateMachine(workflowDefinition);

// Get first step when workflow starts
const firstStep = stateMachine.getInitialStep();

// After agent completes a step, determine what's next
const result = stateMachine.evaluateTransition("implement", { status: "success" });
// → { type: "step", stepId: "test", step: {...} }
// → { type: "done" }
// → { type: "blocked" }
```

### 2. Workflow Parser (`workflow-parser.ts`)

Validates workflow JSON against the Zod schema and checks structural integrity:

```typescript
const definition = parseWorkflow(jsonString);
// Throws WorkflowParseError if:
// - Schema validation fails
// - Initial step doesn't exist
// - Transitions reference non-existent steps
```

### 3. Step Command Generator (`step-command-generator.ts`)

Creates the command payload sent to the CLI when a step should execute:

```typescript
const generator = createStepCommandGenerator(templateLoader);
const command = await generator.generate(step, stepExecutionId, attemptNumber);
// → { id, type, promptTemplate, attempt }
```

### 4. Workflow Repository (`workflow-repository.ts`)

Database access for workflow definitions:

```typescript
const repo = createWorkflowRepository(db);
await repo.findByName("simple");  // Lookup by name
await repo.findById("workflow_xxx");  // Lookup by ID
await repo.create({ id, name, definition });  // Create new workflow
```

### 5. Template Loader (`prompts/template-loader.ts`)

Loads prompt templates from `prompts/templates/`:

- `implement.md.hbs` — Implementation instructions
- `test.md.hbs` — Test execution instructions
- `debug.md.hbs` — Debugging instructions
- `review.md.hbs` — Code review instructions
- `iterate.md.hbs` — Iteration instructions

Templates use Handlebars syntax with variables like `{{task.id}}`, `{{worktree.path}}`.

## Execution Flow

### Starting a Workflow

When CLI calls `POST /tasks/{id}/ready`:

1. **Concurrency check** — Is client under max concurrent tasks?
2. **Load workflow** — Fetch "simple" workflow from database
3. **Parse definition** — Validate and create state machine
4. **Get initial step** — Determine first step to execute
5. **Generate command** — Create step command with prompt template
6. **Create records** — Insert execution + step_execution in transaction
7. **Return command** — CLI receives step to execute

### Processing Step Results

When CLI calls `POST /steps/{id}/complete`:

1. **Lock step** — `SELECT ... FOR UPDATE` to prevent races
2. **Check idempotency** — If already processed, return cached result
3. **Evaluate transition** — State machine determines next action
4. **Update records** — Mark step as success/failure
5. **Handle transition**:
   - `done` → Update execution=completed, task=DONE
   - `blocked` → Update execution=failed, task=BLOCKED
   - `step` → Create new step_execution, return next command

## Database Schema

```sql
-- Workflow definitions (seeded at startup)
CREATE TABLE workflows (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  definition JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workflow execution instances
CREATE TABLE executions (
  id VARCHAR(255) PRIMARY KEY,
  client_id VARCHAR(255) NOT NULL,
  task_id VARCHAR(255) NOT NULL,
  workflow_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL,  -- running, completed, failed, aborted
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Individual step executions
CREATE TABLE step_executions (
  id VARCHAR(255) PRIMARY KEY,
  client_id VARCHAR(255) NOT NULL,
  execution_id VARCHAR(255) NOT NULL,
  step_type VARCHAR(50) NOT NULL,
  prompt_template VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL,  -- pending, running, success, failure
  error_code VARCHAR(255),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);
```

## Example: TDD Workflow

A more complex workflow with loops and conditional transitions:

```json
{
  "version": 1,
  "name": "tdd",
  "initialStep": "implement",
  "steps": {
    "implement": {
      "id": "implement",
      "type": "implement",
      "promptTemplate": "implement.md.hbs",
      "maxAttempts": 1,
      "transitions": [
        { "condition": "success", "target": "test" },
        { "condition": "failure", "target": "__blocked__" }
      ]
    },
    "test": {
      "id": "test",
      "type": "test",
      "promptTemplate": "test.md.hbs",
      "maxAttempts": 1,
      "transitions": [
        { "condition": "success", "target": "__done__" },
        { "condition": "failure", "target": "debug" }
      ]
    },
    "debug": {
      "id": "debug",
      "type": "debug",
      "promptTemplate": "debug.md.hbs",
      "maxAttempts": 2,
      "transitions": [
        { "condition": "success", "target": "test" },
        { "condition": "failure", "target": "__blocked__" }
      ]
    }
  },
  "terminalStates": ["__done__", "__blocked__"]
}
```

**Flow diagram:**
```
implement ──success──▶ test ──success──▶ __done__
    │                   │
    │failure            │failure
    ▼                   ▼
__blocked__           debug ──success──▶ test (loop)
                        │
                        │failure
                        ▼
                    __blocked__
```

## Example: Ralph Loop with Signal Keywords

The "ralph loop" pattern runs an agent repeatedly until it signals completion. Steps can define **signal keywords** that the CLI scans for in agent output, enabling multi-way branching.

### Signal-Based Transitions

Instead of binary success/failure, steps define keywords that map to different transitions:

```json
{
  "version": 1,
  "name": "ralph-loop",
  "initialStep": "iterate",
  "steps": {
    "iterate": {
      "id": "iterate",
      "type": "iterate",
      "promptTemplate": "iterate.md.hbs",
      "maxAttempts": 20,
      "signals": ["TASK_COMPLETE", "NEEDS_REVIEW", "BLOCKED_EXTERNAL"],
      "transitions": [
        { "condition": "TASK_COMPLETE", "target": "__done__" },
        { "condition": "NEEDS_REVIEW", "target": "review" },
        { "condition": "BLOCKED_EXTERNAL", "target": "__blocked__" },
        { "condition": "__none__", "target": "iterate" }
      ]
    },
    "review": {
      "id": "review",
      "type": "review",
      "promptTemplate": "review.md.hbs",
      "maxAttempts": 1,
      "signals": ["REVIEW_PASSED", "REVIEW_FAILED"],
      "transitions": [
        { "condition": "REVIEW_PASSED", "target": "__done__" },
        { "condition": "REVIEW_FAILED", "target": "iterate" }
      ]
    }
  },
  "terminalStates": ["__done__", "__blocked__"]
}
```

### Transition Conditions

| Condition | When |
|-----------|------|
| `<keyword>` | CLI detected this keyword in agent output |
| `__none__` | No signal keyword was found (default loop-back) |
| `success` | Legacy: step completed successfully |
| `failure` | Legacy: step failed |

### Flow Diagram

```
         ┌─────────────────────────────────────┐
         │                                     │
         ▼                                     │ __none__ (no signal)
     iterate ──────────────────────────────────┘
         │
         ├── TASK_COMPLETE ──▶ __done__
         │
         ├── NEEDS_REVIEW ──▶ review ──┬── REVIEW_PASSED ──▶ __done__
         │                             │
         │                             └── REVIEW_FAILED ──▶ iterate
         │
         └── BLOCKED_EXTERNAL ──▶ __blocked__

After maxAttempts (20) with no signal → __blocked__
```

### CLI-Side Signal Detection

The CLI scans agent output for keywords defined in `signals` array and reports the first match:

```typescript
// CLI detects which signal keyword appeared
const detectSignal = (output: string, signals: string[]): string | null => {
  for (const signal of signals) {
    if (output.includes(signal)) return signal;
  }
  return null;
};

const result = await agent.run({ prompt });
const signal = detectSignal(result.output, step.signals);

// Report to server with detected signal
await api.completeStep({
  stepId,
  status: signal ? "success" : "failure",
  signal,  // "TASK_COMPLETE" | "NEEDS_REVIEW" | "BLOCKED_EXTERNAL" | null
});
```

### Prompt Template

The prompt instructs the agent which signals are available:

```handlebars
Continue working on the task.

When done, output ONE of these signals:
- TASK_COMPLETE - Task is fully implemented and tested
- NEEDS_REVIEW - Implementation done, needs code review
- BLOCKED_EXTERNAL - Cannot proceed due to external dependency

If more work remains, continue without outputting a signal.
```

### Updated Schema

The step schema adds `signals` field:

```typescript
const WorkflowStepSchema = z.object({
  id: z.string(),
  type: StepTypeEnum,
  promptTemplate: z.string(),
  maxAttempts: z.number().int().positive().default(1),
  signals: z.array(z.string()).optional(),  // NEW: keywords to detect
  transitions: z.array(TransitionSchema),
});

const TransitionSchema = z.object({
  condition: z.string(),  // keyword, "__none__", "success", or "failure"
  target: z.string(),
});
```

### State Machine Changes

The state machine evaluates transitions by checking signal first, then falling back to success/failure:

```typescript
const evaluateTransition = (stepId: string, result: StepResult): TransitionResult => {
  const step = definition.steps[stepId];

  // 1. Check for signal-based transition
  if (result.signal) {
    const transition = step.transitions.find(t => t.condition === result.signal);
    if (transition) return resolveTarget(transition.target);
  }

  // 2. Check for __none__ transition (no signal found)
  if (!result.signal) {
    const noneTransition = step.transitions.find(t => t.condition === "__none__");
    if (noneTransition) return resolveTarget(noneTransition.target);
  }

  // 3. Fall back to success/failure
  const condition = result.status;
  const transition = step.transitions.find(t => t.condition === condition);
  if (transition) return resolveTarget(transition.target);

  return { type: "blocked" };
};
```

### Comparison with Hardcoded Script

| Aspect | `scripts/ralph-loop.ts` | Workflow with signals |
|--------|-------------------------|----------------------|
| Loop control | Script while-loop | State machine transitions |
| Branching | Single done keyword | Multiple signal keywords |
| Max iterations | `--max` CLI flag | `maxAttempts` in step config |
| Keyword detection | Script scans output | CLI reports signal to server |
| Observability | Log files | Database step_executions |
| Resumability | None | Resume from last step |

The signal-based approach enables rich branching (done, review, blocked, retry) from a single step while keeping the workflow definition declarative.

## Adding a New Workflow

1. **Define the workflow JSON** following the schema in `types.ts`
2. **Create a migration** in `db/migrations/` to insert the workflow
3. **Add any new prompt templates** in `prompts/templates/`
4. **Test** using `workflow-state-machine.test.ts` patterns

## File Reference

| File | Purpose |
|------|---------|
| `types.ts` | Zod schemas and TypeScript types |
| `workflow-state-machine.ts` | Transition evaluation logic |
| `workflow-parser.ts` | JSON validation and parsing |
| `workflow-repository.ts` | Database CRUD operations |
| `step-command-generator.ts` | Creates CLI commands |
| `index.ts` | Public exports |

## Testing

Run workflow tests:

```bash
bun test apps/server/src/workflow/
```

Key test scenarios covered:
- Initial step retrieval
- Success/failure transitions
- Terminal state handling (done, blocked)
- Loop-back transitions
- Missing step error handling
- Idempotent step completion
