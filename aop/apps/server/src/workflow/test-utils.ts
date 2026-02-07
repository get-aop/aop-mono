import { join } from "node:path";
import type { WorkflowDefinition } from "./types.ts";
import type { TransitionResult, WorkflowStateMachine } from "./workflow-state-machine.ts";
import { createWorkflowStateMachine } from "./workflow-state-machine.ts";
import { parseWorkflowYaml } from "./yaml-parser.ts";

const FIXTURES_DIR = join(import.meta.dir, "fixtures");
const WORKFLOWS_DIR = join(import.meta.dir, "../../workflows");

export const loadFixture = async (name: string): Promise<WorkflowDefinition> => {
  const content = await Bun.file(join(FIXTURES_DIR, `${name}.yaml`)).text();
  return parseWorkflowYaml(content);
};

export const loadOfficialWorkflow = async (name: string): Promise<WorkflowDefinition> => {
  const content = await Bun.file(join(WORKFLOWS_DIR, `${name}.yaml`)).text();
  return parseWorkflowYaml(content);
};

export const loadFixtureStateMachine = async (name: string): Promise<WorkflowStateMachine> => {
  const workflow = await loadFixture(name);
  return createWorkflowStateMachine(workflow);
};

export const loadOfficialStateMachine = async (name: string): Promise<WorkflowStateMachine> => {
  const workflow = await loadOfficialWorkflow(name);
  return createWorkflowStateMachine(workflow);
};

// --- Flow simulation helpers (mirror execution-service state tracking) ---

export interface TraceEntry {
  stepId: string;
  signal?: string;
  resolvedCurrentStepId: string;
  nextStepId?: string;
  resultType: string;
  iteration: number;
}

export interface SimState {
  currentStepId: string;
  iteration: number;
  visitedSteps: string[];
}

/** Move visited step to end so .at(-1) tracks current step (mirrors execution-service) */
export const updateVisitedSteps = (visited: string[], nextId: string): string[] =>
  visited.includes(nextId)
    ? [...visited.filter((s) => s !== nextId), nextId]
    : [...visited, nextId];

export const evaluateStep = (
  sm: WorkflowStateMachine,
  state: SimState,
  step: { signal?: string; status: "success" | "failure" },
): { entry: TraceEntry; nextState: SimState | null } => {
  const resolvedCurrentStepId = state.visitedSteps.at(-1) ?? state.currentStepId;
  const result: TransitionResult = sm.evaluateTransition(
    resolvedCurrentStepId,
    { status: step.status, signal: step.signal },
    { iteration: state.iteration, visitedSteps: [...state.visitedSteps] },
  );

  const entry: TraceEntry = {
    stepId: state.currentStepId,
    signal: step.signal,
    resolvedCurrentStepId,
    nextStepId: result.stepId,
    resultType: result.type,
    iteration: state.iteration,
  };

  if (result.type !== "step" || !result.stepId) return { entry, nextState: null };

  return {
    entry,
    nextState: {
      currentStepId: result.stepId,
      visitedSteps: updateVisitedSteps(state.visitedSteps, result.stepId),
      iteration: result.shouldIncrementIteration ? state.iteration + 1 : state.iteration,
    },
  };
};

/**
 * Simulates how execution-service tracks state: visited_steps where
 * .at(-1) is assumed to be the current step.
 */
export const simulateExecutionServiceFlow = (
  sm: WorkflowStateMachine,
  steps: Array<{ signal?: string; status: "success" | "failure" }>,
): TraceEntry[] => {
  const initialStep = sm.getInitialStep();
  let state: SimState = {
    currentStepId: initialStep.id,
    iteration: 0,
    visitedSteps: [initialStep.id],
  };
  const trace: TraceEntry[] = [];

  for (const step of steps) {
    const { entry, nextState } = evaluateStep(sm, state, step);
    trace.push(entry);
    if (!nextState) break;
    state = nextState;
  }

  return trace;
};
