import { describe, expect, test } from "bun:test";
import { asStepResult, loadOfficialWorkflow } from "./test-utils.ts";
import { TransitionSchema } from "./types.ts";
import { WorkflowParseError } from "./workflow-parser.ts";
import { createWorkflowStateMachine } from "./workflow-state-machine.ts";
import { parseWorkflowYaml } from "./yaml-parser.ts";

const validYaml = `
version: 1
name: test-workflow
initialStep: implement
steps:
  implement:
    id: implement
    type: implement
    promptTemplate: implement.md.hbs
    maxAttempts: 3
    transitions:
      - condition: success
        target: __done__
      - condition: failure
        target: __blocked__
terminalStates:
  - __done__
  - __blocked__
`;

describe("parseWorkflowYaml", () => {
  test("parses valid YAML workflow definition", () => {
    const result = parseWorkflowYaml(validYaml);

    expect(result.name).toBe("test-workflow");
    expect(result.initialStep).toBe("implement");
    expect(Object.keys(result.steps)).toEqual(["implement"]);
    expect(result.steps.implement?.maxAttempts).toBe(3);
  });

  test("throws WorkflowParseError for invalid YAML syntax", () => {
    const invalidYaml = `
version: 1
name: test
  invalid indentation
`;
    expect(() => parseWorkflowYaml(invalidYaml)).toThrow(WorkflowParseError);
  });

  test("throws WorkflowParseError for invalid schema", () => {
    const invalidSchema = `
version: 1
name: test
`;
    expect(() => parseWorkflowYaml(invalidSchema)).toThrow(WorkflowParseError);
  });

  test("throws WorkflowParseError with validation details when schema fails", () => {
    const invalidSchema = `
version: 2
name: test
initialStep: foo
steps: {}
terminalStates: []
`;
    expect(() => parseWorkflowYaml(invalidSchema)).toThrow("Invalid workflow definition");
  });

  test("parses ralph-loop workflow from YAML", () => {
    const ralphLoopYaml = `
version: 1
name: ralph-loop
initialStep: iterate
steps:
  iterate:
    id: iterate
    type: iterate
    promptTemplate: iterate.md.hbs
    maxAttempts: 1
    signals:
      - name: TASK_COMPLETE
        description: task is fully complete, all requirements met, tests passing
      - name: NEEDS_REVIEW
        description: implementation is ready for code review
    transitions:
      - condition: TASK_COMPLETE
        target: __done__
      - condition: NEEDS_REVIEW
        target: review
      - condition: __none__
        target: iterate
      - condition: failure
        target: __blocked__
  review:
    id: review
    type: review
    promptTemplate: review.md.hbs
    maxAttempts: 1
    transitions:
      - condition: success
        target: __done__
      - condition: failure
        target: __blocked__
terminalStates:
  - __done__
  - __blocked__
`;

    const result = parseWorkflowYaml(ralphLoopYaml);

    expect(result.name).toBe("ralph-loop");
    expect(result.initialStep).toBe("iterate");
    expect(Object.keys(result.steps)).toEqual(["iterate", "review"]);
    expect(result.steps.iterate?.signals).toEqual([
      {
        name: "TASK_COMPLETE",
        description: "task is fully complete, all requirements met, tests passing",
      },
      { name: "NEEDS_REVIEW", description: "implementation is ready for code review" },
    ]);
  });

  test("parses transitions with maxIterations and onMaxIterations", () => {
    const yaml = `
version: 1
name: iteration-test
initialStep: review
steps:
  review:
    id: review
    type: review
    promptTemplate: review.md.hbs
    maxAttempts: 1
    transitions:
      - condition: REVIEW_FAILED
        target: fix-issues
        maxIterations: 2
        onMaxIterations: __blocked__
      - condition: REVIEW_PASSED
        target: __done__
  fix-issues:
    id: fix-issues
    type: implement
    promptTemplate: fix.md.hbs
    maxAttempts: 1
    transitions:
      - condition: success
        target: review
terminalStates:
  - __done__
  - __blocked__
`;
    const result = parseWorkflowYaml(yaml);
    const reviewTransitions = result.steps.review?.transitions ?? [];

    expect(reviewTransitions[0]?.maxIterations).toBe(2);
    expect(reviewTransitions[0]?.onMaxIterations).toBe("__blocked__");
  });

  test("parses transitions with afterIteration and thenTarget", () => {
    const yaml = `
version: 1
name: conditional-routing-test
initialStep: fix
steps:
  fix:
    id: fix
    type: implement
    promptTemplate: fix.md.hbs
    maxAttempts: 1
    transitions:
      - condition: FIX_COMPLETE
        target: quick-review
        afterIteration: 1
        thenTarget: full-review
  quick-review:
    id: quick-review
    type: review
    promptTemplate: quick-review.md.hbs
    maxAttempts: 1
    transitions:
      - condition: success
        target: __done__
  full-review:
    id: full-review
    type: review
    promptTemplate: full-review.md.hbs
    maxAttempts: 1
    transitions:
      - condition: success
        target: __done__
terminalStates:
  - __done__
  - __blocked__
`;
    const result = parseWorkflowYaml(yaml);
    const fixTransitions = result.steps.fix?.transitions ?? [];

    expect(fixTransitions[0]?.afterIteration).toBe(1);
    expect(fixTransitions[0]?.thenTarget).toBe("full-review");
  });

  test("throws error for onMaxIterations referencing unknown step", () => {
    const yaml = `
version: 1
name: invalid-test
initialStep: review
steps:
  review:
    id: review
    type: review
    promptTemplate: review.md.hbs
    maxAttempts: 1
    transitions:
      - condition: REVIEW_FAILED
        target: __blocked__
        maxIterations: 2
        onMaxIterations: unknown-step
terminalStates:
  - __done__
  - __blocked__
`;
    expect(() => parseWorkflowYaml(yaml)).toThrow(WorkflowParseError);
    expect(() => parseWorkflowYaml(yaml)).toThrow('onMaxIterations to unknown step "unknown-step"');
  });

  test("throws error for thenTarget referencing unknown step", () => {
    const yaml = `
version: 1
name: invalid-test
initialStep: fix
steps:
  fix:
    id: fix
    type: implement
    promptTemplate: fix.md.hbs
    maxAttempts: 1
    transitions:
      - condition: FIX_COMPLETE
        target: __done__
        afterIteration: 1
        thenTarget: unknown-step
terminalStates:
  - __done__
  - __blocked__
`;
    expect(() => parseWorkflowYaml(yaml)).toThrow(WorkflowParseError);
    expect(() => parseWorkflowYaml(yaml)).toThrow('thenTarget to unknown step "unknown-step"');
  });
});

