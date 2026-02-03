import {
  TERMINAL_BLOCKED,
  TERMINAL_SUCCESS,
  type Transition,
  TransitionCondition,
  type WorkflowDefinition,
  type WorkflowStep,
} from "./types.ts";

export interface StepResult {
  status: "success" | "failure";
  signal?: string;
}

export interface TransitionResult {
  type: "step" | "done" | "blocked";
  stepId?: string;
  step?: WorkflowStep;
}

export interface WorkflowStateMachine {
  getInitialStep: () => WorkflowStep;
  evaluateTransition: (stepId: string, result: StepResult) => TransitionResult;
  getStep: (stepId: string) => WorkflowStep | undefined;
}

const resolveTransitionTarget = (
  target: string,
  steps: Record<string, WorkflowStep>,
): TransitionResult => {
  if (target === TERMINAL_SUCCESS) {
    return { type: "done" };
  }
  if (target === TERMINAL_BLOCKED) {
    return { type: "blocked" };
  }

  const nextStep = steps[target];
  if (!nextStep) {
    throw new Error(`Target step "${target}" not found`);
  }
  return { type: "step", stepId: target, step: nextStep };
};

const findMatchingTransition = (
  transitions: Transition[],
  result: StepResult,
): Transition | undefined => {
  // Priority: signal → __none__ → success/failure
  if (result.signal) {
    const signalTransition = transitions.find((t) => t.condition === result.signal);
    if (signalTransition) return signalTransition;
  }

  if (!result.signal) {
    const noneTransition = transitions.find((t) => t.condition === TransitionCondition.NONE);
    if (noneTransition) return noneTransition;
  }

  return transitions.find((t) => t.condition === result.status);
};

export const createWorkflowStateMachine = (
  definition: WorkflowDefinition,
): WorkflowStateMachine => {
  const getStep = (stepId: string): WorkflowStep | undefined => definition.steps[stepId];

  const getInitialStep = (): WorkflowStep => {
    const step = definition.steps[definition.initialStep];
    if (!step) {
      throw new Error(`Initial step "${definition.initialStep}" not found`);
    }
    return step;
  };

  const evaluateTransition = (stepId: string, result: StepResult): TransitionResult => {
    const step = definition.steps[stepId];
    if (!step) {
      throw new Error(`Step "${stepId}" not found`);
    }

    const transition = findMatchingTransition(step.transitions, result);
    if (!transition) {
      return { type: "blocked" };
    }

    return resolveTransitionTarget(transition.target, definition.steps);
  };

  return { getInitialStep, evaluateTransition, getStep };
};
