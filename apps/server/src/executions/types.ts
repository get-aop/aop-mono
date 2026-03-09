import type { createTaskRepository } from "../tasks/task-repository.ts";
import type { createWorkflowRepository } from "../workflow/workflow-repository.ts";
import type { createExecutionRepository } from "./execution-repository.ts";
import type { createStepExecutionRepository } from "./step-execution-repository.ts";

export interface TransactionRepositories {
  stepExecutionRepo: ReturnType<typeof createStepExecutionRepository>;
  executionRepo: ReturnType<typeof createExecutionRepository>;
  taskRepo: ReturnType<typeof createTaskRepository>;
  workflowRepo: ReturnType<typeof createWorkflowRepository>;
}

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
