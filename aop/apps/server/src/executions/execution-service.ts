import type { StepCompleteResponse, TaskReadyResponse, TaskStatus } from "@aop/common/protocol";
import { generateTypeId, getLogger } from "@aop/infra";
import type { Kysely } from "kysely";
import type { Client, Database, Execution, StepExecution } from "../db/schema.ts";
import { createTemplateLoader } from "../prompts/template-loader.ts";
import { createRepoRepository } from "../repos/repo-repository.ts";
import { createTaskRepository } from "../tasks/task-repository.ts";
import { createStepCommandGenerator } from "../workflow/step-command-generator.ts";
import type { WorkflowStep } from "../workflow/types.ts";
import { parseWorkflow } from "../workflow/workflow-parser.ts";
import { createWorkflowRepository } from "../workflow/workflow-repository.ts";
import type {
  IterationContext,
  StepResult,
  StepTransitionResult,
  TerminalTransitionResult,
  TransitionResult,
  WorkflowStateMachine,
} from "../workflow/workflow-state-machine.ts";
import { createWorkflowStateMachine } from "../workflow/workflow-state-machine.ts";
import { createExecutionRepository } from "./execution-repository.ts";
import { createStepExecutionRepository } from "./step-execution-repository.ts";

const DEFAULT_WORKFLOW_NAME = "aop-default";
const logger = getLogger("execution-service");

