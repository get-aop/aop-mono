import type { EventEmitter } from "node:events";
import type {
  PhaseTimings,
  Plan,
  Subtask,
  SubtaskStatus,
  SubtaskTiming,
  Task,
  TaskStatus
} from "../../types";

export interface ScanResult {
  tasks: Task[];
  plans: Record<string, Plan>;
  subtasks: Record<string, Subtask[]>;
}

export interface TimingUpdate {
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
}

export interface SubtaskTimingUpdate extends TimingUpdate {
  phases?: Partial<PhaseTimings>;
}

export interface SubtaskInput {
  frontmatter: {
    title: string;
    status: SubtaskStatus;
    dependencies?: number[];
    timing?: SubtaskTiming;
  };
  description: string;
  context?: string;
}

export interface TaskStorageEvents {
  taskChanged: (data: { taskFolder: string }) => void;
  planChanged: (data: { taskFolder: string }) => void;
  subtaskChanged: (data: { taskFolder: string; filename: string }) => void;
  reviewChanged: (data: { taskFolder: string }) => void;
}

export interface TaskStorage {
  // Read
  scan(): Promise<ScanResult>;
  listTaskFolders(): Promise<string[]>;
  getTask(taskFolder: string): Promise<Task | null>;
  getPlan(taskFolder: string): Promise<Plan | null>;
  listSubtasks(taskFolder: string): Promise<Subtask[]>;
  getSubtask(taskFolder: string, filename: string): Promise<Subtask | null>;
  getReadySubtasks(taskFolder: string): Promise<Subtask[]>;

  // Write
  createTask(taskFolder: string, task: Omit<Task, "folder">): Promise<void>;
  updateTaskStatus(taskFolder: string, status: TaskStatus): Promise<void>;
  updateTaskTiming(taskFolder: string, timing: TimingUpdate): Promise<void>;
  createSubtask(taskFolder: string, subtask: SubtaskInput): Promise<string>;
  updateSubtaskStatus(
    taskFolder: string,
    filename: string,
    status: SubtaskStatus
  ): Promise<void>;
  updateSubtaskTiming(
    taskFolder: string,
    filename: string,
    timing: SubtaskTimingUpdate
  ): Promise<void>;
  recordPhaseDuration(
    taskFolder: string,
    filename: string,
    phase: keyof PhaseTimings,
    durationMs: number
  ): Promise<void>;
  appendReviewHistory(
    taskFolder: string,
    subtaskFilename: string,
    content: string
  ): Promise<void>;

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;

  // State check
  isWatching(): boolean;
}

export type TaskStorageEmitter = TaskStorage & EventEmitter;
