import { join } from "node:path";
import type { StepCompleteResponse, TaskReadyResponse } from "@aop/common/protocol";
import { generateTypeId, getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { Execution, Task } from "../db/schema.ts";
import { createTemplateLoader } from "../prompts/template-loader.ts";
import { createStepCommandGenerator } from "../workflow-engine/step-command-generator.ts";
import type { WorkflowDefinition, WorkflowStep } from "../workflow-engine/types.ts";
import { loadWorkflowsFromDirectory } from "../workflow-engine/workflow-loader.ts";
import { parseWorkflow } from "../workflow-engine/workflow-parser.ts";
import {
  createWorkflowStateMachine,
  type TransitionResult,
  type WorkflowStateMachine,
} from "../workflow-engine/workflow-state-machine.ts";
import { syncWorkflows } from "./sync.ts";

const DEFAULT_WORKFLOW_NAME = "aop-default";
const logger = getLogger("local-workflow-service");
const WORKFLOWS_DIR = join(import.meta.dirname, "..", "..", "workflows");

interface CompleteStepInput {
  executionId: string;
  stepId: string;
  status: "success" | "failure";
  signal?: string;
  pauseContext?: string;
}

export interface LocalWorkflowService {
  listWorkflows: () => Promise<string[]>;
  startTask: (task: Task) => Promise<TaskReadyResponse>;
  completeStep: (task: Task, input: CompleteStepInput) => Promise<StepCompleteResponse>;
  resumeTask: (task: Task, stepId: string, input: string) => Promise<StepCompleteResponse>;
}

interface IterationContext {
  iteration: number;
  visitedSteps: string[];
}

interface LoadedExecutionContext {
  execution: Execution;
  stateMachine: WorkflowStateMachine;
  iteration: number;
  visitedSteps: string[];
  currentStepId: string;
}

interface PendingStepCompletion {
  ctxState: LoadedExecutionContext;
  transition: TransitionResult;
}

const parseVisitedSteps = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
};

const buildVisitedSteps = (current: string[], nextStepId: string): string[] =>
  current.includes(nextStepId)
    ? [...current.filter((stepId) => stepId !== nextStepId), nextStepId]
    : [...current, nextStepId];

const assertUnreachable = (_value: never): never => {
  throw new Error("Unexpected workflow transition");
};

