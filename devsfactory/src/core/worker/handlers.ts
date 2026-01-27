import { join } from "node:path";
import type { AgentType, SubtaskStatus } from "../../types";
import type { MergeResult } from "../git";
import type { AgentRegistry, RunningAgent } from "../interfaces/agent-registry";
import type { Job, JobResult, JobType } from "../types/job";

export interface SpawnResult {
  pid: number;
  exitCode: number;
}

export interface HandlerContext {
  registry: AgentRegistry;
  worktreesDir: string;
  spawnAgent: (options: {
    type: AgentType;
    taskFolder: string;
    subtaskFile?: string;
    cwd: string;
  }) => Promise<SpawnResult>;
  mergeSubtask: (
    taskFolder: string,
    subtaskSlug: string
  ) => Promise<MergeResult>;
  deleteWorktree: (worktreePath: string) => Promise<void>;
  updateSubtaskStatus: (
    taskFolder: string,
    subtaskFile: string,
    status: SubtaskStatus
  ) => Promise<void>;
}

export interface JobHandler {
  execute(job: Job): Promise<JobResult>;
}

const extractSubtaskSlug = (subtaskFile: string): string => {
  const match = subtaskFile.match(/^\d{3}-(.+)\.md$/);
  return match ? match[1]! : subtaskFile.replace(/\.md$/, "");
};

const getSubtaskWorktreePath = (
  worktreesDir: string,
  taskFolder: string,
  subtaskSlug: string
): string => join(worktreesDir, `${taskFolder}--${subtaskSlug}`);

const getTaskWorktreePath = (
  worktreesDir: string,
  taskFolder: string
): string => join(worktreesDir, taskFolder);

abstract class BaseAgentHandler implements JobHandler {
  constructor(protected ctx: HandlerContext) {}

  abstract getAgentType(): AgentType;
  abstract getCwd(job: Job): string;

  async execute(job: Job): Promise<JobResult> {
    const agent: RunningAgent = {
      jobId: job.id,
      type: this.getAgentType(),
      taskFolder: job.taskFolder,
      subtaskFile: job.subtaskFile,
      pid: 0,
      startedAt: new Date()
    };

    await this.ctx.registry.register(agent);

    try {
      const result = await this.ctx.spawnAgent({
        type: this.getAgentType(),
        taskFolder: job.taskFolder,
        subtaskFile: job.subtaskFile,
        cwd: this.getCwd(job)
      });

      agent.pid = result.pid;

      if (result.exitCode === 0) {
        return { jobId: job.id, success: true };
      }
      return {
        jobId: job.id,
        success: false,
        error: `Agent exited with code ${result.exitCode}`
      };
    } finally {
      await this.ctx.registry.unregister(job.id);
    }
  }
}

export class ImplementationHandler extends BaseAgentHandler {
  getAgentType(): AgentType {
    return "implementation";
  }

  getCwd(job: Job): string {
    const slug = extractSubtaskSlug(job.subtaskFile!);
    return getSubtaskWorktreePath(this.ctx.worktreesDir, job.taskFolder, slug);
  }
}

export class ReviewHandler extends BaseAgentHandler {
  getAgentType(): AgentType {
    return "review";
  }

  getCwd(job: Job): string {
    const slug = extractSubtaskSlug(job.subtaskFile!);
    return getSubtaskWorktreePath(this.ctx.worktreesDir, job.taskFolder, slug);
  }
}

export class MergeHandler implements JobHandler {
  constructor(private ctx: HandlerContext) {}

  async execute(job: Job): Promise<JobResult> {
    const subtaskSlug = extractSubtaskSlug(job.subtaskFile!);
    const result = await this.ctx.mergeSubtask(job.taskFolder, subtaskSlug);

    if (result.success) {
      const worktreePath = getSubtaskWorktreePath(
        this.ctx.worktreesDir,
        job.taskFolder,
        subtaskSlug
      );
      await this.ctx.deleteWorktree(worktreePath);
      await this.ctx.updateSubtaskStatus(
        job.taskFolder,
        job.subtaskFile!,
        "DONE"
      );
      return { jobId: job.id, success: true };
    }

    if (result.hasConflict) {
      await this.ctx.updateSubtaskStatus(
        job.taskFolder,
        job.subtaskFile!,
        "MERGE_CONFLICT"
      );
      return {
        jobId: job.id,
        success: false,
        error: result.error,
        requeue: false
      };
    }

    return { jobId: job.id, success: false, error: result.error };
  }
}

export class CompletingTaskHandler extends BaseAgentHandler {
  getAgentType(): AgentType {
    return "completing-task";
  }

  getCwd(job: Job): string {
    return getTaskWorktreePath(this.ctx.worktreesDir, job.taskFolder);
  }
}

export class CompletionReviewHandler extends BaseAgentHandler {
  getAgentType(): AgentType {
    return "completion-review";
  }

  getCwd(job: Job): string {
    return getTaskWorktreePath(this.ctx.worktreesDir, job.taskFolder);
  }
}

export class ConflictSolverHandler extends BaseAgentHandler {
  getAgentType(): AgentType {
    return "conflict-solver";
  }

  getCwd(job: Job): string {
    return getTaskWorktreePath(this.ctx.worktreesDir, job.taskFolder);
  }

  override async execute(job: Job): Promise<JobResult> {
    const result = await super.execute(job);

    if (result.success && job.subtaskFile) {
      const subtaskSlug = extractSubtaskSlug(job.subtaskFile);
      const worktreePath = getSubtaskWorktreePath(
        this.ctx.worktreesDir,
        job.taskFolder,
        subtaskSlug
      );
      await this.ctx.deleteWorktree(worktreePath);
      await this.ctx.updateSubtaskStatus(
        job.taskFolder,
        job.subtaskFile,
        "DONE"
      );
    }

    return result;
  }
}

export interface HandlerRegistry {
  get(type: JobType): JobHandler | undefined;
}

export const createHandlerRegistry = (ctx: HandlerContext): HandlerRegistry => {
  const handlers = new Map<JobType, JobHandler>([
    ["implementation", new ImplementationHandler(ctx)],
    ["review", new ReviewHandler(ctx)],
    ["merge", new MergeHandler(ctx)],
    ["completing-task", new CompletingTaskHandler(ctx)],
    ["completion-review", new CompletionReviewHandler(ctx)],
    ["conflict-solver", new ConflictSolverHandler(ctx)]
  ]);

  return {
    get: (type: JobType) => handlers.get(type)
  };
};
