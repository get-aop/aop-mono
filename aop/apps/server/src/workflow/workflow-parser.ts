import { isTerminalState, type WorkflowDefinition, WorkflowDefinitionSchema } from "./types.ts";

export class WorkflowParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowParseError";
  }
}

export const parseWorkflow = (json: string): WorkflowDefinition => {
  const data = JSON.parse(json);
  return validateAndParseWorkflow(data);
};

export const validateAndParseWorkflow = (data: unknown): WorkflowDefinition => {
  const result = WorkflowDefinitionSchema.safeParse(data);

  if (!result.success) {
    throw new WorkflowParseError(`Invalid workflow definition: ${result.error.message}`);
  }

  const definition = result.data;
  validateWorkflowStructure(definition);
  return definition;
};

const validateWorkflowStructure = (definition: WorkflowDefinition): void => {
  if (!definition.steps[definition.initialStep]) {
    throw new WorkflowParseError(`Initial step "${definition.initialStep}" not found in steps`);
  }

  for (const [stepId, step] of Object.entries(definition.steps)) {
    for (const transition of step.transitions) {
      if (!isTerminalState(transition.target) && !definition.steps[transition.target]) {
        throw new WorkflowParseError(
          `Step "${stepId}" has transition to unknown step "${transition.target}"`,
        );
      }
    }
  }
};
