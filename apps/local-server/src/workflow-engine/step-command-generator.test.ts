import { describe, expect, test } from "bun:test";
import { createStepCommandGenerator } from "./step-command-generator.ts";
import type { WorkflowStep } from "./types.ts";

describe("StepCommandGenerator", () => {
  test("loads the prompt template and enriches known signal descriptions from the step library", async () => {
    const generator = createStepCommandGenerator({
      load: async (template) => `resolved:${template}`,
      clearCache: () => {},
    });
    const step: WorkflowStep = {
      id: "plan_implementation",
      type: "iterate",
      promptTemplate: "plan-implementation.md.hbs",
      maxAttempts: 1,
      signals: [{ name: "PLAN_READY", description: "yaml description" }],
      transitions: [],
    };

    const command = await generator.generate(step, "step-1", 2, 3);

    expect(command).toEqual({
      id: "step-1",
      type: "iterate",
      stepId: "plan_implementation",
      promptTemplate: "resolved:plan-implementation.md.hbs",
      attempt: 2,
      iteration: 3,
      signals: [
        {
          name: "PLAN_READY",
          description: "plan.md and numbered subtask docs are written and ready for human approval",
        },
      ],
    });
  });

  test("keeps YAML signal descriptions for steps that are not in the library", async () => {
    const generator = createStepCommandGenerator({
      load: async (template) => template,
      clearCache: () => {},
    });
    const step: WorkflowStep = {
      id: "custom_step",
      type: "implement",
      promptTemplate: "implement.md.hbs",
      maxAttempts: 1,
      signals: [{ name: "CUSTOM", description: "custom description" }],
      transitions: [],
    };

    const command = await generator.generate(step, "step-2", 1, 0);

    expect(command.signals).toEqual([{ name: "CUSTOM", description: "custom description" }]);
  });

  test("defaults signals to an empty array when the workflow step has none", async () => {
    const generator = createStepCommandGenerator({
      load: async () => "resolved",
      clearCache: () => {},
    });
    const step: WorkflowStep = {
      id: "custom_step",
      type: "test",
      promptTemplate: "run-tests.md.hbs",
      maxAttempts: 1,
      transitions: [],
    };

    const command = await generator.generate(step, "step-3", 1, 0);

    expect(command.signals).toEqual([]);
  });

  test("copies step agent config into the generated command", async () => {
    const generator = createStepCommandGenerator({
      load: async () => "resolved",
      clearCache: () => {},
    });
    const step: WorkflowStep = {
      id: "quick-review",
      type: "review",
      promptTemplate: "quick-review.md.hbs",
      maxAttempts: 1,
      agent: {
        provider: "openai",
        model: "gpt-5.4",
        reasoning: "medium",
      },
      transitions: [],
    };

    const command = await generator.generate(step, "step-4", 1, 0);

    expect(command.agent).toEqual({
      provider: "openai",
      model: "gpt-5.4",
      reasoning: "medium",
    });
  });
});
