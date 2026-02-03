import type { StepCompleteResponse, TaskReadyResponse, TaskStatus } from "@aop/common/protocol";
import { generateTypeId } from "@aop/infra";
import type { Kysely } from "kysely";
import type { Client, Database, Execution, StepExecution } from "../db/schema.ts";
import { createTemplateLoader } from "../prompts/template-loader.ts";
import { createRepoRepository } from "../repos/repo-repository.ts";
import { createTaskRepository } from "../tasks/task-repository.ts";
import { createStepCommandGenerator } from "../workflow/step-command-generator.ts";
import { parseWorkflow } from "../workflow/workflow-parser.ts";
import { createWorkflowRepository } from "../workflow/workflow-repository.ts";
import type { StepResult, TransitionResult } from "../workflow/workflow-state-machine.ts";
import { createWorkflowStateMachine } from "../workflow/workflow-state-machine.ts";
import { createExecutionRepository } from "./execution-repository.ts";
import { createStepExecutionRepository } from "./step-execution-repository.ts";

const DEFAULT_WORKFLOW_NAME = "simple";

export interface ProcessStepResultInput {
  stepId: string;
  executionId: string;
  attempt: number;
  status: "success" | "failure";
  signal?: string;
  errorCode?: string;
  durationMs: number;
}

export interface ExecutionService {
  checkConcurrency: (clientId: string, maxConcurrent: number) => Promise<boolean>;
  startWorkflow: (
    client: Client,
    taskId: string,
    repoId: string,
    workflowName?: string,
  ) => Promise<TaskReadyResponse>;
  processStepResult: (
    client: Client,
    input: ProcessStepResultInput,
  ) => Promise<StepCompleteResponse>;
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

  const startWorkflow = async (
    client: Client,
    taskId: string,
    repoId: string,
    workflowName?: string,
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

    const executionId = generateTypeId("exec");
    const stepExecutionId = generateTypeId("step");
    const stepCommand = await stepCommandGen.generate(initialStep, stepExecutionId, 1);

    await db.transaction().execute(async (trx) => {
      const repoRepoTrx = createRepoRepository(trx);
      const taskRepoTrx = createTaskRepository(trx);
      const executionRepoTrx = createExecutionRepository(trx);
      const stepExecutionRepoTrx = createStepExecutionRepository(trx);

      // Ensure repo exists before creating task
      await repoRepoTrx.upsert({
        id: repoId,
        client_id: client.id,
        synced_at: new Date(),
      });

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
      });

      await stepExecutionRepoTrx.create({
        id: stepExecutionId,
        client_id: client.id,
        execution_id: executionId,
        step_type: initialStep.type,
        prompt_template: initialStep.promptTemplate,
        status: "running",
      });
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

      if (lockedStep.status === "success" || lockedStep.status === "failure") {
        return buildIdempotentResponse(repos, lockedStep);
      }

      return processStep(repos, client, input, lockedStep);
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

  const processStep = async (
    repos: TransactionRepositories,
    client: Client,
    input: ProcessStepResultInput,
    lockedStep: StepExecution,
  ): Promise<StepCompleteResponse> => {
    const execution = await repos.executionRepo.findById(input.executionId);
    if (!execution) {
      throw new Error(`Execution "${input.executionId}" not found`);
    }

    const workflow = await repos.workflowRepo.findById(execution.workflow_id);
    if (!workflow) {
      throw new Error(`Workflow "${execution.workflow_id}" not found`);
    }

    const workflowDef = parseWorkflow(workflow.definition);
    const stateMachine = createWorkflowStateMachine(workflowDef);
    const stepResult: StepResult = { status: input.status, signal: input.signal };
    const transition = stateMachine.evaluateTransition(lockedStep.step_type, stepResult);

    await repos.stepExecutionRepo.update(input.stepId, {
      status: input.status === "success" ? "success" : "failure",
      error_code: input.errorCode ?? null,
      signal: input.signal ?? null,
      ended_at: new Date(),
    });

    return handleTransition(repos, transition, execution, client);
  };

  const handleTransition = async (
    repos: TransactionRepositories,
    transition: TransitionResult,
    execution: Execution,
    client: Client,
  ): Promise<StepCompleteResponse> => {
    if (transition.type === "done") {
      await repos.executionRepo.update(execution.id, {
        status: "completed",
        completed_at: new Date(),
      });
      await repos.taskRepo.update(execution.task_id, { status: "DONE" });
      return { taskStatus: "DONE", step: null };
    }

    if (transition.type === "blocked") {
      await repos.executionRepo.update(execution.id, {
        status: "failed",
        completed_at: new Date(),
      });
      await repos.taskRepo.update(execution.task_id, { status: "BLOCKED" });
      return {
        taskStatus: "BLOCKED",
        step: null,
        error: { code: "max_retries_exceeded", message: "Workflow blocked after step failure" },
      };
    }

    const nextStepExecutionId = generateTypeId("step");
    const nextStep = transition.step;
    if (!nextStep) {
      throw new Error("Expected next step in transition but none provided");
    }

    const stepCommand = await stepCommandGen.generate(nextStep, nextStepExecutionId, 1);

    await repos.stepExecutionRepo.create({
      id: nextStepExecutionId,
      client_id: client.id,
      execution_id: execution.id,
      step_type: nextStep.type,
      prompt_template: nextStep.promptTemplate,
      status: "running",
    });

    return {
      taskStatus: "WORKING",
      step: stepCommand,
      execution: { id: execution.id, workflowId: execution.workflow_id },
    };
  };

  return { checkConcurrency, startWorkflow, processStepResult };
};
