import { createStore } from "zustand/vanilla";
import { type ApiClient, createApiClient } from "./api";
import type {
  ActiveAgent,
  Plan,
  ServerEvent,
  Subtask,
  SubtaskStatus,
  Task,
  TaskStatus
} from "./types";

export interface SelectedSubtask {
  taskFolder: string;
  subtaskFile: string;
}

export interface DashboardStore {
  tasks: Task[];
  plans: Record<string, Plan>;
  subtasks: Record<string, Subtask[]>;
  activeAgents: Map<string, ActiveAgent>;
  agentOutputs: Map<string, string[]>;

  selectedTask: string | null;
  focusedAgent: string | null;
  isPinned: boolean;
  debugMode: boolean;
  connected: boolean;

  selectedSubtask: SelectedSubtask | null;
  subtaskLogs: string[];
  subtaskLogsLoading: boolean;

  updateFromServer: (event: ServerEvent) => void;
  selectTask: (folder: string | null) => void;
  focusAgent: (agentId: string, pin?: boolean) => void;
  clearFocus: () => void;
  toggleDebugMode: () => void;
  setConnected: (connected: boolean) => void;

  selectSubtask: (taskFolder: string, subtaskFile: string) => Promise<void>;
  clearSubtaskSelection: () => void;

  setTaskStatus: (folder: string, status: TaskStatus) => Promise<void>;
  setSubtaskStatus: (
    folder: string,
    file: string,
    status: SubtaskStatus
  ) => Promise<void>;
  createPullRequest: (folder: string) => Promise<{ prUrl: string }>;
  fetchDiff: (folder: string) => Promise<{ diff: string }>;
}

export interface DashboardStoreInitialState {
  tasks?: Task[];
  plans?: Record<string, Plan>;
  subtasks?: Record<string, Subtask[]>;
  activeAgents?: Map<string, ActiveAgent>;
  agentOutputs?: Map<string, string[]>;
  selectedTask?: string | null;
  focusedAgent?: string | null;
  isPinned?: boolean;
  debugMode?: boolean;
  connected?: boolean;
  selectedSubtask?: SelectedSubtask | null;
  subtaskLogs?: string[];
  subtaskLogsLoading?: boolean;
}

const MAX_OUTPUT_LINES = 1000;

export const createDashboardStore = (
  apiClient?: ApiClient,
  initialState?: DashboardStoreInitialState
) => {
  const client = apiClient ?? createApiClient();

  return createStore<DashboardStore>((set) => ({
    tasks: initialState?.tasks ?? [],
    plans: initialState?.plans ?? {},
    subtasks: initialState?.subtasks ?? {},
    activeAgents: initialState?.activeAgents ?? new Map(),
    agentOutputs: initialState?.agentOutputs ?? new Map(),

    selectedTask: initialState?.selectedTask ?? null,
    focusedAgent: initialState?.focusedAgent ?? null,
    isPinned: initialState?.isPinned ?? false,
    debugMode: initialState?.debugMode ?? false,
    connected: initialState?.connected ?? false,

    selectedSubtask: initialState?.selectedSubtask ?? null,
    subtaskLogs: initialState?.subtaskLogs ?? [],
    subtaskLogsLoading: initialState?.subtaskLogsLoading ?? false,

    selectTask: (folder) =>
      set({
        selectedTask: folder,
        selectedSubtask: null,
        subtaskLogs: [],
        subtaskLogsLoading: false
      }),

    focusAgent: (agentId, pin = false) =>
      set({ focusedAgent: agentId, isPinned: pin }),

    clearFocus: () => set({ focusedAgent: null, isPinned: false }),

    toggleDebugMode: () => set((state) => ({ debugMode: !state.debugMode })),

    setConnected: (connected) => set({ connected }),

    selectSubtask: async (taskFolder, subtaskFile) => {
      set({
        selectedSubtask: { taskFolder, subtaskFile },
        subtaskLogsLoading: true
      });
      try {
        const { logs } = await client.getSubtaskLogs(taskFolder, subtaskFile);
        set({ subtaskLogs: logs, subtaskLogsLoading: false });
      } catch {
        set({ subtaskLogs: [], subtaskLogsLoading: false });
      }
    },

    clearSubtaskSelection: () =>
      set({
        selectedSubtask: null,
        subtaskLogs: [],
        subtaskLogsLoading: false
      }),

    updateFromServer: (event) => {
      switch (event.type) {
        case "state":
          set({
            tasks: event.data.tasks,
            plans: event.data.plans,
            subtasks: event.data.subtasks
          });
          break;

        case "taskChanged":
          set((state) => {
            const idx = state.tasks.findIndex(
              (t) => t.folder === event.task.folder
            );
            if (idx >= 0) {
              const tasks = [...state.tasks];
              tasks[idx] = event.task;
              return { tasks };
            }
            return { tasks: [...state.tasks, event.task] };
          });
          break;

        case "subtaskChanged":
          set((state) => {
            const existing = state.subtasks[event.taskFolder] ?? [];
            const idx = existing.findIndex(
              (s) => s.number === event.subtask.number
            );
            const updated =
              idx >= 0
                ? existing.map((s, i) => (i === idx ? event.subtask : s))
                : [...existing, event.subtask];
            return {
              subtasks: { ...state.subtasks, [event.taskFolder]: updated }
            };
          });
          break;

        case "agentStarted":
          set((state) => {
            const activeAgents = new Map(state.activeAgents);
            activeAgents.set(event.agentId, {
              taskFolder: event.taskFolder,
              subtaskFile: event.subtaskFile,
              type: event.agentType
            });
            return { activeAgents };
          });
          break;

        case "agentOutput":
          set((state) => {
            const agentOutputs = new Map(state.agentOutputs);
            const existing = agentOutputs.get(event.agentId) ?? [];
            const updated = [...existing, event.chunk];
            if (updated.length > MAX_OUTPUT_LINES) {
              updated.splice(0, updated.length - MAX_OUTPUT_LINES);
            }
            agentOutputs.set(event.agentId, updated);

            const result: Partial<DashboardStore> = { agentOutputs };

            if (state.selectedSubtask) {
              const agent = state.activeAgents.get(event.agentId);
              if (
                agent?.taskFolder === state.selectedSubtask.taskFolder &&
                agent?.subtaskFile === state.selectedSubtask.subtaskFile
              ) {
                result.subtaskLogs = [...state.subtaskLogs, event.chunk];
              }
            }

            return result;
          });
          break;

        case "agentCompleted":
          set((state) => {
            const activeAgents = new Map(state.activeAgents);
            activeAgents.delete(event.agentId);
            return { activeAgents };
          });
          break;

        case "jobFailed":
        case "jobRetrying":
          break;
      }
    },

    setTaskStatus: async (folder, status) => {
      await client.updateTaskStatus(folder, status);
    },

    setSubtaskStatus: async (folder, file, status) => {
      await client.updateSubtaskStatus(folder, file, status);
    },

    createPullRequest: async (folder) => {
      return client.createPullRequest(folder);
    },

    fetchDiff: async (folder) => {
      return client.fetchDiff(folder);
    }
  }));
};
