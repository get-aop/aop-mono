import { describe, expect, test } from "bun:test";
import { WorkflowParseError } from "./workflow-parser.ts";
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
      - TASK_COMPLETE
      - NEEDS_REVIEW
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
    expect(result.steps.iterate?.signals).toEqual(["TASK_COMPLETE", "NEEDS_REVIEW"]);
  });
});
