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
  updateTaskStatus(folder: string, status: TaskStatus): Promise<void>;
  updateSubtaskStatus(
    folder: string,
    file: string,
    status: SubtaskStatus
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
}

export const createApiClient = (
  baseUrl = "http://localhost:3000"
): ApiClient => {
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
      request<OrchestratorState>(
        `/api/projects/${encodeURIComponent(projectName)}/state`
      ),

    fetchState: () => request<OrchestratorState>("/api/state"),

    updateTaskStatus: async (folder, status) => {
      await request(`/api/tasks/${folder}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
    },

    updateSubtaskStatus: async (folder, file, status) => {
      await request(`/api/subtasks/${folder}/${file}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
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
    }
  };
};
