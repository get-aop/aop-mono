import { getLogger } from "../../infra/logger";
import type { OrchestratorState, Subtask } from "../../types";
import type { AgentRegistry } from "../interfaces/agent-registry";
import type { JobQueue } from "../interfaces/job-queue";
import type { Job, JobType } from "../types/job";
import { getJobKey, JOB_PRIORITY } from "../types/job";

const log = getLogger("job-producer");

export class JobProducer {
  constructor(
    private queue: JobQueue,
    private registry: AgentRegistry
  ) {}

  async produceFromState(state: OrchestratorState): Promise<void> {
    log.debug(`Producing from state: ${state.tasks.length} tasks`);
    await this.processSubtasks(state);
    await this.processPlans(state);
  }

  private async processSubtasks(state: OrchestratorState): Promise<void> {
    for (const task of state.tasks) {
      if (task.frontmatter.status !== "INPROGRESS") continue;

      const subtasks = state.subtasks[task.folder] ?? [];
      for (const subtask of subtasks) {
        await this.processSubtask(task.folder, subtask, subtasks);
      }
    }
  }

  private async processSubtask(
    taskFolder: string,
    subtask: Subtask,
    allSubtasks: Subtask[]
  ): Promise<void> {
    const { status } = subtask.frontmatter;
    const { filename } = subtask;

    log.debug(`Processing subtask ${filename} with status ${status}`);

    switch (status) {
      case "PENDING":
        if (!this.areDependenciesSatisfied(subtask, allSubtasks)) {
          log.debug(`Subtask ${filename} dependencies not satisfied`);
          return;
        }
        log.info(`Enqueueing implementation job for ${filename}`);
        await this.enqueueSubtaskJob("implementation", taskFolder, filename);
        break;
      case "INPROGRESS":
        if (
          await this.hasRunningAgent(taskFolder, filename, "implementation")
        ) {
          log.debug(`Subtask ${filename} already has running agent`);
          return;
        }
        log.info(`Enqueueing implementation job for INPROGRESS ${filename}`);
        await this.enqueueSubtaskJob("implementation", taskFolder, filename);
        break;
      case "AGENT_REVIEW":
        if (await this.hasRunningAgent(taskFolder, filename, "review")) return;
        await this.enqueueSubtaskJob("review", taskFolder, filename);
        break;
      case "PENDING_MERGE":
        await this.enqueueSubtaskJob("merge", taskFolder, filename);
        break;
      case "MERGE_CONFLICT":
        if (await this.hasRunningAgent(taskFolder, filename, "conflict-solver"))
          return;
        await this.enqueueSubtaskJob("conflict-solver", taskFolder, filename);
        break;
    }
  }

  private async processPlans(state: OrchestratorState): Promise<void> {
    for (const task of state.tasks) {
      if (task.frontmatter.status !== "INPROGRESS") continue;

      const plan = state.plans[task.folder];
      if (!plan) continue;

      const subtasks = state.subtasks[task.folder] ?? [];

      if (plan.frontmatter.status === "AGENT_REVIEW") {
        if (await this.hasRunningTaskAgent(task.folder, "completion-review"))
          continue;
        await this.enqueueTaskJob("completion-review", task.folder);
      } else if (plan.frontmatter.status === "INPROGRESS") {
        const allDone =
          subtasks.length > 0 &&
          subtasks.every((s) => s.frontmatter.status === "DONE");
        if (!allDone) continue;
        if (await this.hasRunningTaskAgent(task.folder, "completing-task"))
          continue;
        await this.enqueueTaskJob("completing-task", task.folder);
      }
    }
  }

  private async enqueueSubtaskJob(
    type: JobType,
    taskFolder: string,
    subtaskFile: string
  ): Promise<void> {
    await this.enqueueIfNew({
      id: crypto.randomUUID(),
      type,
      taskFolder,
      subtaskFile,
      status: "pending",
      priority: JOB_PRIORITY[type],
      createdAt: new Date()
    });
  }

  private async enqueueTaskJob(
    type: JobType,
    taskFolder: string
  ): Promise<void> {
    await this.enqueueIfNew({
      id: crypto.randomUUID(),
      type,
      taskFolder,
      status: "pending",
      priority: JOB_PRIORITY[type],
      createdAt: new Date()
    });
  }

  private async enqueueIfNew(job: Job): Promise<void> {
    const key = getJobKey(job);
    if (await this.queue.has(key)) {
      log.debug(`Job ${key} already in queue`);
      return;
    }
    log.info(
      `Enqueued job: ${job.type} for ${job.taskFolder}/${job.subtaskFile ?? "task"}`
    );
    await this.queue.enqueue(job);
  }

  private async hasRunningAgent(
    taskFolder: string,
    subtaskFile: string,
    type: string
  ): Promise<boolean> {
    const agent = await this.registry.getBySubtask(taskFolder, subtaskFile);
    return agent !== undefined && agent.type === type;
  }

  private async hasRunningTaskAgent(
    taskFolder: string,
    type: string
  ): Promise<boolean> {
    const agents = await this.registry.getByTask(taskFolder);
    return agents.some((a) => a.type === type && !a.subtaskFile);
  }

  private areDependenciesSatisfied(
    subtask: Subtask,
    allSubtasks: Subtask[]
  ): boolean {
    if (subtask.frontmatter.dependencies.length === 0) return true;

    const doneNumbers = new Set(
      allSubtasks
        .filter((s) => s.frontmatter.status === "DONE")
        .map((s) => s.number)
    );

    return subtask.frontmatter.dependencies.every((dep) =>
      doneNumbers.has(dep)
    );
  }
}
