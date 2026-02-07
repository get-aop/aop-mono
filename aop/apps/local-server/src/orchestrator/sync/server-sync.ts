import type {
  AuthRequest,
  AuthResponse,
  StepCompleteRequest,
  StepCompleteResponse,
  StepError,
  SyncRepoRequest,
  SyncTaskRequest,
  TaskReadyRequest,
  TaskReadyResponse,
  TaskStatus,
  TaskStatusResponse,
} from "@aop/common/protocol";
import {
  AuthResponseSchema,
  StepCompleteResponseSchema,
  TaskReadyResponseSchema,
  TaskStatusResponseSchema,
} from "@aop/common/protocol";
import { getLogger, injectTraceHeaders } from "@aop/infra";

const logger = getLogger("server-sync");

export interface ServerSyncConfig {
  serverUrl: string;
  apiKey: string;
  maxRetries?: number;
  initialRetryDelayMs?: number;
}

export interface AuthResult {
  clientId: string;
  effectiveMaxConcurrentTasks: number;
}

export interface StepCompletePayload {
  executionId: string;
  attempt: number;
  status: "success" | "failure";
  signal?: string;
  error?: StepError;
  durationMs: number;
}

interface QueuedRequest {
  id: string;
  method: "POST" | "GET";
  endpoint: string;
  body?: unknown;
}

export interface MarkReadyOptions {
  workflowName?: string;
}

export interface ServerSync {
  authenticate(request?: AuthRequest): Promise<AuthResult>;
  syncRepo(repoId: string): Promise<void>;
  syncTask(taskId: string, repoId: string, status: TaskStatus): Promise<void>;
  markTaskReady(
    taskId: string,
    repoId: string,
    options?: MarkReadyOptions,
  ): Promise<TaskReadyResponse>;
  completeStep(stepId: string, result: StepCompletePayload): Promise<StepCompleteResponse>;
  getTaskStatus(taskId: string): Promise<TaskStatusResponse>;
  isDegraded(): boolean;
  isTaskQueued(taskId: string): boolean;
  getQueuedReadyTasks(): string[];
  retryQueuedReadyTasks(): Promise<void>;
  flushOfflineQueue(): Promise<void>;
  getOfflineQueueSize(): number;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 1000;

class ServerSyncImpl implements ServerSync {
  private config: Required<ServerSyncConfig>;
  private degraded = false;
  private offlineQueue: QueuedRequest[] = [];
  private queuedReadyTasks = new Set<string>();
  private requestIdCounter = 0;

  constructor(config: ServerSyncConfig) {
    this.config = {
      ...config,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      initialRetryDelayMs: config.initialRetryDelayMs ?? DEFAULT_INITIAL_RETRY_DELAY_MS,
    };
  }

  async authenticate(request?: AuthRequest): Promise<AuthResult> {
    const log = logger.with({ endpoint: "/auth" });

    try {
      const response = await this.fetchWithRetry<AuthResponse>(
        "POST",
        "/auth",
        request ?? {},
        AuthResponseSchema,
      );

      this.degraded = false;
      log.info("Authentication successful, clientId: {clientId}", {
        clientId: response.clientId,
      });

      return {
        clientId: response.clientId,
        effectiveMaxConcurrentTasks: response.effectiveMaxConcurrentTasks,
      };
    } catch (err) {
      log.error("Authentication failed: {error}", { error: String(err) });
      this.degraded = true;
      throw err;
    }
  }

  async syncRepo(repoId: string): Promise<void> {
    const log = logger.with({ repoId });
    const endpoint = `/repos/${repoId}/sync`;
    const body: SyncRepoRequest = { syncedAt: new Date().toISOString() };

    if (this.degraded) {
      log.debug("Degraded mode, queueing syncRepo");
      this.queueRequest("POST", endpoint, body);
      return;
    }

    try {
      await this.fetchWithRetry("POST", endpoint, body);
      log.debug("Repo synced");
    } catch (err) {
      log.warn("Sync failed, queueing: {error}", { error: String(err) });
      this.queueRequest("POST", endpoint, body);
    }
  }

  async syncTask(taskId: string, repoId: string, status: TaskStatus): Promise<void> {
    const log = logger.with({ taskId, status });
    const endpoint = `/tasks/${taskId}/sync`;
    const body: SyncTaskRequest = { repoId, status, syncedAt: new Date().toISOString() };

    if (this.degraded) {
      log.debug("Degraded mode, queueing syncTask");
      this.queueRequest("POST", endpoint, body);
      return;
    }

    try {
      await this.fetchWithRetry("POST", endpoint, body);
      log.debug("Task synced");
    } catch (err) {
      log.warn("Sync failed, queueing: {error}", { error: String(err) });
      this.queueRequest("POST", endpoint, body);
    }
  }

  async markTaskReady(
    taskId: string,
    repoId: string,
    options?: MarkReadyOptions,
  ): Promise<TaskReadyResponse> {
    const log = logger.with({ taskId, repoId });

    if (this.degraded) {
      log.info("Degraded mode, task stays READY locally");
      return { status: "READY", queued: true, message: "Offline, task queued locally" };
    }

    try {
      const body: TaskReadyRequest = { repoId };
      if (options?.workflowName) {
        body.workflowName = options.workflowName;
      }
      const response = await this.fetchWithRetry<TaskReadyResponse>(
        "POST",
        `/tasks/${taskId}/ready`,
        body,
        TaskReadyResponseSchema,
      );

      if (response.queued) {
        log.info("Task queued by server, tracking for retry");
        this.queuedReadyTasks.add(taskId);
      } else {
        this.queuedReadyTasks.delete(taskId);
      }

      return response;
    } catch (err) {
      log.error("markTaskReady failed: {error}", { error: String(err) });
      throw err;
    }
  }