export const createLocalWorkflowService = (ctx: LocalServerContext): LocalWorkflowService => {
  const templateLoader = createTemplateLoader();
  const stepCommandGenerator = createStepCommandGenerator(templateLoader);
  let syncPromise: Promise<void> | null = null;

  const ensureWorkflowsSynced = async (): Promise<void> => {
    if (!syncPromise) {
      syncPromise = (async () => {
        const workflows = await loadWorkflowsFromDirectory(WORKFLOWS_DIR);
        await syncWorkflows(ctx.workflowRepository, workflows);
      })();
    }

    await syncPromise;
  };

  const listPersistedWorkflowNames = async (): Promise<string[]> => {
    await ensureWorkflowsSynced();
    return ctx.workflowRepository.listNames();
  };

  const getDefaultWorkflowName = async (): Promise<string> => {
    const configured = await ctx.settingsRepository.get("default_workflow");
    return configured || DEFAULT_WORKFLOW_NAME;
  };

  const getWorkflow = async (workflowName: string): Promise<WorkflowDefinition> => {
    await ensureWorkflowsSynced();
    const workflow = await ctx.workflowRepository.findByName(workflowName);
    if (!workflow || !workflow.active) {
      throw new Error(`Workflow "${workflowName}" not found`);
    }

    return parseWorkflow(workflow.definition);
  };

  const resolveRetryStep = async (
    taskId: string,
    workflow: WorkflowDefinition,
    retryFromStep: string,
  ): Promise<{ step: WorkflowStep; visitedSteps: string[]; iteration: number }> => {
    const stateMachine = createWorkflowStateMachine(workflow);
    const step = stateMachine.getStep(retryFromStep);
    if (!step) {
      throw new Error(`Step "${retryFromStep}" not found in workflow "${workflow.name}"`);
    }

    const latestExecution = await ctx.executionRepository.getLatestExecutionByTaskId(taskId);
    if (!latestExecution) {
      return { step, visitedSteps: [retryFromStep], iteration: 0 };
    }

    const previousVisited = parseVisitedSteps(latestExecution.visited_steps);
    const index = previousVisited.indexOf(retryFromStep);
    const visitedSteps =
      index >= 0 ? previousVisited.slice(0, index + 1) : [...previousVisited, retryFromStep];

    return {
      step,
      visitedSteps: visitedSteps.length > 0 ? visitedSteps : [retryFromStep],
      iteration: latestExecution.iteration ?? 0,
    };
  };

  const createRunningStep = async (executionId: string, step: WorkflowStep, iteration: number) => {
    const stepExecutionId = generateTypeId("step");
    const stepCommand = await stepCommandGenerator.generate(step, stepExecutionId, 1, iteration);
    const now = new Date().toISOString();

    await ctx.executionRepository.createStepExecution({
      id: stepExecutionId,
      execution_id: executionId,
      step_id: step.id,
      step_type: step.type,
      status: "running",
      started_at: now,
      attempt: 1,
      iteration,
      signals_json: JSON.stringify(stepCommand.signals ?? []),
    });

    return stepCommand;
  };

  const isFinalizedStepStatus = (status: string): boolean =>
    status === "success" || status === "failure" || status === "awaiting_input";

  const getExistingTaskStatus = async (taskId: string): Promise<StepCompleteResponse> => {
    const latestTask = await ctx.taskRepository.get(taskId);
    return { taskStatus: latestTask?.status ?? "WORKING", step: null };
  };

  const loadExecutionContext = async (executionId: string): Promise<LoadedExecutionContext> => {
    const execution = await ctx.executionRepository.getExecution(executionId);
    if (!execution) {
      throw new Error(`Execution "${executionId}" not found`);
    }

    const workflow = await getWorkflow(execution.workflow_id);
    const stateMachine = createWorkflowStateMachine(workflow);
    const visitedSteps = parseVisitedSteps(execution.visited_steps);
    const currentStepId = visitedSteps.at(-1);
    if (!currentStepId) {
      throw new Error(`Execution "${executionId}" has no current step`);
    }

    return {
      execution,
      stateMachine,
      iteration: execution.iteration ?? 0,
      visitedSteps,
      currentStepId,
    };
  };

  const updateCompletedStep = async (
    input: CompleteStepInput,
    stepStatus: "success" | "failure" | "awaiting_input",
    pauseContext?: string,
  ): Promise<void> => {
    await ctx.executionRepository.updateStepExecution(input.stepId, {
      status: stepStatus,
      signal: input.signal ?? null,
      pause_context: pauseContext ?? null,
      ended_at: new Date().toISOString(),
    });
  };

  const completeAsDone = async (
    taskId: string,
    executionId: string,
  ): Promise<StepCompleteResponse> => {
    await ctx.executionRepository.updateExecution(executionId, {
      status: "completed",
      completed_at: new Date().toISOString(),
    });
    await ctx.taskRepository.update(taskId, { status: "DONE" });
    return { taskStatus: "DONE", step: null };
  };

  const completeAsPaused = async (taskId: string): Promise<StepCompleteResponse> => {
    await ctx.taskRepository.update(taskId, { status: "PAUSED" });
    return { taskStatus: "PAUSED", step: null };
  };

  const completeAsBlocked = async (
    taskId: string,
    executionId: string,
  ): Promise<StepCompleteResponse> => {
    await ctx.executionRepository.updateExecution(executionId, {
      status: "failed",
      completed_at: new Date().toISOString(),
    });
    await ctx.taskRepository.update(taskId, { status: "BLOCKED" });
    return {
      taskStatus: "BLOCKED",
      step: null,
      error: {
        code: "max_retries_exceeded",
        message: "Workflow blocked after step failure",
      },
    };
  };

  const continueWorkflow = async (
    task: Task,
    input: CompleteStepInput,
    execution: Execution,
    workflowId: string,
    visitedSteps: string[],
    iteration: number,
    nextStepId: string,
    nextStep: WorkflowStep,
    shouldIncrementIteration: boolean | undefined,
  ): Promise<StepCompleteResponse> => {
    const nextVisitedSteps = buildVisitedSteps(visitedSteps, nextStepId);
    const nextIteration = shouldIncrementIteration ? iteration + 1 : iteration;

    await ctx.executionRepository.updateExecution(input.executionId, {
      visited_steps: JSON.stringify(nextVisitedSteps),
      iteration: nextIteration,
    });

    const nextCommand = await createRunningStep(input.executionId, nextStep, nextIteration);
    await ctx.taskRepository.update(task.id, { status: "WORKING" });

    return {
      taskStatus: "WORKING",
      execution: { id: execution.id, workflowId },
      step: nextCommand,
    };
  };

  const prepareStepCompletion = async (
    task: Task,
    input: CompleteStepInput,
  ): Promise<StepCompleteResponse | PendingStepCompletion> => {
    const stepExecution = await ctx.executionRepository.getStepExecution(input.stepId);
    if (!stepExecution) {
      throw new Error(`Step execution "${input.stepId}" not found`);
    }

    if (isFinalizedStepStatus(stepExecution.status)) {
      return getExistingTaskStatus(task.id);
    }

    const ctxState = await loadExecutionContext(input.executionId);
    const transition = ctxState.stateMachine.evaluateTransition(
      ctxState.currentStepId,
      { status: input.status, signal: input.signal },
      {
        iteration: ctxState.iteration,
        visitedSteps: ctxState.visitedSteps,
      } satisfies IterationContext,
    );

    await updateCompletedStep(
      input,
      transition.type === "paused" ? "awaiting_input" : input.status,
      transition.type === "paused" ? input.pauseContext : undefined,
    );

    return { ctxState, transition };
  };

  const handleTransitionResult = async (
    task: Task,
    input: CompleteStepInput,
    completion: PendingStepCompletion,
  ): Promise<StepCompleteResponse> => {
    switch (completion.transition.type) {
      case "done":
        return completeAsDone(task.id, input.executionId);
      case "paused":
        return completeAsPaused(task.id);
      case "blocked":
        return completeAsBlocked(task.id, input.executionId);
      case "step":
        return continueWorkflow(
          task,
          input,
          completion.ctxState.execution,
          completion.ctxState.execution.workflow_id,
          completion.ctxState.visitedSteps,
          completion.ctxState.iteration,
          completion.transition.stepId,
          completion.transition.step,
          completion.transition.shouldIncrementIteration,
        );
    }

    return assertUnreachable(completion.transition);
  };

  return {
    listWorkflows: async () => {
      return listPersistedWorkflowNames();
    },

    startTask: async (task) => {
      const workflowName = task.preferred_workflow ?? (await getDefaultWorkflowName());
      const workflow = await getWorkflow(workflowName);
      const stateMachine = createWorkflowStateMachine(workflow);

      const start = task.retry_from_step
        ? await resolveRetryStep(task.id, workflow, task.retry_from_step)
        : {
            step: stateMachine.getInitialStep(),
            visitedSteps: [stateMachine.getInitialStep().id],
            iteration: 0,
          };

      const executionId = generateTypeId("exec");
      const now = new Date().toISOString();
      await ctx.executionRepository.createExecution({
        id: executionId,
        task_id: task.id,
        workflow_id: workflow.name,
        status: "running",
        visited_steps: JSON.stringify(start.visitedSteps),
        iteration: start.iteration,
        started_at: now,
      });

      const stepCommand = await createRunningStep(executionId, start.step, start.iteration);

      logger.info("Started local workflow {workflow} for task {taskId}", {
        workflow: workflow.name,
        taskId: task.id,
        stepId: start.step.id,
      });

      return {
        status: "WORKING",
        execution: { id: executionId, workflowId: workflow.name },
        step: stepCommand,
      };
    },

    completeStep: async (task, input) => {
      const completion = await prepareStepCompletion(task, input);
      if ("taskStatus" in completion) {
        return completion;
      }
      return handleTransitionResult(task, input, completion);
    },

    resumeTask: async (task, stepId, input) => {
      const stepExecution = await ctx.executionRepository.getStepExecution(stepId);
      if (!stepExecution) {
        throw new Error(`Step execution "${stepId}" not found`);
      }
      if (stepExecution.status !== "awaiting_input") {
        throw new Error(`Step "${stepId}" is not awaiting input`);
      }

      const ctxState = await loadExecutionContext(stepExecution.execution_id);
      const currentStep = ctxState.stateMachine.getStep(ctxState.currentStepId);
      if (!currentStep) {
        throw new Error(`Step "${ctxState.currentStepId}" not found`);
      }

      const resumedCommand = await createRunningStep(
        stepExecution.execution_id,
        currentStep,
        ctxState.iteration,
      );
      resumedCommand.input = input;

      await ctx.taskRepository.update(task.id, {
        status: "WORKING",
        resume_input: null,
      });

      return {
        taskStatus: "WORKING",
        execution: {
          id: ctxState.execution.id,
          workflowId: ctxState.execution.workflow_id,
        },
        step: resumedCommand,
      };
    },
  };
};
