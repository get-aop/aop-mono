import type { SignalDefinition, StepCommand } from "@aop/common/protocol";
import type { TemplateLoader } from "../prompts/template-loader.ts";
import { getStepBlock } from "./step-library.ts";
import type { WorkflowStep } from "./types.ts";

export interface StepCommandGenerator {
  generate: (
    step: WorkflowStep,
    stepExecutionId: string,
    attempt: number,
    iteration: number,
  ) => Promise<StepCommand>;
}

const enrichSignals = (step: WorkflowStep): SignalDefinition[] => {
  const stepBlock = getStepBlock(step.id);
  const yamlSignals = step.signals ?? [];

  if (!stepBlock) {
    return yamlSignals;
  }

  const descriptionMap = new Map(
    stepBlock.signals.map((signal: SignalDefinition) => [signal.name, signal.description]),
  );
  return yamlSignals.map((s) => ({
    name: s.name,
    description: descriptionMap.get(s.name) ?? s.description,
  }));
};

export const createStepCommandGenerator = (
  templateLoader: TemplateLoader,
): StepCommandGenerator => ({
  generate: async (
    step: WorkflowStep,
    stepExecutionId: string,
    attempt: number,
    iteration: number,
  ): Promise<StepCommand> => {
    const promptTemplate = await templateLoader.load(step.promptTemplate);

    return {
      id: stepExecutionId,
      type: step.type,
      stepId: step.id,
      promptTemplate,
      attempt,
      signals: enrichSignals(step),
      iteration,
    };
  },
});
