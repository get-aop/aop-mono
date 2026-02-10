import { beforeAll, describe, expect, test } from "bun:test";
import {
  asStepResult,
  loadFixture,
  loadOfficialWorkflow,
  simulateExecutionServiceFlow,
} from "./test-utils.ts";
import { isTerminalState, TERMINAL_PAUSED, type WorkflowDefinition } from "./types.ts";
import { createWorkflowStateMachine } from "./workflow-state-machine.ts";

let linearPipeline: WorkflowDefinition;
let signalLoop: WorkflowDefinition;
let reviewCycle: WorkflowDefinition;
let conditionalRouting: WorkflowDefinition;
let aopDefault: WorkflowDefinition;
let pausedWorkflow: WorkflowDefinition;
let landingPage: WorkflowDefinition;
let deepResearch: WorkflowDefinition;

beforeAll(async () => {
  [
    linearPipeline,
    signalLoop,
    reviewCycle,
    conditionalRouting,
    aopDefault,
    pausedWorkflow,
    landingPage,
    deepResearch,
  ] = await Promise.all([
    loadFixture("linear-pipeline"),
    loadFixture("signal-loop"),
    loadFixture("review-cycle"),
    loadFixture("conditional-routing"),
    loadOfficialWorkflow("aop-default"),
    loadFixture("paused-workflow"),
    loadOfficialWorkflow("landing-page"),
    loadOfficialWorkflow("deep-research"),
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

      const result = asStepResult(sm.evaluateTransition("implement", { status: "success" }));

      expect(result.stepId).toBe("test");
      expect(result.step.type).toBe("test");
    });

    test("transitions to blocked on failure", () => {
      const sm = createWorkflowStateMachine(linearPipeline);

      const result = sm.evaluateTransition("implement", { status: "failure" });

      expect(result.type).toBe("blocked");
    });

    test("transitions to done terminal state", () => {
      const sm = createWorkflowStateMachine(linearPipeline);

      const result = sm.evaluateTransition("test", { status: "success" });

      expect(result.type).toBe("done");
    });

    test("transitions to another step on failure", () => {
      const sm = createWorkflowStateMachine(linearPipeline);

      const result = asStepResult(sm.evaluateTransition("test", { status: "failure" }));

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

      const result = asStepResult(sm.evaluateTransition("debug", { status: "success" }));

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

    test("failure takes precedence over signal", () => {
      const sm = createWorkflowStateMachine(signalLoop);

      const result = sm.evaluateTransition("iterate", {
        status: "failure",
        signal: "NEEDS_REVIEW",
      });

      expect(result.type).toBe("blocked");
    });

    test("signal works normally with success status", () => {
      const sm = createWorkflowStateMachine(signalLoop);

      const result = asStepResult(
        sm.evaluateTransition("iterate", {
          status: "success",
          signal: "NEEDS_REVIEW",
        }),
      );

      expect(result.stepId).toBe("review");
    });

    test("uses __none__ transition when no signal detected and step succeeded", () => {
      const sm = createWorkflowStateMachine(signalLoop);

      const result = asStepResult(sm.evaluateTransition("iterate", { status: "success" }));

      expect(result.stepId).toBe("iterate");
    });

    test("failure skips __none__ and uses failure transition", () => {
      const sm = createWorkflowStateMachine(signalLoop);

      const result = sm.evaluateTransition("iterate", { status: "failure" });

      expect(result.type).toBe("blocked");
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

      const result = asStepResult(
        sm.evaluateTransition(
          "fix",
          { status: "success" },
          { iteration: 0, visitedSteps: ["implement", "review", "fix"] },
        ),
      );

      expect(result.stepId).toBe("review");
      expect(result.shouldIncrementIteration).toBe(true);
    });

    test("does not set shouldIncrementIteration when step not yet visited", () => {
      const sm = createWorkflowStateMachine(reviewCycle);

      const result = asStepResult(
        sm.evaluateTransition(
          "implement",
          { status: "success" },
          { iteration: 0, visitedSteps: ["implement"] },
        ),
      );

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

      const result = asStepResult(
        sm.evaluateTransition(
          "review",
          { status: "failure" },
          { iteration: 1, visitedSteps: ["implement", "review", "fix"] },
        ),
      );

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
      const result = asStepResult(
        sm.evaluateTransition(
          "review",
          { status: "failure" },
          { iteration: 2, visitedSteps: ["implement", "review", "fix"] },
        ),
      );

      expect(result.stepId).toBe("implement");
    });

    test("works without context (backward compatibility)", () => {
      const sm = createWorkflowStateMachine(reviewCycle);

      const result = asStepResult(sm.evaluateTransition("implement", { status: "success" }));

      expect(result.stepId).toBe("review");
    });
  });

  describe("afterIteration routing", () => {
    test("uses default target on iteration 0", () => {
      const sm = createWorkflowStateMachine(conditionalRouting);

      const result = asStepResult(
        sm.evaluateTransition(
          "fix",
          { status: "success" },
          { iteration: 0, visitedSteps: ["implement", "full-review", "fix"] },
        ),
      );

      expect(result.stepId).toBe("quick-review");
    });

    test("uses thenTarget when iteration >= afterIteration", () => {
      const sm = createWorkflowStateMachine(conditionalRouting);

      const result = asStepResult(
        sm.evaluateTransition(
          "fix",
          { status: "success" },
          { iteration: 1, visitedSteps: ["implement", "full-review", "fix", "quick-review"] },
        ),
      );

      expect(result.stepId).toBe("full-review");
    });

    test("sets shouldIncrementIteration when thenTarget loops back", () => {
      const sm = createWorkflowStateMachine(conditionalRouting);

      const result = asStepResult(
        sm.evaluateTransition(
          "fix",
          { status: "success" },
          { iteration: 1, visitedSteps: ["implement", "full-review", "fix", "quick-review"] },
        ),
      );

      expect(result.stepId).toBe("full-review");
      expect(result.shouldIncrementIteration).toBe(true);
    });

    test("does not increment iteration on first visit via afterIteration", () => {
      const sm = createWorkflowStateMachine(conditionalRouting);

      const result = asStepResult(
        sm.evaluateTransition(
          "fix",
          { status: "success" },
          { iteration: 0, visitedSteps: ["implement", "full-review", "fix"] },
        ),
      );

      expect(result.stepId).toBe("quick-review");
      expect(result.shouldIncrementIteration).toBeFalsy();
    });
  });

  describe("aop-default full flow simulation", () => {
    test("iterate failure blocks instead of looping via __none__", () => {
      const sm = createWorkflowStateMachine(aopDefault);

      const result = sm.evaluateTransition("iterate", { status: "failure" });

      expect(result.type).toBe("blocked");
    });

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

  describe("landing-page outline_page transitions", () => {
    test("PLAN_READY pauses for human approval", () => {
      const sm = createWorkflowStateMachine(landingPage);

      const result = sm.evaluateTransition("outline_page", {
        status: "success",
        signal: "PLAN_READY",
      });

      expect(result.type).toBe("paused");
    });

    test("PLAN_APPROVED transitions to write_copy", () => {
      const sm = createWorkflowStateMachine(landingPage);

      const result = asStepResult(
        sm.evaluateTransition("outline_page", {
          status: "success",
          signal: "PLAN_APPROVED",
        }),
      );

      expect(result.stepId).toBe("write_copy");
    });

    test("__none__ loops back to outline_page when no signal emitted", () => {
      const sm = createWorkflowStateMachine(landingPage);

      const result = asStepResult(sm.evaluateTransition("outline_page", { status: "success" }));

      expect(result.stepId).toBe("outline_page");
    });

    test("REQUIRES_INPUT pauses for human input", () => {
      const sm = createWorkflowStateMachine(landingPage);

      const result = sm.evaluateTransition("outline_page", {
        status: "success",
        signal: "REQUIRES_INPUT",
      });

      expect(result.type).toBe("paused");
    });

    test("failure blocks the workflow", () => {
      const sm = createWorkflowStateMachine(landingPage);

      const result = sm.evaluateTransition("outline_page", { status: "failure" });

      expect(result.type).toBe("blocked");
    });

    test("outline flow pauses: market_analysis → design_brief → outline_page(PLAN_READY) → paused", () => {
      const sm = createWorkflowStateMachine(landingPage);

      const trace = simulateExecutionServiceFlow(sm, [
        { status: "success", signal: "RESEARCH_COMPLETE" },
        { status: "success", signal: "BRIEF_READY" },
        { status: "success", signal: "PLAN_READY" },
      ]);

      expect(trace).toHaveLength(3);
      expect(trace[0]?.nextStepId).toBe("design_brief");
      expect(trace[1]?.nextStepId).toBe("outline_page");
      expect(trace[2]?.resultType).toBe("paused");
    });
  });

  describe("deep-research plan_research transitions", () => {
    test("PLAN_READY pauses for human approval", () => {
      const sm = createWorkflowStateMachine(deepResearch);

      const result = sm.evaluateTransition("plan_research", {
        status: "success",
        signal: "PLAN_READY",
      });

      expect(result.type).toBe("paused");
    });

    test("PLAN_APPROVED transitions to research", () => {
      const sm = createWorkflowStateMachine(deepResearch);

      const result = asStepResult(
        sm.evaluateTransition("plan_research", {
          status: "success",
          signal: "PLAN_APPROVED",
        }),
      );

      expect(result.stepId).toBe("research");
    });

    test("__none__ loops back to plan_research when no signal emitted", () => {
      const sm = createWorkflowStateMachine(deepResearch);

      const result = asStepResult(sm.evaluateTransition("plan_research", { status: "success" }));

      expect(result.stepId).toBe("plan_research");
    });

    test("failure blocks the workflow", () => {
      const sm = createWorkflowStateMachine(deepResearch);

      const result = sm.evaluateTransition("plan_research", { status: "failure" });

      expect(result.type).toBe("blocked");
    });

    test("plan flow pauses: codebase_research → plan_research(PLAN_READY) → paused", () => {
      const sm = createWorkflowStateMachine(deepResearch);

      const trace = simulateExecutionServiceFlow(sm, [
        { status: "success", signal: "RESEARCH_COMPLETE" },
        { status: "success", signal: "PLAN_READY" },
      ]);

      expect(trace).toHaveLength(2);
      expect(trace[0]?.nextStepId).toBe("plan_research");
      expect(trace[1]?.resultType).toBe("paused");
    });
  });

  describe("PAUSED workflow transitions", () => {
    test("REQUIRES_INPUT signal transitions to paused", () => {
      const sm = createWorkflowStateMachine(pausedWorkflow);

      const result = sm.evaluateTransition("plan", {
        status: "success",
        signal: "REQUIRES_INPUT",
      });

      expect(result.type).toBe("paused");
    });

    test("isTerminalState recognizes __paused__", () => {
      expect(isTerminalState(TERMINAL_PAUSED)).toBe(true);
      expect(isTerminalState("__paused__")).toBe(true);
    });

    test("research step type is accepted in workflow", () => {
      const sm = createWorkflowStateMachine(pausedWorkflow);

      const step = sm.getInitialStep();

      expect(step.id).toBe("research");
      expect(step.type).toBe("research");
    });

    test("paused workflow simulation: research → plan(REQUIRES_INPUT) → paused", () => {
      const sm = createWorkflowStateMachine(pausedWorkflow);

      const trace = simulateExecutionServiceFlow(sm, [
        { status: "success", signal: "RESEARCH_COMPLETE" },
        { status: "success", signal: "REQUIRES_INPUT" },
      ]);

      expect(trace).toHaveLength(2);
      expect(trace[0]?.nextStepId).toBe("plan");
      expect(trace[1]?.resultType).toBe("paused");
    });

    test("paused workflow happy path: research → plan(PLAN_READY) → implement → done", () => {
      const sm = createWorkflowStateMachine(pausedWorkflow);

      const trace = simulateExecutionServiceFlow(sm, [
        { status: "success", signal: "RESEARCH_COMPLETE" },
        { status: "success", signal: "PLAN_READY" },
        { status: "success", signal: "TASK_COMPLETE" },
      ]);

      expect(trace).toHaveLength(3);
      expect(trace[0]?.nextStepId).toBe("plan");
      expect(trace[1]?.nextStepId).toBe("implement");
      expect(trace[2]?.resultType).toBe("done");
    });
  });
});
