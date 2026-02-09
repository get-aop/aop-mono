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

export interface IterationContext {
  iteration: number;
  visitedSteps: string[];
}

export interface TransitionResult {
  type: "step" | "done" | "blocked";
  stepId?: string;
  step?: WorkflowStep;
  shouldIncrementIteration?: boolean;
}

export interface WorkflowStateMachine {
  getInitialStep: () => WorkflowStep;
  evaluateTransition: (
    stepId: string,
    result: StepResult,
    context?: IterationContext,
  ) => TransitionResult;
  getStep: (stepId: string) => WorkflowStep | undefined;
}

const resolveTarget = (target: string, steps: Record<string, WorkflowStep>): TransitionResult => {
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

const isLoopingBack = (result: TransitionResult, visitedSteps: string[]): boolean =>
  result.type === "step" &&
  result.stepId !== undefined &&
  visitedSteps.includes(result.stepId) &&
  result.stepId !== visitedSteps.at(-1);

const withIterationFlag = (result: TransitionResult, shouldIncrement: boolean): TransitionResult =>
  shouldIncrement ? { ...result, shouldIncrementIteration: true } : result;

const resolveTransitionWithIteration = (
  transition: Transition,
  steps: Record<string, WorkflowStep>,
  context?: IterationContext,
): TransitionResult => {
  const { maxIterations, onMaxIterations, afterIteration, thenTarget, target } = transition;
  const iteration = context?.iteration ?? 0;
  const visitedSteps = context?.visitedSteps ?? [];

  if (maxIterations !== undefined && iteration >= maxIterations) {
    return resolveTarget(onMaxIterations ?? TERMINAL_BLOCKED, steps);
  }

  if (afterIteration !== undefined && thenTarget !== undefined && iteration >= afterIteration) {
    const result = resolveTarget(thenTarget, steps);
    return withIterationFlag(result, isLoopingBack(result, visitedSteps));
  }

  const result = resolveTarget(target, steps);
  const shouldIncrement = afterIteration === undefined && isLoopingBack(result, visitedSteps);
  return withIterationFlag(result, shouldIncrement);
};

const findMatchingTransition = (
  transitions: Transition[],
  result: StepResult,
): Transition | undefined => {
  // Priority: signal → status(failure) → __none__ → status(success/failure)
  if (result.signal) {
    const signalTransition = transitions.find((t) => t.condition === result.signal);
    if (signalTransition) return signalTransition;
  }

  // Failures skip __none__ — a crashed agent should not be treated as "no signal yet"
  if (result.status === "failure") {
    return transitions.find((t) => t.condition === result.status);
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

  const evaluateTransition = (
    stepId: string,
    result: StepResult,
    context?: IterationContext,
  ): TransitionResult => {
    const step = definition.steps[stepId];
    if (!step) {
      throw new Error(`Step "${stepId}" not found`);
    }

    const transition = findMatchingTransition(step.transitions, result);
    if (!transition) {
      return { type: "blocked" };
    }

    return resolveTransitionWithIteration(transition, definition.steps, context);
  };

  return { getInitialStep, evaluateTransition, getStep };
};
