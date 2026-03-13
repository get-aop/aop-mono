import type { StepCommand, TaskStatus } from "@aop/common/protocol";
import { getLogger } from "@aop/infra";
import type { ExecutionRepository } from "../executor/execution-repository.ts";
import type { TaskRepository } from "../task/repository.ts";

const logger = getLogger("orchestrator-launch-failure");

interface FinalizeLaunchFailureDeps {
  executionRepository: ExecutionRepository;
  taskRepository: Pick<TaskRepository, "update">;
  taskId: string;
  stepExecutionId: StepCommand["id"];
  executionId: string;
  revertStatus: TaskStatus;
  error: unknown;
}

export const finalizeLaunchFailure = async ({
  executionRepository,
  taskRepository,
  taskId,
  stepExecutionId,
  executionId,
  revertStatus,
  error,
}: FinalizeLaunchFailureDeps): Promise<void> => {
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);

  await executionRepository.updateStepExecution(stepExecutionId, {
    status: "failure",
    error: message,
    ended_at: now,
  });
  await executionRepository.updateExecution(executionId, {
    status: "failed",
    completed_at: now,
  });
  await taskRepository.update(taskId, { status: revertStatus });

  logger.info("Finalized failed launch and reverted task", {
    taskId,
    executionId,
    stepExecutionId,
    revertStatus,
    error: message,
  });
};
