import type { AgentRegistry } from "../interfaces/agent-registry";
import type { AgentDispatcher } from "../remote/agent-dispatcher";
import type { Job, JobResult, JobType } from "../types/job";

const jobTypeToAgentType = (type: JobType) => {
  switch (type) {
    case "implementation":
      return "implementation";
    case "review":
      return "review";
    case "completing-task":
      return "completing-task";
    case "completion-review":
      return "completion-review";
    case "conflict-solver":
      return "conflict-solver";
    case "merge":
      return "review";
    case "migrate-worktree":
      return "completion-review";
  }
};

export class RemoteJobHandler {
  constructor(
    private dispatcher: AgentDispatcher,
    private registry: AgentRegistry
  ) {}

  async execute(job: Job): Promise<JobResult> {
    await this.registry.register({
      jobId: job.id,
      type: jobTypeToAgentType(job.type),
      taskFolder: job.taskFolder,
      subtaskFile: job.subtaskFile,
      pid: 0,
      startedAt: new Date()
    });

    try {
      return await this.dispatcher.dispatch(job, "", "");
    } finally {
      await this.registry.unregister(job.id);
    }
  }
}
