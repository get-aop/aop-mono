import { createStore } from "zustand/vanilla";
import { type ApiClient, createApiClient } from "./api";
import type {
  ActiveAgent,
  BrainstormDraft,
  BrainstormMessage,
  Plan,
  ProjectListItem,
  ServerEvent,
  Subtask,
  SubtaskPreview,
  SubtaskStatus,
  Task,
  TaskPreview,
  TaskStatus
} from "./types";

export interface SelectedSubtask {
  taskFolder: string;
  subtaskFile: string;
}

export type BrainstormSessionStatus =
  | "idle"
  | "starting"
  | "brainstorming"
  | "planning"
  | "review"
  | "creating";

export type BrainstormStep = "drafts" | "brainstorm" | "review" | "approve";

export interface BrainstormState {
  activeSession: string | null;
  sessionStatus: BrainstormSessionStatus;
  messages: BrainstormMessage[];
  isWaitingForAgent: boolean;
  streamingMessage: string | null;
  taskPreview: TaskPreview | null;
  subtaskPreviews: SubtaskPreview[];
  editedSubtasks: SubtaskPreview[];
  drafts: BrainstormDraft[];
  draftsLoading: boolean;
  isModalOpen: boolean;
  currentStep: BrainstormStep;
  error: string | null;
}

export interface BrainstormActions {
  openModal(): void;
  closeModal(): Promise<void>;
  startSession(initialMessage?: string): Promise<void>;
  resumeSession(draftId: string): Promise<void>;
  sendMessage(content: string): Promise<void>;
  endSession(): Promise<void>;
  confirmTaskPreview(): Promise<void>;
  updateSubtask(index: number, updates: Partial<SubtaskPreview>): void;
  reorderSubtasks(fromIndex: number, toIndex: number): void;
  approveAndCreate(): Promise<void>;
  loadDrafts(): Promise<void>;
  deleteDraft(sessionId: string): Promise<void>;
}

export interface ProjectState {
  projects: ProjectListItem[];
  projectsLoading: boolean;
  projectsError: string | null;
  currentProject: string | null;
  isGlobalMode: boolean;
}

export interface ProjectActions {
  loadProjects(): Promise<void>;
  selectProject(projectName: string): void;
  selectAllProjects(): void;
}

export interface DashboardStore extends BrainstormActions, ProjectActions {
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

  brainstorm: BrainstormState;
  project: ProjectState;

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
  brainstorm?: Partial<BrainstormState>;
  project?: Partial<ProjectState>;
}

const MAX_OUTPUT_LINES = 1000;

const defaultBrainstormState: BrainstormState = {
  activeSession: null,
  sessionStatus: "idle",
  messages: [],
  isWaitingForAgent: false,
  streamingMessage: null,
  taskPreview: null,
  subtaskPreviews: [],
  editedSubtasks: [],
  drafts: [],
  draftsLoading: false,
  isModalOpen: false,
  currentStep: "drafts",
  error: null
};

const defaultProjectState: ProjectState = {
  projects: [],
  projectsLoading: false,
  projectsError: null,
  currentProject: null,
  isGlobalMode: false
};