const parseVisitedSteps = (visitedSteps: string): string[] => {
  try {
    const parsed = JSON.parse(visitedSteps);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const buildIterationContext = (execution: Execution): IterationContext => ({
  iteration: execution.iteration,
  visitedSteps: parseVisitedSteps(execution.visited_steps),
});

export interface ProcessStepResultInput {
  stepId: string;
  executionId: string;
  attempt: number;
  status: "success" | "failure";
  signal?: string;
  errorCode?: string;
  durationMs: number;
  pauseContext?: string;
}

export interface ResumeStepInput {
  stepId: string;
  input: string;
}

export interface ExecutionService {
  checkConcurrency: (clientId: string, maxConcurrent: number) => Promise<boolean>;
  startWorkflow: (
    client: Client,
    taskId: string,
    repoId: string,
    workflowName?: string,
    retryFromStep?: string,
  ) => Promise<TaskReadyResponse>;
  processStepResult: (
    client: Client,
    input: ProcessStepResultInput,
  ) => Promise<StepCompleteResponse>;
  resumeStep: (client: Client, input: ResumeStepInput) => Promise<StepCompleteResponse>;
}

interface TransactionRepositories {
  stepExecutionRepo: ReturnType<typeof createStepExecutionRepository>;
  executionRepo: ReturnType<typeof createExecutionRepository>;
  taskRepo: ReturnType<typeof createTaskRepository>;
  workflowRepo: ReturnType<typeof createWorkflowRepository>;
}

export const createExecutionService = (db: Kysely<Database>): ExecutionService => {
  const taskRepo = createTaskRepository(db);
  const workflowRepo = createWorkflowRepository(db);
  const templateLoader = createTemplateLoader();
  const stepCommandGen = createStepCommandGenerator(templateLoader);

  const checkConcurrency = async (clientId: string, maxConcurrent: number): Promise<boolean> => {
    const workingCount = await taskRepo.countWorkingByClient(clientId);
    return workingCount < maxConcurrent;
  };

  interface StartContext {
    targetStep: WorkflowStep;
    visitedSteps: string[];
    iteration: number;
  }

  const resolveRetryContext = async (
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
      stepIndex >= 0
        ? previousVisited.slice(0, stepIndex + 1)
        : [...previousVisited, retryFromStep];

    return { targetStep: step, visitedSteps, iteration: previousExecution.iteration };
  };

  const startWorkflow = async (
    client: Client,
    taskId: string,
    repoId: string,
    workflowName?: string,
    retryFromStep?: string,
  ): Promise<TaskReadyResponse> => {
    const hasCapacity = await checkConcurrency(client.id, client.max_concurrent_tasks);
    if (!hasCapacity) {
      return { status: "READY", queued: true, message: "Task queued, at max concurrent tasks" };
    }

    const targetWorkflowName = workflowName ?? DEFAULT_WORKFLOW_NAME;
    const workflow = await workflowRepo.findByName(targetWorkflowName);
    if (!workflow) {
      throw new Error(`Workflow "${targetWorkflowName}" not found`);
    }

    const workflowDef = parseWorkflow(workflow.definition);
    const stateMachine = createWorkflowStateMachine(workflowDef);

    const initialStep = stateMachine.getInitialStep();
    const { targetStep, visitedSteps, iteration } = retryFromStep
      ? await resolveRetryContext(stateMachine, taskId, retryFromStep, targetWorkflowName)
      : { targetStep: initialStep, visitedSteps: [initialStep.id], iteration: 0 };

    const executionId = generateTypeId("exec");
    const stepExecutionId = generateTypeId("step");
    const stepCommand = await stepCommandGen.generate(targetStep, stepExecutionId, 1, iteration);

    await db.transaction().execute(async (trx) => {
      const repoRepoTrx = createRepoRepository(trx);
      const taskRepoTrx = createTaskRepository(trx);
      const executionRepoTrx = createExecutionRepository(trx);
      const stepExecutionRepoTrx = createStepExecutionRepository(trx);

      await repoRepoTrx.upsert({
        id: repoId,
        client_id: client.id,
        synced_at: new Date(),
      });

      const cancelledExecution = await executionRepoTrx.cancelActiveByTask(taskId);
      if (cancelledExecution) {
        const cancelledSteps = await stepExecutionRepoTrx.cancelRunningByExecution(
          cancelledExecution.id,
        );
        logger.info(
          "Cancelled stale execution {executionId} with {stepCount} running steps for task {taskId}",
          {
            executionId: cancelledExecution.id,
            stepCount: cancelledSteps,
            taskId,
          },
        );
      }

      await taskRepoTrx.upsert({
        id: taskId,
        client_id: client.id,
        repo_id: repoId,
        status: "WORKING",
        synced_at: new Date(),
      });

      await executionRepoTrx.create({
        id: executionId,
        client_id: client.id,
        task_id: taskId,
        workflow_id: workflow.id,
        status: "running",
        visited_steps: JSON.stringify(visitedSteps),
        iteration,
      });

      await stepExecutionRepoTrx.create({
        id: stepExecutionId,
        client_id: client.id,
        execution_id: executionId,
        step_id: targetStep.id,
        step_type: targetStep.type,
        prompt_template: targetStep.promptTemplate,
        status: "running",
      });
    });

    logger.info("Workflow started for task {taskId}: execution {executionId}, step {stepType}", {
      taskId,
      executionId,
      stepType: targetStep.type,
      workflowName: targetWorkflowName,
      retryFromStep,
    });

    return {
      status: "WORKING",
      execution: { id: executionId, workflowId: workflow.id },
      step: stepCommand,
    };
  };

  const processStepResult = async (
    client: Client,
    input: ProcessStepResultInput,
  ): Promise<StepCompleteResponse> => {
    return db.transaction().execute(async (trx) => {
      const repos = createTransactionRepositories(trx);
      const lockedStep = await validateAndLockStep(repos, input.stepId, client.id);

      if (
        lockedStep.status === "success" ||
        lockedStep.status === "failure" ||
        lockedStep.status === "awaiting_input"
      ) {
        return buildIdempotentResponse(repos, lockedStep);
      }

      return processStep(repos, client, input);
    });
  };

  const createTransactionRepositories = (trx: Kysely<Database>): TransactionRepositories => ({
    stepExecutionRepo: createStepExecutionRepository(trx),
    executionRepo: createExecutionRepository(trx),
    taskRepo: createTaskRepository(trx),
    workflowRepo: createWorkflowRepository(trx),
  });

  const validateAndLockStep = async (
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

  const buildIdempotentResponse = async (
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

  interface WorkflowContext {
    execution: Execution;
    stateMachine: WorkflowStateMachine;
    iterationContext: IterationContext;
    currentStepId: string;
  }

  const resolveWorkflowContext = async (
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

  const processStep = async (
    repos: TransactionRepositories,
    client: Client,
    input: ProcessStepResultInput,
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

    return handleTransition(repos, transition, ctx.execution, client, ctx.iterationContext);
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
  ): Promise<StepCompleteResponse> => {
    const nextStep = transition.step;

    // Always place the next step at the end so .at(-1) correctly tracks the current step.
    // When looping back to a visited step, move it to the end rather than leaving it in place.
    const updatedVisitedSteps = iterationContext.visitedSteps.includes(nextStep.id)
      ? [...iterationContext.visitedSteps.filter((s) => s !== nextStep.id), nextStep.id]
      : [...iterationContext.visitedSteps, nextStep.id];
    const newIteration = transition.shouldIncrementIteration
      ? iterationContext.iteration + 1
      : iterationContext.iteration;

    await repos.executionRepo.update(execution.id, {
      iteration: newIteration,
      visited_steps: JSON.stringify(updatedVisitedSteps),
    });

    const nextStepExecutionId = generateTypeId("step");
    const stepCommand = await stepCommandGen.generate(
      nextStep,
      nextStepExecutionId,
      1,
      newIteration,
    );

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

  const handleTransition = async (
    repos: TransactionRepositories,
    transition: TransitionResult,
    execution: Execution,
    client: Client,
    iterationContext: IterationContext,
  ): Promise<StepCompleteResponse> => {
    if (transition.type !== "step") {
      return handleTerminalTransition(repos, transition, execution);
    }
    return handleStepTransition(repos, transition, execution, client, iterationContext);
  };

  const validatePausedStep = async (
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

  const resumeStep = async (
    client: Client,
    input: ResumeStepInput,
  ): Promise<StepCompleteResponse> => {
    return db.transaction().execute(async (trx) => {
      const repos = createTransactionRepositories(trx);
      const pausedStep = await validatePausedStep(repos, input.stepId, client.id);
      const ctx = await resolveWorkflowContext(repos, pausedStep.execution_id);

      const currentStep = ctx.stateMachine.getStep(ctx.currentStepId);
      if (!currentStep) {
        throw new Error(`Step "${ctx.currentStepId}" not found in workflow`);
      }

      const newStepExecutionId = generateTypeId("step");
      const stepCommand = await stepCommandGen.generate(
        currentStep,
        newStepExecutionId,
        1,
        ctx.iterationContext.iteration,
      );
      stepCommand.input = input.input;

      await repos.stepExecutionRepo.create({
        id: newStepExecutionId,
        client_id: client.id,
        execution_id: ctx.execution.id,
        step_id: currentStep.id,
        step_type: currentStep.type,
        prompt_template: currentStep.promptTemplate,
        status: "running",
      });

      await repos.taskRepo.update(ctx.execution.task_id, { status: "WORKING" });

      logger.info("Resumed step for task {taskId}: {stepType} (execution {executionId})", {
        taskId: ctx.execution.task_id,
        stepType: currentStep.type,
        executionId: ctx.execution.id,
      });

      return {
        taskStatus: "WORKING",
        step: stepCommand,
        execution: { id: ctx.execution.id, workflowId: ctx.execution.workflow_id },
      };
    });
  };

  return { checkConcurrency, startWorkflow, processStepResult, resumeStep };
};
