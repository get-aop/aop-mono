import type { EventEmitter } from "node:events";
import type { AgentType } from "../../types";

export interface RunningAgent {
  jobId: string;
  type: AgentType;
  taskFolder: string;
  subtaskFile?: string;
  pid: number;
  startedAt: Date;
}

export interface AgentRegistry {
  register(agent: RunningAgent): Promise<void>;
  unregister(jobId: string): Promise<void>;
  get(jobId: string): Promise<RunningAgent | undefined>;
  getByTask(taskFolder: string): Promise<RunningAgent[]>;
  getBySubtask(
    taskFolder: string,
    subtaskFile: string
  ): Promise<RunningAgent | undefined>;
  getAll(): Promise<RunningAgent[]>;
  count(): Promise<number>;
}

export type AgentRegistryEmitter = AgentRegistry & EventEmitter;
