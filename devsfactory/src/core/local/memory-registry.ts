import { EventEmitter } from "node:events";
import type { AgentRegistry, RunningAgent } from "../interfaces/agent-registry";

export class MemoryAgentRegistry extends EventEmitter implements AgentRegistry {
  private agents: Map<string, RunningAgent> = new Map();

  async register(agent: RunningAgent): Promise<void> {
    this.agents.set(agent.jobId, agent);
    this.emit("agentRegistered", agent);
  }

  async unregister(jobId: string): Promise<void> {
    const agent = this.agents.get(jobId);
    if (agent) {
      this.agents.delete(jobId);
      this.emit("agentUnregistered", agent);
    }
  }

  async get(jobId: string): Promise<RunningAgent | undefined> {
    return this.agents.get(jobId);
  }

  async getByTask(taskFolder: string): Promise<RunningAgent[]> {
    return Array.from(this.agents.values()).filter(
      (a) => a.taskFolder === taskFolder
    );
  }

  async getBySubtask(
    taskFolder: string,
    subtaskFile: string
  ): Promise<RunningAgent | undefined> {
    return Array.from(this.agents.values()).find(
      (a) => a.taskFolder === taskFolder && a.subtaskFile === subtaskFile
    );
  }

  async getAll(): Promise<RunningAgent[]> {
    return Array.from(this.agents.values());
  }

  async count(): Promise<number> {
    return this.agents.size;
  }
}
