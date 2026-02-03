import type { TaskStorageEmitter } from "../core/interfaces/task-storage";
import type { StateDeltaUpdate } from "../core/remote/protocol";
import { SQLiteTaskStorage } from "../core/sqlite/sqlite-task-storage";
import type { OrchestratorState } from "../types";

export interface AgentStatePublisherOptions {
  projectName: string;
  debounceMs?: number;
  onSnapshot: (state: OrchestratorState) => void;
  onDelta: (updates: StateDeltaUpdate[]) => void;
}

export class AgentStatePublisher {
  private storage: TaskStorageEmitter;
  private onSnapshot: (state: OrchestratorState) => void;
  private onDelta: (updates: StateDeltaUpdate[]) => void;
  private started = false;

  constructor(options: AgentStatePublisherOptions) {
    this.storage = new SQLiteTaskStorage({
      projectName: options.projectName,
      pollMs: options.debounceMs
    });
    this.onSnapshot = options.onSnapshot;
    this.onDelta = options.onDelta;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.sendSnapshot();
    await this.storage.start();
    this.subscribeToStorageEvents();
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await this.storage.stop();
    this.storage.removeAllListeners();
  }

  async sendSnapshot(): Promise<void> {
    const scanResult = await this.storage.scan();
    this.onSnapshot(scanResult);
  }

  private subscribeToStorageEvents(): void {
    this.storage.on("taskChanged", async ({ taskFolder }) => {
      if (taskFolder === "*") {
        await this.sendSnapshot();
        return;
      }

      const task = await this.storage.getTask(taskFolder);
      if (task) {
        if (task.frontmatter.status === "PENDING") {
          await this.sendSnapshot();
          return;
        }
        this.emitDelta([{ type: "task:upsert", task }]);
      } else {
        this.emitDelta([{ type: "task:delete", taskFolder }]);
      }
    });

    this.storage.on("planChanged", async ({ taskFolder }) => {
      const plan = await this.storage.getPlan(taskFolder);
      if (plan) {
        this.emitDelta([{ type: "plan:upsert", plan }]);
      } else {
        this.emitDelta([{ type: "plan:delete", taskFolder }]);
      }
    });

    this.storage.on("subtaskChanged", async ({ taskFolder }) => {
      const subtasks = await this.storage.listSubtasks(taskFolder);
      this.emitDelta([{ type: "subtask:list:replace", taskFolder, subtasks }]);
    });
  }

  private emitDelta(updates: StateDeltaUpdate[]): void {
    if (updates.length === 0) return;
    this.onDelta(updates);
  }
}
