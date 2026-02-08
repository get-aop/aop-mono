import { beforeAll, describe, expect, test } from "bun:test";
import { loadFixture, loadOfficialWorkflow, simulateExecutionServiceFlow } from "./test-utils.ts";
import type { WorkflowDefinition } from "./types.ts";
import { createWorkflowStateMachine } from "./workflow-state-machine.ts";

let linearPipeline: WorkflowDefinition;
let signalLoop: WorkflowDefinition;
let reviewCycle: WorkflowDefinition;
let conditionalRouting: WorkflowDefinition;
let aopDefault: WorkflowDefinition;

beforeAll(async () => {
  [linearPipeline, signalLoop, reviewCycle, conditionalRouting, aopDefault] = await Promise.all([
    loadFixture("linear-pipeline"),
    loadFixture("signal-loop"),
    loadFixture("review-cycle"),
    loadFixture("conditional-routing"),
    loadOfficialWorkflow("aop-default"),
  ]);
});

describe("WorkflowStateMachine", () => {
  describe("getInitialStep", () => {
    test("returns the initial step", () => {
      const sm = createWorkflowStateMachine(linearPipeline);

      const step = sm.getInitialStep();

      expect(step.id).toBe("implement");
      expect(step.type).toBe("implement");
    });

    test("throws if initial step not found", () => {
      const workflow = { ...linearPipeline, initialStep: "nonexistent" };

      const sm = createWorkflowStateMachine(workflow);

      expect(() => sm.getInitialStep()).toThrow('Initial step "nonexistent" not found');
    });
  });

  describe("getStep", () => {
    test("returns step by id", () => {
      const sm = createWorkflowStateMachine(linearPipeline);

      const step = sm.getStep("test");

      expect(step?.id).toBe("test");
      expect(step?.type).toBe("test");
    });

    test("returns undefined for nonexistent step", () => {
      const sm = createWorkflowStateMachine(linearPipeline);

      const step = sm.getStep("nonexistent");

      expect(step).toBeUndefined();
    });
  });

  describe("evaluateTransition", () => {
    test("transitions to next step on success", () => {
      const sm = createWorkflowStateMachine(linearPipeline);

      const result = sm.evaluateTransition("implement", { status: "success" });

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("test");
      expect(result.step?.type).toBe("test");
    });

    test("transitions to blocked on failure", () => {
      const sm = createWorkflowStateMachine(linearPipeline);

      const result = sm.evaluateTransition("implement", { status: "failure" });

      expect(result.type).toBe("blocked");
      expect(result.stepId).toBeUndefined();
    });

    test("transitions to done terminal state", () => {
      const sm = createWorkflowStateMachine(linearPipeline);

      const result = sm.evaluateTransition("test", { status: "success" });

      expect(result.type).toBe("done");
      expect(result.stepId).toBeUndefined();
    });

    test("transitions to another step on failure", () => {
      const sm = createWorkflowStateMachine(linearPipeline);

      const result = sm.evaluateTransition("test", { status: "failure" });

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("debug");
    });

    test("returns blocked when no matching transition", () => {
      const implementStep = linearPipeline.steps.implement;
      if (!implementStep) throw new Error("Expected implement step");
      const workflow: WorkflowDefinition = {
        ...linearPipeline,
        steps: {
          ...linearPipeline.steps,
          implement: {
            ...implementStep,
            transitions: [{ condition: "success", target: "__done__" }],
          },
        },
      };

      const sm = createWorkflowStateMachine(workflow);
      const result = sm.evaluateTransition("implement", { status: "failure" });

      expect(result.type).toBe("blocked");
    });

    test("throws for nonexistent step", () => {
      const sm = createWorkflowStateMachine(linearPipeline);

      expect(() => sm.evaluateTransition("nonexistent", { status: "success" })).toThrow(
        'Step "nonexistent" not found',
      );
    });

    test("workflow can loop back to previous step", () => {
      const sm = createWorkflowStateMachine(linearPipeline);

      const result = sm.evaluateTransition("debug", { status: "success" });

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("test");
    });
  });

  describe("signal-based transitions", () => {
    test("transitions based on detected signal", () => {
      const sm = createWorkflowStateMachine(signalLoop);

      const result = sm.evaluateTransition("iterate", {
        status: "success",
        signal: "TASK_COMPLETE",
      });

      expect(result.type).toBe("done");
    });

    test("signal takes precedence over success/failure", () => {
      const sm = createWorkflowStateMachine(signalLoop);

      const result = sm.evaluateTransition("iterate", {
        status: "failure",
        signal: "NEEDS_REVIEW",
      });

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("review");
    });

    test("uses __none__ transition when no signal detected", () => {
      const sm = createWorkflowStateMachine(signalLoop);

      const result = sm.evaluateTransition("iterate", { status: "success" });

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("iterate");
    });

    test("falls back to success/failure when no __none__ and no signal", () => {
      const iterateStep = signalLoop.steps.iterate;
      if (!iterateStep) throw new Error("Expected iterate step");
      const workflow: WorkflowDefinition = {
        ...signalLoop,
        steps: {
          ...signalLoop.steps,
          iterate: {
            ...iterateStep,
            transitions: iterateStep.transitions.filter((t) => t.condition !== "__none__"),
          },
        },
      };

      const sm = createWorkflowStateMachine(workflow);
      const result = sm.evaluateTransition("iterate", { status: "success" });

      expect(result.type).toBe("done");
    });

    test("unrecognized signal falls back to success/failure, not __none__", () => {
      const sm = createWorkflowStateMachine(signalLoop);

      const result = sm.evaluateTransition("iterate", {
        status: "success",
        signal: "UNKNOWN_SIGNAL",
      });

      expect(result.type).toBe("done");
    });

    test("signal is ignored when step has no signal transitions", () => {
      const sm = createWorkflowStateMachine(signalLoop);

      const result = sm.evaluateTransition("review", {
        status: "success",
        signal: "TASK_COMPLETE",
      });

      expect(result.type).toBe("done");
    });
  });

  describe("iteration tracking", () => {
    test("sets shouldIncrementIteration when transitioning to visited step", () => {
      const sm = createWorkflowStateMachine(reviewCycle);

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
      const sm = createWorkflowStateMachine(reviewCycle);

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
      const sm = createWorkflowStateMachine(reviewCycle);

      const result = sm.evaluateTransition(
        "review",
        { status: "failure" },
        { iteration: 2, visitedSteps: ["implement", "review", "fix"] },
      );

      expect(result.type).toBe("blocked");
    });

    test("allows transition when under maxIterations", () => {
      const sm = createWorkflowStateMachine(reviewCycle);

      const result = sm.evaluateTransition(
        "review",
        { status: "failure" },
        { iteration: 1, visitedSteps: ["implement", "review", "fix"] },
      );

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("fix");
    });

    test("redirects to custom onMaxIterations target", () => {
      const reviewStep = reviewCycle.steps.review;
      if (!reviewStep) throw new Error("Expected review step");
      const workflow: WorkflowDefinition = {
        ...reviewCycle,
        steps: {
          ...reviewCycle.steps,
          review: {
            ...reviewStep,
            transitions: [
              { condition: "success", target: "__done__" },
              {
                condition: "failure",
                target: "fix",
                maxIterations: 2,
                onMaxIterations: "implement",
              },
            ],
          },
        },
      };

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
      const sm = createWorkflowStateMachine(reviewCycle);

      const result = sm.evaluateTransition("implement", { status: "success" });

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("review");
    });
  });

  describe("afterIteration routing", () => {
    test("uses default target on iteration 0", () => {
      const sm = createWorkflowStateMachine(conditionalRouting);

      const result = sm.evaluateTransition(
        "fix",
        { status: "success" },
        { iteration: 0, visitedSteps: ["implement", "full-review", "fix"] },
      );

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("quick-review");
    });

    test("uses thenTarget when iteration >= afterIteration", () => {
      const sm = createWorkflowStateMachine(conditionalRouting);

      const result = sm.evaluateTransition(
        "fix",
        { status: "success" },
        { iteration: 1, visitedSteps: ["implement", "full-review", "fix", "quick-review"] },
      );

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("full-review");
    });

    test("sets shouldIncrementIteration when thenTarget loops back", () => {
      const sm = createWorkflowStateMachine(conditionalRouting);

      const result = sm.evaluateTransition(
        "fix",
        { status: "success" },
        { iteration: 1, visitedSteps: ["implement", "full-review", "fix", "quick-review"] },
      );

      expect(result.stepId).toBe("full-review");
      expect(result.shouldIncrementIteration).toBe(true);
    });

    test("does not increment iteration on first visit via afterIteration", () => {
      const sm = createWorkflowStateMachine(conditionalRouting);

      const result = sm.evaluateTransition(
        "fix",
        { status: "success" },
        { iteration: 0, visitedSteps: ["implement", "full-review", "fix"] },
      );

      expect(result.stepId).toBe("quick-review");
      expect(result.shouldIncrementIteration).toBeFalsy();
    });
  });

  describe("self-loop iteration isolation", () => {
    test("self-loops do not increment iteration counter", () => {
      const sm = createWorkflowStateMachine(aopDefault);

      const trace = simulateExecutionServiceFlow(sm, [
        { status: "success", signal: "CHUNK_DONE" }, // iterate → iterate (self-loop)
        { status: "success", signal: "CHUNK_DONE" }, // iterate → iterate (self-loop)
        { status: "success", signal: "CHUNK_DONE" }, // iterate → iterate (self-loop)
        { status: "success", signal: "ALL_TASKS_DONE" }, // iterate → full-review
        { status: "success", signal: "REVIEW_FAILED" }, // full-review → should go to fix-issues
      ]);

      expect(trace).toHaveLength(5);

      // All iterate self-loops should keep iteration at 0
      expect(trace[0]?.iteration).toBe(0);
      expect(trace[1]?.iteration).toBe(0);
      expect(trace[2]?.iteration).toBe(0);
      expect(trace[3]?.iteration).toBe(0);

      // REVIEW_FAILED should transition to fix-issues, NOT block
      expect(trace[4]?.iteration).toBe(0);
      expect(trace[4]?.resultType).toBe("step");
      expect(trace[4]?.nextStepId).toBe("fix-issues");
    });

    test("self-loops do not set shouldIncrementIteration", () => {
      const sm = createWorkflowStateMachine(signalLoop);

      const result = sm.evaluateTransition(
        "iterate",
        { status: "success" },
        { iteration: 0, visitedSteps: ["iterate"] },
      );

      expect(result.type).toBe("step");
      expect(result.stepId).toBe("iterate");
      expect(result.shouldIncrementIteration).toBeFalsy();
    });
  });

  describe("aop-default full flow simulation", () => {
    test("happy path: iterate → full-review(PASSED) → done", () => {
      const sm = createWorkflowStateMachine(aopDefault);

      const trace = simulateExecutionServiceFlow(sm, [
        { status: "success", signal: "ALL_TASKS_DONE" },
        { status: "success", signal: "REVIEW_PASSED" },
      ]);

      expect(trace).toHaveLength(2);
      expect(trace[0]?.nextStepId).toBe("full-review");
      expect(trace[1]?.resultType).toBe("done");
    });

    test("one review cycle: iterate → review(FAILED) → fix → quick-review(PASSED) → done", () => {
      const sm = createWorkflowStateMachine(aopDefault);

      const trace = simulateExecutionServiceFlow(sm, [
        { status: "success", signal: "ALL_TASKS_DONE" },
        { status: "success", signal: "REVIEW_FAILED" },
        { status: "success", signal: "FIX_COMPLETE" },
        { status: "success", signal: "REVIEW_PASSED" },
      ]);

      expect(trace).toHaveLength(4);
      expect(trace[0]?.nextStepId).toBe("full-review");
      expect(trace[1]?.nextStepId).toBe("fix-issues");
      expect(trace[2]?.nextStepId).toBe("quick-review");
      expect(trace[3]?.resultType).toBe("done");
    });

    test("two review cycles: fix→quick-review(FAILED)→fix should route to full-review on second fix", () => {
      const sm = createWorkflowStateMachine(aopDefault);

      const trace = simulateExecutionServiceFlow(sm, [
        { status: "success", signal: "ALL_TASKS_DONE" }, // iterate → full-review
        { status: "success", signal: "REVIEW_FAILED" }, // full-review → fix-issues
        { status: "success", signal: "FIX_COMPLETE" }, // fix-issues → quick-review
        { status: "success", signal: "REVIEW_FAILED" }, // quick-review → fix-issues
        { status: "success", signal: "FIX_COMPLETE" }, // fix-issues → should be full-review
        { status: "success", signal: "REVIEW_PASSED" }, // full-review → done
      ]);

      expect(trace).toHaveLength(6);

      // Step 1: iterate(ALL_TASKS_DONE) → full-review
      expect(trace[0]?.resolvedCurrentStepId).toBe("iterate");
      expect(trace[0]?.nextStepId).toBe("full-review");
      expect(trace[0]?.iteration).toBe(0);

      // Step 2: full-review(REVIEW_FAILED) → fix-issues
      expect(trace[1]?.resolvedCurrentStepId).toBe("full-review");
      expect(trace[1]?.nextStepId).toBe("fix-issues");
      expect(trace[1]?.iteration).toBe(0);

      // Step 3: fix-issues(FIX_COMPLETE) → quick-review (iteration 0 < afterIteration 1)
      expect(trace[2]?.resolvedCurrentStepId).toBe("fix-issues");
      expect(trace[2]?.nextStepId).toBe("quick-review");
      expect(trace[2]?.iteration).toBe(0);

      // Step 4: quick-review(REVIEW_FAILED) → fix-issues (loops back, increments iteration)
      expect(trace[3]?.resolvedCurrentStepId).toBe("quick-review");
      expect(trace[3]?.nextStepId).toBe("fix-issues");
      expect(trace[3]?.iteration).toBe(0);

      // Step 5: fix-issues(FIX_COMPLETE) → full-review (iteration 1 >= afterIteration 1, uses thenTarget)
      expect(trace[4]?.resolvedCurrentStepId).toBe("fix-issues");
      expect(trace[4]?.nextStepId).toBe("full-review");
      expect(trace[4]?.iteration).toBe(1);
      expect(trace[4]?.resultType).toBe("step");

      // Step 6: full-review(REVIEW_PASSED) → done
      expect(trace[5]?.resolvedCurrentStepId).toBe("full-review");
      expect(trace[5]?.resultType).toBe("done");
    });
  });
});