describe("TransitionSchema", () => {
  test("parses transition with all iteration fields", () => {
    const transition = {
      condition: "REVIEW_FAILED",
      target: "fix-issues",
      maxIterations: 3,
      onMaxIterations: "__blocked__",
      afterIteration: 1,
      thenTarget: "full-review",
    };

    const result = TransitionSchema.parse(transition);

    expect(result.maxIterations).toBe(3);
    expect(result.onMaxIterations).toBe("__blocked__");
    expect(result.afterIteration).toBe(1);
    expect(result.thenTarget).toBe("full-review");
  });

  test("allows transition without iteration fields (backward compatibility)", () => {
    const transition = {
      condition: "success",
      target: "__done__",
    };

    const result = TransitionSchema.parse(transition);

    expect(result.maxIterations).toBeUndefined();
    expect(result.onMaxIterations).toBeUndefined();
    expect(result.afterIteration).toBeUndefined();
    expect(result.thenTarget).toBeUndefined();
  });

  test("rejects negative maxIterations", () => {
    const transition = {
      condition: "REVIEW_FAILED",
      target: "fix-issues",
      maxIterations: -1,
    };

    expect(() => TransitionSchema.parse(transition)).toThrow();
  });

  test("rejects zero maxIterations", () => {
    const transition = {
      condition: "REVIEW_FAILED",
      target: "fix-issues",
      maxIterations: 0,
    };

    expect(() => TransitionSchema.parse(transition)).toThrow();
  });

  test("allows zero afterIteration (first iteration)", () => {
    const transition = {
      condition: "FIX_COMPLETE",
      target: "quick-review",
      afterIteration: 0,
      thenTarget: "full-review",
    };

    const result = TransitionSchema.parse(transition);

    expect(result.afterIteration).toBe(0);
  });

  test("rejects negative afterIteration", () => {
    const transition = {
      condition: "FIX_COMPLETE",
      target: "quick-review",
      afterIteration: -1,
      thenTarget: "full-review",
    };

    expect(() => TransitionSchema.parse(transition)).toThrow();
  });
});

