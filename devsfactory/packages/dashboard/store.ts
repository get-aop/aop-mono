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
  selectProject(projectName: string): Promise<void>;
  selectAllProjects(): void;
  refreshTasks(): Promise<void>;
}

export type LocalAgentStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface LocalAgentState {
  status: LocalAgentStatus;
  error: string | null;
}

export interface LocalAgentActions {
  startLocalAgent(): Promise<void>;
  stopLocalAgent(): Promise<void>;
  createTaskSimple(description: string): Promise<{ runId: string }>;
  sendTaskCreateInput(line: string): Promise<void>;
  clearTaskCreateOutput(): void;
}

export interface DashboardStore
  extends BrainstormActions,
    ProjectActions,
    LocalAgentActions {
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
  localAgent: LocalAgentState;
  taskCreate: TaskCreateState;

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
  localAgent?: Partial<LocalAgentState>;
  taskCreate?: Partial<TaskCreateState>;
}

const MAX_OUTPUT_LINES = 1000;
const MAX_TASK_CREATE_LINES = 500;

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

const defaultLocalAgentState: LocalAgentState = {
  status: "disconnected",
  error: null
};

export interface TaskCreateState {
  runId: string | null;
  status: "idle" | "running" | "completed" | "failed";
  exitCode: number | null;
  output: string[];
}

const defaultTaskCreateState: TaskCreateState = {
  runId: null,
  status: "idle",
  exitCode: null,
  output: []
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

    localAgent: {
      ...defaultLocalAgentState,
      ...initialState?.localAgent
    },

    taskCreate: {
      ...defaultTaskCreateState,
      ...initialState?.taskCreate
    },

    loadProjects: async () => {
      set((state) => ({
        project: {
          ...state.project,
          projectsLoading: true,
          projectsError: null
        }
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

    selectProject: async (projectName) => {
      set((state) => ({
        project: { ...state.project, currentProject: projectName },
        selectedTask: null,
        selectedSubtask: null,
        subtaskLogs: [],
        tasks: [],
        subtasks: {}
      }));

      // Fetch tasks from SQLite for this project
      try {
        const data = await client.fetchProjectTasks(projectName);
        set({
          tasks: data.tasks,
          subtasks: data.subtasks
        });
      } catch (error) {
        console.error("Failed to fetch project tasks:", error);
      }
    },

    selectAllProjects: () => {
      set((state) => ({
        project: { ...state.project, currentProject: null },
        selectedTask: null,
        selectedSubtask: null,
        subtaskLogs: []
      }));
    },

    refreshTasks: async () => {
      const projectName = get().project.currentProject;
      if (!projectName) return;

      try {
        const data = await client.fetchProjectTasks(projectName);
        set({
          tasks: data.tasks,
          subtasks: data.subtasks
        });
      } catch (error) {
        console.error("Failed to refresh tasks:", error);
      }
    },

    startLocalAgent: async () => {
      set((state) => ({
        localAgent: { ...state.localAgent, status: "connecting", error: null }
      }));

      try {
        const result = await client.startLocalAgent();
        if (!result.success) {
          set((state) => ({
            localAgent: {
              ...state.localAgent,
              status: "error",
              error: result.error ?? "Failed to start agent"
            }
          }));
        }
      } catch (error) {
        set((state) => ({
          localAgent: {
            ...state.localAgent,
            status: "error",
            error:
              error instanceof Error ? error.message : "Failed to start agent"
          }
        }));
      }
    },

    stopLocalAgent: async () => {
      try {
        await client.stopLocalAgent();
        set((state) => ({
          localAgent: {
            ...state.localAgent,
            status: "disconnected",
            error: null
          }
        }));
      } catch (error) {
        set((state) => ({
          localAgent: {
            ...state.localAgent,
            status: "error",
            error:
              error instanceof Error ? error.message : "Failed to stop agent"
          }
        }));
      }
    },

    createTaskSimple: async (description: string) => {
      const projectName = get().project.currentProject;
      if (!projectName) {
        throw new Error("Select a project before creating a task");
      }
      const result = await client.createTaskCli(description, projectName);
      set({
        taskCreate: {
          runId: result.runId,
          status: "running",
          exitCode: null,
          output: []
        }
      });
      return result;
    },

    sendTaskCreateInput: async (line: string) => {
      const runId = get().taskCreate.runId;
      if (!runId) {
        throw new Error("No active task creation session");
      }
      await client.sendTaskCreateInput(runId, line);
    },

    clearTaskCreateOutput: () =>
      set({
        taskCreate: {
          ...defaultTaskCreateState
        }
      }),

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
        case "taskCreateStarted":
          set({
            taskCreate: {
              runId: event.runId,
              status: "running",
              exitCode: null,
              output: []
            }
          });
          break;
        case "taskCreateOutput":
          set((state) => {
            const output = [...state.taskCreate.output, event.line];
            if (output.length > MAX_TASK_CREATE_LINES) {
              output.splice(0, output.length - MAX_TASK_CREATE_LINES);
            }
            return {
              taskCreate: {
                ...state.taskCreate,
                runId: event.runId,
                output
              }
            };
          });
          break;
        case "taskCreateCompleted":
          set((state) => ({
            taskCreate: {
              ...state.taskCreate,
              runId: event.runId,
              status: event.exitCode === 0 ? "completed" : "failed",
              exitCode: event.exitCode
            }
          }));
          break;

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

        case "localAgentConnected":
          set((state) => ({
            localAgent: {
              ...state.localAgent,
              status: "connected",
              error: null
            }
          }));
          break;

        case "localAgentDisconnected":
          set((state) => ({
            localAgent: { ...state.localAgent, status: "disconnected" }
          }));
          break;
      }
    },

    setTaskStatus: async (folder, status) => {
      const projectName = get().project.currentProject;
      if (!projectName) {
        throw new Error("Select a project before updating a task");
      }
      await client.updateTaskStatus(folder, status, projectName);
    },

    setSubtaskStatus: async (folder, file, status) => {
      const projectName = get().project.currentProject;
      if (!projectName) {
        throw new Error("Select a project before updating a subtask");
      }
      await client.updateSubtaskStatus(folder, file, status, projectName);
    },

    createPullRequest: async (folder) => {
      return client.createPullRequest(folder);
    },

    fetchDiff: async (folder) => {
      return client.fetchDiff(folder);
    }
  }));
};