export const createDashboardStore = (
  apiClient?: ApiClient,
  initialState?: DashboardStoreInitialState
) => {
  const client = apiClient ?? createApiClient();

  return createStore<DashboardStore>((set, get) => ({
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

    brainstorm: {
      ...defaultBrainstormState,
      ...initialState?.brainstorm
    },

    project: {
      ...defaultProjectState,
      ...initialState?.project
    },

    loadProjects: async () => {
      set((state) => ({
        project: { ...state.project, projectsLoading: true, projectsError: null }
      }));

      try {
        const { projects, isGlobalMode } = await client.fetchProjects();
        set((state) => ({
          project: {
            ...state.project,
            projects,
            isGlobalMode,
            projectsLoading: false
          }
        }));
      } catch (error) {
        set((state) => ({
          project: {
            ...state.project,
            projectsLoading: false,
            projectsError:
              error instanceof Error ? error.message : "Failed to load projects"
          }
        }));
      }
    },

    selectProject: (projectName) => {
      set((state) => ({
        project: { ...state.project, currentProject: projectName },
        selectedTask: null,
        selectedSubtask: null,
        subtaskLogs: []
      }));
    },

    selectAllProjects: () => {
      set((state) => ({
        project: { ...state.project, currentProject: null },
        selectedTask: null,
        selectedSubtask: null,
        subtaskLogs: []
      }));
    },

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

    openModal: () =>
      set((state) => ({
        brainstorm: { ...state.brainstorm, isModalOpen: true }
      })),

    closeModal: async () => {
      set({
        brainstorm: { ...defaultBrainstormState }
      });
    },

    startSession: async (initialMessage) => {
      set((state) => ({
        brainstorm: {
          ...state.brainstorm,
          sessionStatus: "starting",
          currentStep: "brainstorm",
          error: null
        }
      }));
      await client.startBrainstorm(initialMessage);
    },

    resumeSession: async (draftId) => {
      set((state) => ({
        brainstorm: {
          ...state.brainstorm,
          sessionStatus: "starting",
          currentStep: "brainstorm",
          error: null
        }
      }));
      await client.resumeDraft(draftId);
    },

    sendMessage: async (content) => {
      const { brainstorm } = get();
      if (!brainstorm.activeSession) return;

      const userMessage: BrainstormMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        timestamp: new Date()
      };

      set((state) => ({
        brainstorm: {
          ...state.brainstorm,
          messages: [...state.brainstorm.messages, userMessage],
          isWaitingForAgent: true
        }
      }));

      await client.sendBrainstormMessage(brainstorm.activeSession, content);
    },

    endSession: async () => {
      const { brainstorm } = get();
      if (!brainstorm.activeSession) return;
      await client.endBrainstorm(brainstorm.activeSession);
    },

    confirmTaskPreview: async () => {
      const { brainstorm } = get();
      if (!brainstorm.activeSession) return;

      set((state) => ({
        brainstorm: {
          ...state.brainstorm,
          sessionStatus: "planning"
        }
      }));

      await client.confirmBrainstorm(brainstorm.activeSession);
    },

    updateSubtask: (index, updates) => {
      set((state) => {
        const editedSubtasks = [...state.brainstorm.editedSubtasks];
        editedSubtasks[index] = { ...editedSubtasks[index], ...updates };
        return {
          brainstorm: {
            ...state.brainstorm,
            editedSubtasks
          }
        };
      });
    },

    reorderSubtasks: (fromIndex, toIndex) => {
      set((state) => {
        const editedSubtasks = [...state.brainstorm.editedSubtasks];
        const [removed] = editedSubtasks.splice(fromIndex, 1);
        editedSubtasks.splice(toIndex, 0, removed);
        return {
          brainstorm: {
            ...state.brainstorm,
            editedSubtasks
          }
        };
      });
    },

    approveAndCreate: async () => {
      const { brainstorm } = get();
      if (!brainstorm.activeSession) return;

      set((state) => ({
        brainstorm: {
          ...state.brainstorm,
          sessionStatus: "creating"
        }
      }));

      await client.approveBrainstorm(brainstorm.activeSession, {
        subtasks: brainstorm.editedSubtasks
      });
    },

    loadDrafts: async () => {
      set((state) => ({
        brainstorm: {
          ...state.brainstorm,
          draftsLoading: true
        }
      }));

      const { drafts } = await client.listDrafts();

      set((state) => ({
        brainstorm: {
          ...state.brainstorm,
          drafts,
          draftsLoading: false
        }
      }));
    },

    deleteDraft: async (sessionId) => {
      await client.deleteDraft(sessionId);

      set((state) => ({
        brainstorm: {
          ...state.brainstorm,
          drafts: state.brainstorm.drafts.filter(
            (d) => d.sessionId !== sessionId
          )
        }
      }));
    },

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

        case "brainstormStarted":
          set((state) => ({
            brainstorm: {
              ...state.brainstorm,
              activeSession: event.sessionId,
              sessionStatus: "brainstorming",
              isWaitingForAgent: true
            }
          }));
          break;

        case "brainstormMessage":
          set((state) => {
            if (state.brainstorm.activeSession !== event.sessionId) {
              return {};
            }
            return {
              brainstorm: {
                ...state.brainstorm,
                messages: [...state.brainstorm.messages, event.message],
                isWaitingForAgent: false,
                streamingMessage: null
              }
            };
          });
          break;

        case "brainstormWaiting":
          set((state) => {
            if (state.brainstorm.activeSession !== event.sessionId) {
              return {};
            }
            return {
              brainstorm: {
                ...state.brainstorm,
                isWaitingForAgent: false
              }
            };
          });
          break;

        case "brainstormChunk":
          set((state) => {
            if (state.brainstorm.activeSession !== event.sessionId) {
              return {};
            }
            return {
              brainstorm: {
                ...state.brainstorm,
                streamingMessage:
                  (state.brainstorm.streamingMessage ?? "") + event.chunk
              }
            };
          });
          break;

        case "brainstormComplete":
          set((state) => {
            if (state.brainstorm.activeSession !== event.sessionId) {
              return {};
            }
            return {
              brainstorm: {
                ...state.brainstorm,
                taskPreview: event.taskPreview,
                sessionStatus: "review",
                currentStep: "review"
              }
            };
          });
          break;

        case "planGenerated":
          set((state) => {
            if (state.brainstorm.activeSession !== event.sessionId) {
              return {};
            }
            return {
              brainstorm: {
                ...state.brainstorm,
                subtaskPreviews: event.subtaskPreviews,
                editedSubtasks: [...event.subtaskPreviews],
                currentStep: "approve"
              }
            };
          });
          break;

        case "taskCreated":
          set((state) => {
            if (state.brainstorm.activeSession !== event.sessionId) {
              return {};
            }
            return {
              brainstorm: {
                ...defaultBrainstormState
              }
            };
          });
          break;

        case "brainstormError":
          set((state) => {
            if (state.brainstorm.activeSession !== event.sessionId) {
              return {};
            }
            return {
              brainstorm: {
                ...state.brainstorm,
                error: event.error,
                isWaitingForAgent: false
              }
            };
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
