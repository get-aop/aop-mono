import { EventEmitter } from "node:events";
import { type FSWatcher, watch } from "node:fs";
import { parsePlan } from "../parser/plan";
import { listSubtasks } from "../parser/subtask";
import { listTaskFolders, parseTask } from "../parser/task";
import type { Config, Plan, Subtask, Task } from "../types";

export interface ScanResult {
  tasks: Task[];
  plans: Record<string, Plan>;
  subtasks: Record<string, Subtask[]>;
}

export class DevsfactoryWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private debounceTimers: Map<string, Timer> = new Map();
  private config: Config;

  constructor(config: Config) {
    super();
    this.config = config;
  }

  start(devsfactoryPath: string): void {
    this.watcher = watch(
      devsfactoryPath,
      { recursive: true },
      (_, filename) => {
        if (filename) {
          this.handleFileChange(filename);
        }
      }
    );
  }

  stop(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  isWatching(): boolean {
    return this.watcher !== null;
  }

  private handleFileChange(filename: string): void {
    if (this.shouldIgnore(filename)) {
      return;
    }

    const existing = this.debounceTimers.get(filename);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filename);
      this.emitEvent(filename);
    }, this.config.debounceMs);

    this.debounceTimers.set(filename, timer);
  }

  private shouldIgnore(filename: string): boolean {
    return this.config.ignorePatterns.some((pattern) => {
      if (pattern.startsWith("*")) {
        return filename.endsWith(pattern.slice(1));
      }
      return filename.includes(pattern);
    });
  }

  async scan(devsfactoryPath: string): Promise<ScanResult> {
    const taskFolders = await listTaskFolders(devsfactoryPath);

    const tasks: Task[] = [];
    const plans: Record<string, Plan> = {};
    const subtasks: Record<string, Subtask[]> = {};

    for (const folder of taskFolders) {
      const task = await parseTask(folder, devsfactoryPath);
      tasks.push(task);

      const plan = await parsePlan(folder, devsfactoryPath);
      if (plan) {
        plans[folder] = plan;
      }

      const subtaskList = await listSubtasks(folder, devsfactoryPath);
      if (subtaskList.length > 0) {
        subtasks[folder] = subtaskList;
      }
    }

    return { tasks, plans, subtasks };
  }

  private emitEvent(filename: string): void {
    const parts = filename.split("/");
    if (parts.length < 2) return;

    const taskFolder = parts[0]!;
    const file = parts[parts.length - 1]!;

    if (file === "task.md") {
      this.emit("taskChanged", { taskFolder });
    } else if (file === "plan.md") {
      this.emit("planChanged", { taskFolder });
    } else if (file === "review.md") {
      this.emit("reviewChanged", { taskFolder });
    } else if (/^\d{3}-.*\.md$/.test(file)) {
      this.emit("subtaskChanged", { taskFolder, filename: file });
    }
  }
}
