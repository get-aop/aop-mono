import type { StepCompleteResponse, TaskStatus } from "@aop/common/protocol";
import { generateTypeId, getLogger } from "@aop/infra";
import type { Client, Execution, StepExecution } from "../db/schema.ts";
import type { StepCommandGenerator } from "../workflow/step-command-generator.ts";
import type {
  IterationContext,
  StepResult,
  StepTransitionResult,
  TerminalTransitionResult,
  TransitionResult,
} from "../workflow/workflow-state-machine.ts";
import { buildUpdatedVisitedSteps, resolveWorkflowContext } from "./iteration-tracker.ts";
import type { ProcessStepResultInput, TransactionRepositories } from "./types.ts";

const logger = getLogger("step-processor");

export const validateAndLockStep = async (
  repos: TransactionRepositories,
  stepId: string,
  clientId: string,
): Promise<StepExecution> => {
  const lockedStep = await repos.stepExecutionRepo.findByIdForUpdate(stepId);
  if (!lockedStep) {
    throw new Error(`Step execution "${stepId}" not found`);
  }
  if (lockedStep.client_id !== clientId) {
    throw new Error("Step does not belong to this client");
  }
  return lockedStep;
};

export const buildIdempotentResponse = async (
  repos: TransactionRepositories,
  step: StepExecution,
): Promise<StepCompleteResponse> => {
  const execution = await repos.executionRepo.findById(step.execution_id);
  if (!execution) {
    return { taskStatus: "WORKING", step: null };
  }

  const task = await repos.taskRepo.findById(execution.task_id);
  const taskStatus: TaskStatus = task?.status ?? "WORKING";
  return { taskStatus, step: null };
};

export const validatePausedStep = async (
  repos: TransactionRepositories,
  stepId: string,
  clientId: string,
): Promise<StepExecution> => {
  const pausedStep = await repos.stepExecutionRepo.findByIdForUpdate(stepId);
  if (!pausedStep) {
    throw new Error(`Step execution "${stepId}" not found`);
  }
  if (pausedStep.client_id !== clientId) {
    throw new Error("Step does not belong to this client");
  }
  if (pausedStep.status !== "awaiting_input") {
    throw new Error(`Step "${stepId}" is not awaiting input (status: ${pausedStep.status})`);
  }
  return pausedStep;
};

export const processStep = async (
  repos: TransactionRepositories,
  client: Client,
  input: ProcessStepResultInput,
  stepCommandGen: StepCommandGenerator,
): Promise<StepCompleteResponse> => {
  const ctx = await resolveWorkflowContext(repos, input.executionId);
  const stepResult: StepResult = { status: input.status, signal: input.signal };
  const transition = ctx.stateMachine.evaluateTransition(
    ctx.currentStepId,
    stepResult,
    ctx.iterationContext,
  );

  await repos.stepExecutionRepo.update(input.stepId, {
    status: transition.type === "paused" ? "awaiting_input" : input.status,
    error_code: input.errorCode ?? null,
    signal: input.signal ?? null,
    pause_context: transition.type === "paused" ? (input.pauseContext ?? null) : null,
    ended_at: new Date(),
  });

  return handleTransition(
    repos,
    transition,
    ctx.execution,
    client,
    ctx.iterationContext,
    stepCommandGen,
  );
};

const handleTransition = async (
  repos: TransactionRepositories,
  transition: TransitionResult,
  execution: Execution,
  client: Client,
  iterationContext: IterationContext,
  stepCommandGen: StepCommandGenerator,
): Promise<StepCompleteResponse> => {
  if (transition.type !== "step") {
    return handleTerminalTransition(repos, transition, execution);
  }
  return handleStepTransition(
    repos,
    transition,
    execution,
    client,
    iterationContext,
    stepCommandGen,
  );
};

const handleTerminalTransition = async (
  repos: TransactionRepositories,
  transition: TerminalTransitionResult,
  execution: Execution,
): Promise<StepCompleteResponse> => {
  if (transition.type === "done") {
    await repos.executionRepo.update(execution.id, {
      status: "completed",
      completed_at: new Date(),
    });
    await repos.taskRepo.update(execution.task_id, { status: "DONE" });
    logger.info("Workflow completed for task {taskId}, execution {executionId}", {
      taskId: execution.task_id,
      executionId: execution.id,
    });
    return { taskStatus: "DONE", step: null };
  }

  if (transition.type === "paused") {
    await repos.taskRepo.update(execution.task_id, { status: "PAUSED" });
    logger.info("Workflow paused for task {taskId}, execution {executionId}", {
      taskId: execution.task_id,
      executionId: execution.id,
    });
    return { taskStatus: "PAUSED", step: null };
  }

  await repos.executionRepo.update(execution.id, {
    status: "failed",
    completed_at: new Date(),
  });
  await repos.taskRepo.update(execution.task_id, { status: "BLOCKED" });
  logger.warn("Workflow blocked for task {taskId}, execution {executionId}", {
    taskId: execution.task_id,
    executionId: execution.id,
  });
  return {
    taskStatus: "BLOCKED",
    step: null,
    error: { code: "max_retries_exceeded", message: "Workflow blocked after step failure" },
  };
};

const handleStepTransition = async (
  repos: TransactionRepositories,
  transition: StepTransitionResult,
  execution: Execution,
  client: Client,
  iterationContext: IterationContext,
  stepCommandGen: StepCommandGenerator,
): Promise<StepCompleteResponse> => {
  const nextStep = transition.step;

  const updatedVisitedSteps = buildUpdatedVisitedSteps(iterationContext.visitedSteps, nextStep.id);
  const newIteration = transition.shouldIncrementIteration
    ? iterationContext.iteration + 1
    : iterationContext.iteration;

  await repos.executionRepo.update(execution.id, {
    iteration: newIteration,
    visited_steps: JSON.stringify(updatedVisitedSteps),
  });

  const nextStepExecutionId = generateTypeId("step");
  const stepCommand = await stepCommandGen.generate(nextStep, nextStepExecutionId, 1, newIteration);

  await repos.stepExecutionRepo.create({
    id: nextStepExecutionId,
    client_id: client.id,
    execution_id: execution.id,
    step_id: nextStep.id,
    step_type: nextStep.type,
    prompt_template: nextStep.promptTemplate,
    status: "running",
  });

  logger.info(
    "Step transition for task {taskId}: {stepType} (iteration {iteration}, execution {executionId})",
    {
      taskId: execution.task_id,
      stepType: nextStep.type,
      iteration: newIteration,
      executionId: execution.id,
    },
  );

  return {
    taskStatus: "WORKING",
    step: stepCommand,
    execution: { id: execution.id, workflowId: execution.workflow_id },
  };
};