  async completeStep(stepId: string, result: StepCompletePayload): Promise<StepCompleteResponse> {
    const log = logger.with({ stepId, executionId: result.executionId });

    try {
      const response = await this.fetchWithRetry<StepCompleteResponse>(
        "POST",
        `/steps/${stepId}/complete`,
        {
          executionId: result.executionId,
          attempt: result.attempt,
          status: result.status,
          signal: result.signal,
          error: result.error,
          durationMs: result.durationMs,
        } satisfies StepCompleteRequest,
        StepCompleteResponseSchema,
      );

      if (["DONE", "BLOCKED", "REMOVED"].includes(response.taskStatus)) {
        log.info("Task terminal state {taskStatus}, triggering queued task retry", {
          taskStatus: response.taskStatus,
        });
        this.triggerQueuedTaskRetry();
      }

      return response;
    } catch (err) {
      log.error("completeStep failed: {error}", { error: String(err) });
      throw err;
    }
  }

  async getTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    const log = logger.with({ taskId });

    try {
      const response = await this.fetchWithRetry<TaskStatusResponse>(
        "GET",
        `/tasks/${taskId}/status`,
        undefined,
        TaskStatusResponseSchema,
      );

      return response;
    } catch (err) {
      log.error("getTaskStatus failed: {error}", { error: String(err) });
      throw err;
    }
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  isTaskQueued(taskId: string): boolean {
    return this.queuedReadyTasks.has(taskId);
  }

  getQueuedReadyTasks(): string[] {
    return Array.from(this.queuedReadyTasks);
  }

  async retryQueuedReadyTasks(): Promise<void> {
    if (this.queuedReadyTasks.size === 0) return;

    logger.info("Retrying {count} queued ready tasks", { count: this.queuedReadyTasks.size });

    const taskIds = Array.from(this.queuedReadyTasks);
    for (const taskId of taskIds) {
      this.queuedReadyTasks.delete(taskId);
    }
  }

  async flushOfflineQueue(): Promise<void> {
    if (this.offlineQueue.length === 0) return;

    logger.info("Flushing {count} queued requests", { count: this.offlineQueue.length });

    const queue = [...this.offlineQueue];
    this.offlineQueue = [];

    for (const request of queue) {
      try {
        await this.doFetch(request.method, request.endpoint, request.body);
        logger.debug("Flushed request: {id}", { id: request.id });
      } catch (err) {
        logger.warn("Failed to flush request {id}: {error}", {
          id: request.id,
          error: String(err),
        });
      }
    }
  }

  getOfflineQueueSize(): number {
    return this.offlineQueue.length;
  }

  private queueRequest(method: "POST" | "GET", endpoint: string, body?: unknown): void {
    const id = `req_${++this.requestIdCounter}`;
    this.offlineQueue.push({ id, method, endpoint, body });
    logger.debug("Request queued: {id} {method} {endpoint}", { id, method, endpoint });
  }

  private triggerQueuedTaskRetry(): void {
    setImmediate(() => {
      this.retryQueuedReadyTasks().catch((err) => {
        logger.error("Queued task retry failed: {error}", { error: String(err) });
      });
    });
  }

  private async fetchWithRetry<T>(
    method: "POST" | "GET",
    endpoint: string,
    body?: unknown,
    schema?: { parse: (data: unknown) => T },
  ): Promise<T> {
    const result = await this.executeWithRetry(() => this.doFetch(method, endpoint, body));
    return schema ? schema.parse(result) : (result as T);
  }

  private async executeWithRetry(operation: () => Promise<unknown>): Promise<unknown> {
    let lastError: Error | null = null;
    let delay = this.config.initialRetryDelayMs;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const shouldRetry = attempt < this.config.maxRetries;

        if (shouldRetry) {
          logger.debug("Request failed, retrying in {delay}ms (attempt {attempt}/{max})", {
            delay,
            attempt,
            max: this.config.maxRetries,
            error: lastError.message,
          });
          await this.sleep(delay);
          delay *= 2;
        }
      }
    }

    throw lastError ?? new Error("Request failed after retries");
  }

  private async doFetch(
    method: "POST" | "GET",
    endpoint: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = `${this.config.serverUrl}${endpoint}`;

    const headers = injectTraceHeaders({
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
    });

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return response.json();
    }

    return { ok: true };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const createServerSync = (config: ServerSyncConfig): ServerSync => {
  return new ServerSyncImpl(config);
};

export const createDegradedServerSync = (): ServerSync => {
  return {
    authenticate: async () => {
      throw new Error("No API key configured");
    },
    syncRepo: async () => {},
    syncTask: async () => {},
    markTaskReady: async (_taskId, _repoId, _options) => ({
      status: "READY",
      queued: true,
      message: "Degraded mode, no server connection",
    }),
    completeStep: async () => {
      throw new Error("Cannot complete step in degraded mode");
    },
    getTaskStatus: async () => {
      throw new Error("Cannot get task status in degraded mode");
    },
    isDegraded: () => true,
    isTaskQueued: () => false,
    getQueuedReadyTasks: () => [],
    retryQueuedReadyTasks: async () => {},
    flushOfflineQueue: async () => {},
    getOfflineQueueSize: () => 0,
  };
};
