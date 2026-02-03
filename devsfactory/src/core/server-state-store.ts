import { EventEmitter } from "node:events";
import type { OrchestratorState, Plan, Subtask, Task } from "../types";
import type { StateDeltaUpdate } from "./remote/protocol";

export interface ServerStateStore {
  getState(): OrchestratorState;
  getProjectState(projectName: string): OrchestratorState;
  getProjectNames(): string[];
  applySnapshot(projectName: string, state: OrchestratorState): void;
  applyDelta(projectName: string, updates: StateDeltaUpdate[]): void;
  on(event: "stateChanged", listener: () => void): this;
  off(event: "stateChanged", listener: () => void): this;
}

const emptyState = (): OrchestratorState => ({
  tasks: [],
  plans: {},
  subtasks: {}
});

const cloneState = (state: OrchestratorState): OrchestratorState => ({
  tasks: state.tasks.map((task) => structuredClone(task)),
  plans: structuredClone(state.plans),
  subtasks: structuredClone(state.subtasks)
});

const upsertTask = (tasks: Task[], task: Task): Task[] => {
  const index = tasks.findIndex((t) => t.folder === task.folder);
  if (index === -1) {
    return [...tasks, task];
  }
  const next = tasks.slice();
  next[index] = task;
  return next;
};

const deleteTask = (tasks: Task[], taskFolder: string): Task[] =>
  tasks.filter((task) => task.folder !== taskFolder);

const upsertPlan = (
  plans: Record<string, Plan>,
  plan: Plan
): Record<string, Plan> => ({
  ...plans,
  [plan.folder]: plan
});

const deletePlan = (
  plans: Record<string, Plan>,
  taskFolder: string
): Record<string, Plan> => {
  const next = { ...plans };
  delete next[taskFolder];
  return next;
};

const upsertSubtask = (
  subtasks: Record<string, Subtask[]>,
  taskFolder: string,
  subtask: Subtask
): Record<string, Subtask[]> => {
  const list = subtasks[taskFolder] ?? [];
  const index = list.findIndex((item) => item.filename === subtask.filename);
  const nextList =
    index === -1
      ? [...list, subtask]
      : list.map((item, idx) => (idx === index ? subtask : item));
  return { ...subtasks, [taskFolder]: nextList };
};

const deleteSubtask = (
  subtasks: Record<string, Subtask[]>,
  taskFolder: string,
  filename: string
): Record<string, Subtask[]> => {
  if (!filename) {
    const next = { ...subtasks };
    delete next[taskFolder];
    return next;
  }

  const list = subtasks[taskFolder] ?? [];
  const nextList = list.filter((item) => item.filename !== filename);
  if (nextList.length === 0) {
    const next = { ...subtasks };
    delete next[taskFolder];
    return next;
  }
  return { ...subtasks, [taskFolder]: nextList };
};

export class InMemoryStateStore
  extends EventEmitter
  implements ServerStateStore
{
  private projectStates = new Map<string, OrchestratorState>();
  private combinedState: OrchestratorState = emptyState();

  getState(): OrchestratorState {
    return cloneState(this.combinedState);
  }

  getProjectState(projectName: string): OrchestratorState {
    return cloneState(this.projectStates.get(projectName) ?? emptyState());
  }

  getProjectNames(): string[] {
    return Array.from(this.projectStates.keys());
  }

  applySnapshot(projectName: string, state: OrchestratorState): void {
    this.projectStates.set(projectName, cloneState(state));
    this.rebuildCombinedState();
  }

  applyDelta(projectName: string, updates: StateDeltaUpdate[]): void {
    const current = this.projectStates.get(projectName) ?? emptyState();
    let nextTasks = current.tasks;
    let nextPlans = current.plans;
    let nextSubtasks = current.subtasks;

    for (const update of updates) {
      switch (update.type) {
        case "task:upsert":
          nextTasks = upsertTask(nextTasks, update.task);
          break;
        case "task:delete":
          nextTasks = deleteTask(nextTasks, update.taskFolder);
          nextPlans = deletePlan(nextPlans, update.taskFolder);
          nextSubtasks = deleteSubtask(nextSubtasks, update.taskFolder, "");
          break;
        case "plan:upsert":
          nextPlans = upsertPlan(nextPlans, update.plan);
          break;
        case "plan:delete":
          nextPlans = deletePlan(nextPlans, update.taskFolder);
          break;
        case "subtask:upsert":
          nextSubtasks = upsertSubtask(
            nextSubtasks,
            update.taskFolder,
            update.subtask
          );
          break;
        case "subtask:delete":
          nextSubtasks = deleteSubtask(
            nextSubtasks,
            update.taskFolder,
            update.filename
          );
          break;
        case "subtask:list:replace":
          nextSubtasks = {
            ...nextSubtasks,
            [update.taskFolder]: update.subtasks
          };
          break;
      }
    }

    this.projectStates.set(projectName, {
      tasks: nextTasks,
      plans: nextPlans,
      subtasks: nextSubtasks
    });
    this.rebuildCombinedState();
  }

  private rebuildCombinedState(): void {
    const combined: OrchestratorState = emptyState();

    for (const state of this.projectStates.values()) {
      combined.tasks.push(...state.tasks);
      for (const [key, plan] of Object.entries(state.plans)) {
        combined.plans[key] = plan;
      }
      for (const [key, subtasks] of Object.entries(state.subtasks)) {
        combined.subtasks[key] = subtasks;
      }
    }

    this.combinedState = combined;
    this.emit("stateChanged");
  }
}
