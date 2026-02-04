import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "./types.ts";
import { createWorkflowStateMachine } from "./workflow-state-machine.ts";

const createTestWorkflow = (): WorkflowDefinition => ({
  version: 1,
  name: "test-workflow",
  initialStep: "implement",
  steps: {
    implement: {
      id: "implement",
      type: "implement",
      promptTemplate: "implement.md.hbs",
      maxAttempts: 1,
      transitions: [
        { condition: "success", target: "test" },
        { condition: "failure", target: "__blocked__" },
      ],
    },
    test: {
      id: "test",
      type: "test",
      promptTemplate: "test.md.hbs",
      maxAttempts: 1,
      transitions: [
        { condition: "success", target: "__done__" },
        { condition: "failure", target: "debug" },
      ],
    },
    debug: {
      id: "debug",
      type: "debug",
      promptTemplate: "debug.md.hbs",
      maxAttempts: 2,
      transitions: [
        { condition: "success", target: "test" },
        { condition: "failure", target: "__blocked__" },
      ],
    },
  },
  terminalStates: ["__done__", "__blocked__"],
});

describe("WorkflowStateMachine", () => {
  describe("getInitialStep", () => {
    test("returns the initial step", () => {
      const sm = createWorkflowStateMachine(createTestWorkflow());

      const step = sm.getInitialStep();

      expect(step.id).toBe("implement");
      expect(step.type).toBe("implement");
    });

    test("throws if initial step not found", () => {
      const workflow = createTestWorkflow();
      workflow.initialStep = "nonexistent";

      const sm = createWorkflowStateMachine(workflow);

      expect(() => sm.getInitialStep()).toThrow('Initial step "nonexistent" not found');
    });
  });

  describe("getStep", () => {
    test("returns step by id", () => {
      const sm = createWorkflowStateMachine(createTestWorkflow());

      const step = sm.getStep("test");

      expect(step?.id).toBe("test");
      expect(step?.type).toBe("test");
    });

    test("returns undefined for nonexistent step", () => {
      const sm = createWorkflowStateMachine(createTestWorkflow());

      const step = sm.getStep("nonexistent");

      expect(step).toBeUndefined();
    });
  });

  describe("evaluateTransition", () => {
    test("transitions to next step on success", () => {
      const sm = createWorkflowStateMachine(createTestWorkflow());

      const result = sm.evaluateTransition("implement", { status: "success" });

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("test");
      expect(result.step?.type).toBe("test");
    });

    test("transitions to blocked on failure", () => {
      const sm = createWorkflowStateMachine(createTestWorkflow());

      const result = sm.evaluateTransition("implement", { status: "failure" });

      expect(result.type).toBe("blocked");
      expect(result.stepId).toBeUndefined();
    });

    test("transitions to done terminal state", () => {
      const sm = createWorkflowStateMachine(createTestWorkflow());

      const result = sm.evaluateTransition("test", { status: "success" });

      expect(result.type).toBe("done");
      expect(result.stepId).toBeUndefined();
    });

    test("transitions to another step on failure", () => {
      const sm = createWorkflowStateMachine(createTestWorkflow());

      const result = sm.evaluateTransition("test", { status: "failure" });

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("debug");
    });

    test("returns blocked when no matching transition", () => {
      const workflow = createTestWorkflow();
      const implementStep = workflow.steps.implement;
      if (implementStep) {
        implementStep.transitions = [{ condition: "success", target: "__done__" }];
      }

      const sm = createWorkflowStateMachine(workflow);
      const result = sm.evaluateTransition("implement", { status: "failure" });

      expect(result.type).toBe("blocked");
    });

    test("throws for nonexistent step", () => {
      const sm = createWorkflowStateMachine(createTestWorkflow());

      expect(() => sm.evaluateTransition("nonexistent", { status: "success" })).toThrow(
        'Step "nonexistent" not found',
      );
    });

    test("workflow can loop back to previous step", () => {
      const sm = createWorkflowStateMachine(createTestWorkflow());

      const result = sm.evaluateTransition("debug", { status: "success" });

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("test");
    });
  });

  describe("signal-based transitions", () => {
    const createSignalWorkflow = (): WorkflowDefinition => ({
      version: 1,
      name: "signal-workflow",
      initialStep: "iterate",
      steps: {
        iterate: {
          id: "iterate",
          type: "iterate",
          promptTemplate: "iterate.md.hbs",
          maxAttempts: 1,
          signals: ["TASK_COMPLETE", "NEEDS_REVIEW"],
          transitions: [
            { condition: "TASK_COMPLETE", target: "__done__" },
            { condition: "NEEDS_REVIEW", target: "review" },
            { condition: "__none__", target: "iterate" },
            { condition: "success", target: "__done__" },
            { condition: "failure", target: "__blocked__" },
          ],
        },
        review: {
          id: "review",
          type: "review",
          promptTemplate: "review.md.hbs",
          maxAttempts: 1,
          transitions: [
            { condition: "success", target: "__done__" },
            { condition: "failure", target: "__blocked__" },
          ],
        },
      },
      terminalStates: ["__done__", "__blocked__"],
    });

    test("transitions based on detected signal", () => {
      const sm = createWorkflowStateMachine(createSignalWorkflow());

      const result = sm.evaluateTransition("iterate", {
        status: "success",
        signal: "TASK_COMPLETE",
      });

      expect(result.type).toBe("done");
    });

    test("signal takes precedence over success/failure", () => {
      const sm = createWorkflowStateMachine(createSignalWorkflow());

      const result = sm.evaluateTransition("iterate", {
        status: "failure",
        signal: "NEEDS_REVIEW",
      });

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("review");
    });

    test("uses __none__ transition when no signal detected", () => {
      const sm = createWorkflowStateMachine(createSignalWorkflow());

      const result = sm.evaluateTransition("iterate", { status: "success" });

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("iterate");
    });

    test("falls back to success/failure when no __none__ and no signal", () => {
      const workflow = createSignalWorkflow();
      const iterateStep = workflow.steps.iterate;
      if (iterateStep) {
        iterateStep.transitions = iterateStep.transitions.filter((t) => t.condition !== "__none__");
      }

      const sm = createWorkflowStateMachine(workflow);
      const result = sm.evaluateTransition("iterate", { status: "success" });

      expect(result.type).toBe("done");
    });

    test("unrecognized signal falls back to success/failure, not __none__", () => {
      const sm = createWorkflowStateMachine(createSignalWorkflow());

      const result = sm.evaluateTransition("iterate", {
        status: "success",
        signal: "UNKNOWN_SIGNAL",
      });

      expect(result.type).toBe("done");
    });

    test("signal is ignored when step has no signal transitions", () => {
      const sm = createWorkflowStateMachine(createSignalWorkflow());

      const result = sm.evaluateTransition("review", {
        status: "success",
        signal: "TASK_COMPLETE",
      });

      expect(result.type).toBe("done");
    });
  });

  describe("iteration tracking", () => {
    const createIterationWorkflow = (): WorkflowDefinition => ({
      version: 1,
      name: "iteration-workflow",
      initialStep: "implement",
      steps: {
        implement: {
          id: "implement",
          type: "implement",
          promptTemplate: "implement.md.hbs",
          maxAttempts: 1,
          transitions: [
            { condition: "success", target: "review" },
            { condition: "failure", target: "__blocked__" },
          ],
        },
        review: {
          id: "review",
          type: "review",
          promptTemplate: "review.md.hbs",
          maxAttempts: 1,
          transitions: [
            { condition: "success", target: "__done__" },
            {
              condition: "failure",
              target: "fix",
              maxIterations: 2,
              onMaxIterations: "__blocked__",
            },
          ],
        },
        fix: {
          id: "fix",
          type: "debug",
          promptTemplate: "fix.md.hbs",
          maxAttempts: 1,
          transitions: [{ condition: "success", target: "review" }],
        },
      },
      terminalStates: ["__done__", "__blocked__"],
    });

    test("sets shouldIncrementIteration when transitioning to visited step", () => {
      const sm = createWorkflowStateMachine(createIterationWorkflow());

      const result = sm.evaluateTransition(
        "fix",
        { status: "success" },
        { iteration: 0, visitedSteps: ["implement", "review", "fix"] },
      );

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("review");
      expect(result.shouldIncrementIteration).toBe(true);
    });

    test("does not set shouldIncrementIteration when step not yet visited", () => {
      const sm = createWorkflowStateMachine(createIterationWorkflow());

      const result = sm.evaluateTransition(
        "implement",
        { status: "success" },
        { iteration: 0, visitedSteps: ["implement"] },
      );

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("review");
      expect(result.shouldIncrementIteration).toBeFalsy();
    });

    test("blocks when maxIterations exceeded", () => {
      const sm = createWorkflowStateMachine(createIterationWorkflow());

      const result = sm.evaluateTransition(
        "review",
        { status: "failure" },
        { iteration: 2, visitedSteps: ["implement", "review", "fix"] },
      );

      expect(result.type).toBe("blocked");
    });

    test("allows transition when under maxIterations", () => {
      const sm = createWorkflowStateMachine(createIterationWorkflow());

      const result = sm.evaluateTransition(
        "review",
        { status: "failure" },
        { iteration: 1, visitedSteps: ["implement", "review", "fix"] },
      );

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("fix");
    });

    test("redirects to custom onMaxIterations target", () => {
      const workflow = createIterationWorkflow();
      const reviewStep = workflow.steps.review;
      if (reviewStep) {
        reviewStep.transitions = [
          { condition: "success", target: "__done__" },
          {
            condition: "failure",
            target: "fix",
            maxIterations: 2,
            onMaxIterations: "implement",
          },
        ];
      }

      const sm = createWorkflowStateMachine(workflow);
      const result = sm.evaluateTransition(
        "review",
        { status: "failure" },
        { iteration: 2, visitedSteps: ["implement", "review", "fix"] },
      );

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("implement");
    });

    test("works without context (backward compatibility)", () => {
      const sm = createWorkflowStateMachine(createIterationWorkflow());

      const result = sm.evaluateTransition("implement", { status: "success" });

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("review");
    });
  });

  describe("afterIteration routing", () => {
    const createAfterIterationWorkflow = (): WorkflowDefinition => ({
      version: 1,
      name: "after-iteration-workflow",
      initialStep: "implement",
      steps: {
        implement: {
          id: "implement",
          type: "implement",
          promptTemplate: "implement.md.hbs",
          maxAttempts: 1,
          transitions: [
            { condition: "success", target: "full-review" },
            { condition: "failure", target: "__blocked__" },
          ],
        },
        "full-review": {
          id: "full-review",
          type: "review",
          promptTemplate: "full-review.md.hbs",
          maxAttempts: 1,
          transitions: [
            { condition: "success", target: "__done__" },
            { condition: "failure", target: "fix" },
          ],
        },
        fix: {
          id: "fix",
          type: "debug",
          promptTemplate: "fix.md.hbs",
          maxAttempts: 1,
          transitions: [
            {
              condition: "success",
              target: "quick-review",
              afterIteration: 1,
              thenTarget: "full-review",
            },
          ],
        },
        "quick-review": {
          id: "quick-review",
          type: "review",
          promptTemplate: "quick-review.md.hbs",
          maxAttempts: 1,
          transitions: [
            { condition: "success", target: "__done__" },
            { condition: "failure", target: "fix" },
          ],
        },
      },
      terminalStates: ["__done__", "__blocked__"],
    });

    test("uses default target on iteration 0", () => {
      const sm = createWorkflowStateMachine(createAfterIterationWorkflow());

      const result = sm.evaluateTransition(
        "fix",
        { status: "success" },
        { iteration: 0, visitedSteps: ["implement", "full-review", "fix"] },
      );

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("quick-review");
    });

    test("uses thenTarget when iteration >= afterIteration", () => {
      const sm = createWorkflowStateMachine(createAfterIterationWorkflow());

      const result = sm.evaluateTransition(
        "fix",
        { status: "success" },
        { iteration: 1, visitedSteps: ["implement", "full-review", "fix", "quick-review"] },
      );

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("full-review");
    });

    test("sets shouldIncrementIteration when thenTarget loops back", () => {
      const sm = createWorkflowStateMachine(createAfterIterationWorkflow());

      const result = sm.evaluateTransition(
        "fix",
        { status: "success" },
        { iteration: 1, visitedSteps: ["implement", "full-review", "fix", "quick-review"] },
      );

      expect(result.stepId).toBe("full-review");
      expect(result.shouldIncrementIteration).toBe(true);
    });

    test("does not increment iteration on first visit via afterIteration", () => {
      const sm = createWorkflowStateMachine(createAfterIterationWorkflow());

      const result = sm.evaluateTransition(
        "fix",
        { status: "success" },
        { iteration: 0, visitedSteps: ["implement", "full-review", "fix"] },
      );

      expect(result.stepId).toBe("quick-review");
      expect(result.shouldIncrementIteration).toBeFalsy();
    });
  });
});
