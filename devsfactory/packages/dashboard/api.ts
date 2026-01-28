import type { OrchestratorState, SubtaskStatus, TaskStatus } from "./types";

export interface ApiClient {
  baseUrl: string;
  fetchState(): Promise<OrchestratorState>;
  updateTaskStatus(folder: string, status: TaskStatus): Promise<void>;
  updateSubtaskStatus(
    folder: string,
    file: string,
    status: SubtaskStatus
  ): Promise<void>;
  createPullRequest(folder: string): Promise<{ prUrl: string }>;
  fetchDiff(folder: string): Promise<{ diff: string }>;
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
      request<{ diff: string }>(`/api/tasks/${folder}/diff`)
  };
};