describe("aop-default workflow integration", () => {
  test("parses aop-default workflow from file", async () => {
    const workflow = await loadOfficialWorkflow("aop-default");

    expect(workflow.name).toBe("aop-default");
    expect(workflow.initialStep).toBe("iterate");
    expect(Object.keys(workflow.steps).sort()).toEqual([
      "fix-issues",
      "full-review",
      "iterate",
      "quick-review",
    ]);
    expect(workflow.terminalStates).toEqual(["__done__", "__blocked__"]);
  });

  test("iterate step has correct signals and transitions", async () => {
    const workflow = await loadOfficialWorkflow("aop-default");
    const step = workflow.steps.iterate;

    expect(step?.signals).toEqual([
      { name: "CHUNK_DONE", description: "completed a chunk, more tasks remain" },
      { name: "ALL_TASKS_DONE", description: "all implementation tasks are complete" },
    ]);
    expect(step?.transitions).toContainEqual({ condition: "CHUNK_DONE", target: "iterate" });
    expect(step?.transitions).toContainEqual({
      condition: "ALL_TASKS_DONE",
      target: "full-review",
    });
  });

  test("full-review step has maxIterations constraint", async () => {
    const workflow = await loadOfficialWorkflow("aop-default");
    const step = workflow.steps["full-review"];
    const failTransition = step?.transitions.find(
      (transition) => transition.condition === "REVIEW_FAILED",
    );

    expect(failTransition?.maxIterations).toBe(2);
    expect(failTransition?.onMaxIterations).toBe("__blocked__");
  });

  test("fix-issues step has afterIteration conditional routing", async () => {
    const workflow = await loadOfficialWorkflow("aop-default");
    const step = workflow.steps["fix-issues"];
    const fixTransition = step?.transitions.find(
      (transition) => transition.condition === "FIX_COMPLETE",
    );

    expect(fixTransition?.afterIteration).toBe(1);
    expect(fixTransition?.target).toBe("quick-review");
    expect(fixTransition?.thenTarget).toBe("full-review");
  });

  test("complete workflow execution flow: happy path", async () => {
    const workflow = await loadOfficialWorkflow("aop-default");
    const sm = createWorkflowStateMachine(workflow);

    const initial = sm.getInitialStep();
    expect(initial.id).toBe("iterate");

    const afterChunk = asStepResult(
      sm.evaluateTransition("iterate", {
        status: "success",
        signal: "CHUNK_DONE",
      }),
    );
    expect(afterChunk.stepId).toBe("iterate");

    const afterAllTasks = asStepResult(
      sm.evaluateTransition("iterate", {
        status: "success",
        signal: "ALL_TASKS_DONE",
      }),
    );
    expect(afterAllTasks.stepId).toBe("full-review");

    const afterReviewPass = sm.evaluateTransition("full-review", {
      status: "success",
      signal: "REVIEW_PASSED",
    });
    expect(afterReviewPass.type).toBe("done");
  });

  test("workflow flow: review fails then fix then quick-review passes", async () => {
    const workflow = await loadOfficialWorkflow("aop-default");
    const sm = createWorkflowStateMachine(workflow);
    const ctx = { iteration: 0, visitedSteps: ["iterate", "full-review"] };

    const afterReviewFail = asStepResult(
      sm.evaluateTransition("full-review", { status: "success", signal: "REVIEW_FAILED" }, ctx),
    );
    expect(afterReviewFail.stepId).toBe("fix-issues");

    ctx.visitedSteps.push("fix-issues");
    const afterFix = asStepResult(
      sm.evaluateTransition("fix-issues", { status: "success", signal: "FIX_COMPLETE" }, ctx),
    );
    expect(afterFix.stepId).toBe("quick-review");

    ctx.visitedSteps.push("quick-review");
    const afterQuickPass = sm.evaluateTransition(
      "quick-review",
      { status: "success", signal: "REVIEW_PASSED" },
      ctx,
    );
    expect(afterQuickPass.type).toBe("done");
  });

  test("workflow flow: second iteration routes fix to full-review", async () => {
    const workflow = await loadOfficialWorkflow("aop-default");
    const sm = createWorkflowStateMachine(workflow);
    const ctx = {
      iteration: 1,
      visitedSteps: ["iterate", "full-review", "fix-issues", "quick-review"],
    };

    const afterFix = asStepResult(
      sm.evaluateTransition("fix-issues", { status: "success", signal: "FIX_COMPLETE" }, ctx),
    );
    expect(afterFix.stepId).toBe("full-review");
    expect(afterFix.shouldIncrementIteration).toBe(true);
  });

  test("workflow blocks after maxIterations exceeded", async () => {
    const workflow = await loadOfficialWorkflow("aop-default");
    const sm = createWorkflowStateMachine(workflow);
    const ctx = {
      iteration: 2,
      visitedSteps: ["iterate", "full-review", "fix-issues", "quick-review"],
    };

    const result = sm.evaluateTransition(
      "full-review",
      { status: "success", signal: "REVIEW_FAILED" },
      ctx,
    );
    expect(result.type).toBe("blocked");
  });
});
