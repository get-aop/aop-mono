import type {
  BrainstormDraft,
  OrchestratorState,
  ProjectListItem,
  SubtaskPreview,
  SubtaskStatus,
  TaskStatus
} from "./types";

export interface ApproveOptions {
  subtasks: SubtaskPreview[];
}

export interface ApiClient {
  baseUrl: string;
  fetchProjects(): Promise<{
    projects: ProjectListItem[];
    isGlobalMode: boolean;
  }>;
  fetchProjectTasks(projectName: string): Promise<OrchestratorState>;
  fetchState(): Promise<OrchestratorState>;
  updateTaskStatus(
    folder: string,
    status: TaskStatus,
    projectName: string
  ): Promise<void>;
  updateSubtaskStatus(
    folder: string,
    file: string,
    status: SubtaskStatus,
    projectName: string
  ): Promise<void>;
  createPullRequest(folder: string): Promise<{ prUrl: string }>;
  fetchDiff(folder: string): Promise<{ diff: string }>;
  getSubtaskLogs(folder: string, file: string): Promise<{ logs: string[] }>;

  startBrainstorm(
    initialMessage?: string
  ): Promise<{ sessionId: string; agentId: string }>;
  sendBrainstormMessage(sessionId: string, content: string): Promise<void>;
  endBrainstorm(sessionId: string): Promise<{ draftId?: string }>;
  confirmBrainstorm(sessionId: string): Promise<void>;
  approveBrainstorm(
    sessionId: string,
    options: ApproveOptions
  ): Promise<{ taskFolder: string }>;

  listDrafts(): Promise<{ drafts: BrainstormDraft[] }>;
  resumeDraft(
    sessionId: string
  ): Promise<{ sessionId: string; agentId: string }>;
  deleteDraft(sessionId: string): Promise<void>;

  // Local agent management
  startLocalAgent(): Promise<{ success: boolean; error?: string }>;
  stopLocalAgent(): Promise<{ success: boolean; error?: string }>;
  getLocalAgentStatus(): Promise<{
    status: "disconnected" | "connecting" | "connected";
    processRunning: boolean;
    agentConnected: boolean;
  }>;
  createTaskSimple(
    description: string,
    projectName?: string
  ): Promise<{ success: boolean; taskFolder: string }>;
  createTaskCli(
    description: string,
    projectName?: string
  ): Promise<{ success: boolean; runId: string }>;
  sendTaskCreateInput(runId: string, line: string): Promise<void>;
}

const getDefaultBaseUrl = () => {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://localhost:3001";
};

export const createApiClient = (baseUrl = getDefaultBaseUrl()): ApiClient => {
  const request = async <T>(
    path: string,
    options?: RequestInit
  ): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`, options);
    if (!response.ok) {
      throw new Error(`${response.status}`);
    }
    return response.json();
  };

  return {
    baseUrl,

    fetchProjects: () =>
      request<{ projects: ProjectListItem[]; isGlobalMode: boolean }>(
        "/api/projects"
      ),

    fetchProjectTasks: (projectName) =>
      request<{
        tasks: OrchestratorState["tasks"];
        subtasks: OrchestratorState["subtasks"];
      }>(`/api/tasks?project=${encodeURIComponent(projectName)}`).then(
        (data) => ({
          tasks: data.tasks,
          plans: {} as OrchestratorState["plans"],
          subtasks: data.subtasks
        })
      ),

    fetchState: () => request<OrchestratorState>("/api/state"),

    updateTaskStatus: async (folder, status, projectName) => {
      await request(`/api/tasks/${folder}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, projectName })
      });
    },

    updateSubtaskStatus: async (folder, file, status, projectName) => {
      await request(`/api/subtasks/${folder}/${file}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, projectName })
      });
    },

    createPullRequest: (folder) =>
      request<{ prUrl: string }>(`/api/tasks/${folder}/create-pr`, {
        method: "POST"
      }),

    fetchDiff: (folder) =>
      request<{ diff: string }>(`/api/tasks/${folder}/diff`),

    getSubtaskLogs: (folder, file) =>
      request<{ logs: string[] }>(`/api/tasks/${folder}/subtasks/${file}/logs`),

    startBrainstorm: (initialMessage) =>
      request<{ sessionId: string; agentId: string }>("/api/brainstorm/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initialMessage })
      }),

    sendBrainstormMessage: async (sessionId, content) => {
      await request(`/api/brainstorm/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
    },

    endBrainstorm: (sessionId) =>
      request<{ draftId?: string }>(`/api/brainstorm/${sessionId}/end`, {
        method: "POST"
      }),

    confirmBrainstorm: async (sessionId) => {
      await request(`/api/brainstorm/${sessionId}/confirm`, {
        method: "POST"
      });
    },

    approveBrainstorm: (sessionId, options) =>
      request<{ taskFolder: string }>(`/api/brainstorm/${sessionId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options)
      }),

    listDrafts: () =>
      request<{ drafts: BrainstormDraft[] }>("/api/brainstorm/drafts"),

    resumeDraft: (sessionId) =>
      request<{ sessionId: string; agentId: string }>(
        `/api/brainstorm/drafts/${sessionId}/resume`,
        { method: "POST" }
      ),

    deleteDraft: async (sessionId) => {
      await request(`/api/brainstorm/drafts/${sessionId}`, {
        method: "DELETE"
      });
    },

    startLocalAgent: () =>
      request<{ success: boolean; error?: string }>("/api/local-agent/start", {
        method: "POST"
      }),

    stopLocalAgent: () =>
      request<{ success: boolean; error?: string }>("/api/local-agent/stop", {
        method: "POST"
      }),

    getLocalAgentStatus: () =>
      request<{
        status: "disconnected" | "connecting" | "connected";
        processRunning: boolean;
        agentConnected: boolean;
      }>("/api/local-agent/status"),

    createTaskSimple: (description, projectName) =>
      request<{ success: boolean; taskFolder: string }>("/api/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, projectName })
      }),

    createTaskCli: (description, projectName) =>
      request<{ success: boolean; runId: string }>("/api/tasks/create-cli", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, projectName })
      }),

    sendTaskCreateInput: async (runId, line) => {
      await request("/api/tasks/create-cli/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, line })
      });
    }
  };
};
