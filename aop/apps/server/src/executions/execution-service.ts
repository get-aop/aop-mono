import type { StepCompleteResponse, TaskReadyResponse } from "@aop/common/protocol";
import { generateTypeId, getLogger } from "@aop/infra";
import type { Kysely } from "kysely";
import type { Client, Database } from "../db/schema.ts";
import { createTemplateLoader } from "../prompts/template-loader.ts";
import { createRepoRepository } from "../repos/repo-repository.ts";
import { createTaskRepository } from "../tasks/task-repository.ts";
import { createStepCommandGenerator } from "../workflow/step-command-generator.ts";
import { parseWorkflow } from "../workflow/workflow-parser.ts";
import { createWorkflowRepository } from "../workflow/workflow-repository.ts";
import { createWorkflowStateMachine } from "../workflow/workflow-state-machine.ts";
import { createExecutionRepository } from "./execution-repository.ts";
import { resolveRetryContext, resolveWorkflowContext } from "./iteration-tracker.ts";
import { createStepExecutionRepository } from "./step-execution-repository.ts";
import {
  buildIdempotentResponse,
  processStep,
  validateAndLockStep,
  validatePausedStep,
} from "./step-processor.ts";
import type { ProcessStepResultInput, ResumeStepInput, TransactionRepositories } from "./types.ts";

const DEFAULT_WORKFLOW_NAME = "aop-default";
const logger = getLogger("execution-service");

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

export const createExecutionService = (db: Kysely<Database>): ExecutionService => {
  const taskRepo = createTaskRepository(db);
  const workflowRepo = createWorkflowRepository(db);
  const templateLoader = createTemplateLoader();
  const stepCommandGen = createStepCommandGenerator(templateLoader);

  const createTransactionRepos = (trx: Kysely<Database>): TransactionRepositories => ({
    stepExecutionRepo: createStepExecutionRepository(trx),
    executionRepo: createExecutionRepository(trx),
    taskRepo: createTaskRepository(trx),
    workflowRepo: createWorkflowRepository(trx),
  });

  const checkConcurrency = async (clientId: string, maxConcurrent: number): Promise<boolean> => {
    const workingCount = await taskRepo.countWorkingByClient(clientId);
    return workingCount < maxConcurrent;
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
      ? await resolveRetryContext(db, stateMachine, taskId, retryFromStep, targetWorkflowName)
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

  const handleProcessStepResult = async (
    client: Client,
    input: ProcessStepResultInput,
  ): Promise<StepCompleteResponse> => {
    return db.transaction().execute(async (trx) => {
      const repos = createTransactionRepos(trx);
      const lockedStep = await validateAndLockStep(repos, input.stepId, client.id);

      if (
        lockedStep.status === "success" ||
        lockedStep.status === "failure" ||
        lockedStep.status === "awaiting_input"
      ) {
        return buildIdempotentResponse(repos, lockedStep);
      }

      return processStep(repos, client, input, stepCommandGen);
    });
  };

  const resumeStep = async (
    client: Client,
    input: ResumeStepInput,
  ): Promise<StepCompleteResponse> => {
    return db.transaction().execute(async (trx) => {
      const repos = createTransactionRepos(trx);
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

  return {
    checkConcurrency,
    startWorkflow,
    processStepResult: handleProcessStepResult,
    resumeStep,
  };
};
