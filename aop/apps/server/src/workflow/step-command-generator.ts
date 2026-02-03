import type { StepCommand } from "@aop/common/protocol";
import type { TemplateLoader } from "../prompts/template-loader.ts";
import type { WorkflowStep } from "./types.ts";

export interface StepCommandGenerator {
  generate: (step: WorkflowStep, stepExecutionId: string, attempt: number) => Promise<StepCommand>;
}

export const createStepCommandGenerator = (
  templateLoader: TemplateLoader,
): StepCommandGenerator => ({
  generate: async (
    step: WorkflowStep,
    stepExecutionId: string,
    attempt: number,
  ): Promise<StepCommand> => {
    const promptTemplate = await templateLoader.load(step.type);

    return {
      id: stepExecutionId,
      type: step.type,
      promptTemplate,
      attempt,
      signals: step.signals,
    };
  },
});
