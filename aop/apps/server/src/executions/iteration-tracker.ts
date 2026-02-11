import type { Kysely } from "kysely";
import type { Database, Execution } from "../db/schema.ts";
import type { WorkflowStep } from "../workflow/types.ts";
import { parseWorkflow } from "../workflow/workflow-parser.ts";
import type { IterationContext, WorkflowStateMachine } from "../workflow/workflow-state-machine.ts";
import { createWorkflowStateMachine } from "../workflow/workflow-state-machine.ts";
import { createExecutionRepository } from "./execution-repository.ts";
import type { TransactionRepositories } from "./types.ts";

export const parseVisitedSteps = (visitedSteps: string): string[] => {
  try {
    const parsed = JSON.parse(visitedSteps);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const buildIterationContext = (execution: Execution): IterationContext => ({
  iteration: execution.iteration,
  visitedSteps: parseVisitedSteps(execution.visited_steps),
});

export interface WorkflowContext {
  execution: Execution;
  stateMachine: WorkflowStateMachine;
  iterationContext: IterationContext;
  currentStepId: string;
}

export const resolveWorkflowContext = async (
  repos: TransactionRepositories,
  executionId: string,
): Promise<WorkflowContext> => {
  const execution = await repos.executionRepo.findById(executionId);
  if (!execution) {
    throw new Error(`Execution "${executionId}" not found`);
  }

  const workflow = await repos.workflowRepo.findById(execution.workflow_id);
  if (!workflow) {
    throw new Error(`Workflow "${execution.workflow_id}" not found`);
  }

  const workflowDef = parseWorkflow(workflow.definition);
  const stateMachine = createWorkflowStateMachine(workflowDef);
  const iterationContext = buildIterationContext(execution);

  const currentStepId = iterationContext.visitedSteps.at(-1);
  if (!currentStepId) {
    throw new Error(`No visited steps found for execution "${executionId}"`);
  }

  return { execution, stateMachine, iterationContext, currentStepId };
};

export interface StartContext {
  targetStep: WorkflowStep;
  visitedSteps: string[];
  iteration: number;
}

export const resolveRetryContext = async (
  db: Kysely<Database>,
  stateMachine: WorkflowStateMachine,
  taskId: string,
  retryFromStep: string,
  workflowName: string,
): Promise<StartContext> => {
  const step = stateMachine.getStep(retryFromStep);
  if (!step) {
    throw new Error(`Step "${retryFromStep}" not found in workflow "${workflowName}"`);
  }

  const executionRepo = createExecutionRepository(db);
  const previousExecution = await executionRepo.findLatestByTask(taskId);
  if (!previousExecution) {
    return { targetStep: step, visitedSteps: [retryFromStep], iteration: 0 };
  }

  const previousVisited = parseVisitedSteps(previousExecution.visited_steps);
  const stepIndex = previousVisited.indexOf(retryFromStep);
  const visitedSteps =
    stepIndex >= 0 ? previousVisited.slice(0, stepIndex + 1) : [...previousVisited, retryFromStep];

  return { targetStep: step, visitedSteps, iteration: previousExecution.iteration };
};

/**
 * Builds updated visited steps list, moving looping steps to the end
 * so .at(-1) correctly tracks the current step.
 */
export const buildUpdatedVisitedSteps = (
  currentVisitedSteps: string[],
  nextStepId: string,
): string[] =>
  currentVisitedSteps.includes(nextStepId)
    ? [...currentVisitedSteps.filter((s) => s !== nextStepId), nextStepId]
    : [...currentVisitedSteps, nextStepId];
