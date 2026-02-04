---
name: aop:implement
description: Implement a single task from an OpenSpec change with quality gates. Use when the user wants to implement the next task from a change, apply TDD for new code, run code review and remove AI slop. Triggers on /aop:implement, "implement next task", "work on the change".
---

# AOP Implement

Execute a single task from an OpenSpec change through a complete quality pipeline. 
- It's fine to tackle the next comingled tasks in the same session if needed, but don't do too much;
  - **NEVER work on more than one task section at a time.**
  - Stop when you feel you've done enough cohesive work and it's good to pause. (like you were working on a pomodoro 20min session)

## Arguments

```
/aop:implement {{change}}
```

`change` is optional. If omitted, use the current/active change.

## Workflow

**IMPORTANT**: Execute ALL 6 steps in sequence. Do NOT end the session early.

**Copy this tracker into your response and update as you complete each step:**

AOP Implement Progress:
[ ] Step 1: Apply Next Task - /opsx:apply executed
[ ] Step 2: Complete the Task - task completed
[ ] Step 3: Remove AI Slop - /remove-ai-slop executed
[ ] Step 4: Signal Output - TASK_DONE

### Step 1: Apply Next Task

Run `/opsx:apply {{change}}` for the **next single task only**.

**TDD requirement**: If the task introduces new code (functions, classes, modules), use `/test-driven-development`.

**Skip TDD when**:
- Infrastructure/config tasks (CI, build, linting setup)
- The task IS writing tests or e2e tests 
  - Never use Mocks on E2E tests, the idea is to stress the real system with real APIs. Unless the user explicitly asked to use mocks.
- Writing frontend or UI/UX code. 
  - Here you should favor happy paths and basic unhappy flows using e2e/playwright tests
  - Apply TDD in E2E imagining you are the user
  - Use the `webapp-testing` skill to run your tests
  - Use the `frontend-design` skill for design tasks.
- Pure refactoring with existing test coverage

**IMPORTANT! EARLY EXIT! If no more tasks remain**: 

Stop here and respond with `<aop>FINISHED</aop>`

**Else**:

**Gate**: Mark Step 1 complete in tracker. Do not proceed until task is applied.

**Continue to Step 2**

### Step 2: Complete the Task

Ensure full completion:
- Wire up all introduced functionality
- No TODOs left (unless captured for future work)
- All imports and exports connected
- Feature is usable end-to-end

Verify task completion:
- If it's new code functionality, run the unit tests to it, write new ones if necessary.
- If it's a UI/frontend task use the `webapp-testing` skill to verify it works
- If the task is about creating an e2e test, run the e2e test to verify it works
- If it's an infrastructure task, verify it works by running the relevant commands, even if isolated
- Always run the verification commands that the repository has (it can be lint, typecheck, build, etc. eg `bun run check`)

YOU MUST VERIFY TASK COMPLETION BEFORE PROCEEDING TO THE NEXT STEP.

**Gate**: Mark Step 2 complete in tracker. Do not proceed until task is completed.

**Continue to Step 3**

### Step 3: Remove AI Slop

Run `/remove-ai-slop` to clean up:
- Unnecessary comments
- Over-defensive code
- Type casts to `any`
- Style inconsistencies
- Remove dead code introduced and review code that should be wired and it's not

**Gate**: Mark Step 3 complete in tracker. Do not proceed until AI slop is removed.

**Continue to Step 4**

### Step 4: Output Signal (REQUIRED)

**You MUST end with this signal on its own line:**

```
<aop>TASK_DONE</aop>
```
