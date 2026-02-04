import {
  isTerminalState,
  type Transition,
  type WorkflowDefinition,
  WorkflowDefinitionSchema,
} from "./types.ts";

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

const isValidTarget = (target: string, steps: WorkflowDefinition["steps"]): boolean =>
  isTerminalState(target) || !!steps[target];

const validateTransitionTarget = (
  stepId: string,
  target: string | undefined,
  fieldName: string,
  steps: WorkflowDefinition["steps"],
): void => {
  if (target && !isValidTarget(target, steps)) {
    throw new WorkflowParseError(`Step "${stepId}" has ${fieldName} to unknown step "${target}"`);
  }
};

const validateTransition = (
  stepId: string,
  transition: Transition,
  steps: WorkflowDefinition["steps"],
): void => {
  validateTransitionTarget(stepId, transition.target, "transition", steps);
  validateTransitionTarget(stepId, transition.onMaxIterations, "onMaxIterations", steps);
  validateTransitionTarget(stepId, transition.thenTarget, "thenTarget", steps);
};

const validateWorkflowStructure = (definition: WorkflowDefinition): void => {
  if (!definition.steps[definition.initialStep]) {
    throw new WorkflowParseError(`Initial step "${definition.initialStep}" not found in steps`);
  }

  for (const [stepId, step] of Object.entries(definition.steps)) {
    for (const transition of step.transitions) {
      validateTransition(stepId, transition, definition.steps);
    }
  }
};
