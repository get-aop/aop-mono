import { describe, expect, test } from "bun:test";
import { parseWorkflow, WorkflowParseError } from "./workflow-parser.ts";

const validWorkflow = {
  version: 1,
  name: "test-workflow",
  initialStep: "implement",
  steps: {
    implement: {
      id: "implement",
      type: "implement",
      promptTemplate: "implement.md.hbs",
      maxAttempts: 3,
      transitions: [
        { condition: "success", target: "__done__" },
        { condition: "failure", target: "__blocked__" },
      ],
    },
  },
  terminalStates: ["__done__", "__blocked__"],
};

describe("parseWorkflow", () => {
  test("parses valid workflow definition", () => {
    const result = parseWorkflow(JSON.stringify(validWorkflow));

    expect(result.name).toBe("test-workflow");
    expect(result.initialStep).toBe("implement");
    expect(Object.keys(result.steps)).toEqual(["implement"]);
  });

  test("parses workflow with multiple steps", () => {
    const multiStepWorkflow = {
      ...validWorkflow,
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
    };

    const result = parseWorkflow(JSON.stringify(multiStepWorkflow));

    expect(Object.keys(result.steps)).toEqual(["implement", "test", "debug"]);
    expect(result.steps.implement?.transitions[0]?.target).toBe("test");
  });

  test("throws for invalid JSON", () => {
    expect(() => parseWorkflow("not json")).toThrow();
  });

  test("throws for missing required fields", () => {
    const invalid = { name: "test" };

    expect(() => parseWorkflow(JSON.stringify(invalid))).toThrow(WorkflowParseError);
  });

  test("throws for invalid step type", () => {
    const invalid = {
      ...validWorkflow,
      steps: {
        implement: {
          ...validWorkflow.steps.implement,
          type: "invalid_type",
        },
      },
    };

    expect(() => parseWorkflow(JSON.stringify(invalid))).toThrow(WorkflowParseError);
  });

  test("throws when initial step does not exist", () => {
    const invalid = {
      ...validWorkflow,
      initialStep: "nonexistent",
    };

    expect(() => parseWorkflow(JSON.stringify(invalid))).toThrow(
      'Initial step "nonexistent" not found in steps',
    );
  });

  test("throws when transition target does not exist", () => {
    const invalid = {
      ...validWorkflow,
      steps: {
        implement: {
          ...validWorkflow.steps.implement,
          transitions: [{ condition: "success", target: "nonexistent" }],
        },
      },
    };

    expect(() => parseWorkflow(JSON.stringify(invalid))).toThrow(
      'Step "implement" has transition to unknown step "nonexistent"',
    );
  });

  test("allows terminal state targets", () => {
    const result = parseWorkflow(JSON.stringify(validWorkflow));

    expect(result.steps.implement?.transitions[0]?.target).toBe("__done__");
    expect(result.steps.implement?.transitions[1]?.target).toBe("__blocked__");
  });

  test("defaults maxAttempts to 1 when not specified", () => {
    const workflowWithoutMaxAttempts = {
      ...validWorkflow,
      steps: {
        implement: {
          id: "implement",
          type: "implement",
          promptTemplate: "implement.md.hbs",
          transitions: [{ condition: "success", target: "__done__" }],
        },
      },
    };

    const result = parseWorkflow(JSON.stringify(workflowWithoutMaxAttempts));

    expect(result.steps.implement?.maxAttempts).toBe(1);
  });

  test("parses ralph-loop workflow with signal transitions", () => {
    const ralphLoopWorkflow = {
      version: 1,
      name: "ralph-loop",
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
    };

    const result = parseWorkflow(JSON.stringify(ralphLoopWorkflow));

    expect(result.name).toBe("ralph-loop");
    expect(result.initialStep).toBe("iterate");
    expect(Object.keys(result.steps)).toEqual(["iterate", "review"]);
    expect(result.steps.iterate?.signals).toEqual(["TASK_COMPLETE", "NEEDS_REVIEW"]);
    expect(result.steps.iterate?.transitions).toHaveLength(4);
    expect(result.steps.iterate?.transitions[0]?.condition).toBe("TASK_COMPLETE");
    expect(result.steps.iterate?.transitions[2]?.condition).toBe("__none__");
    expect(result.steps.iterate?.transitions[2]?.target).toBe("iterate");
  });
});
