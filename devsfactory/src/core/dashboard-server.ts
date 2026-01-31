import type { EventEmitter } from "node:events";
import type { Server, ServerWebSocket } from "bun";
import { z } from "zod";

// Import the dashboard HTML for Bun's bundler
import dashboardHtml from "../../packages/dashboard/index.html";
import {
  type BrainstormDraft,
  type BrainstormSession,
  type OrchestratorState,
  type Plan,
  type ProjectConfig,
  type Subtask,
  type SubtaskPreview,
  SubtaskPreviewSchema,
  type SubtaskStatus,
  SubtaskStatusSchema,
  type Task,
  type TaskPreview,
  type TaskStatus,
  TaskStatusSchema
} from "../types";

export interface ProjectScanResult {
  tasks: Task[];
  plans: Record<string, Plan>;
  subtasks: Record<string, Subtask[]>;
}

export interface OrchestratorLike extends EventEmitter {
  getState(): OrchestratorState;
  getActiveAgents(): Promise<unknown[]>;
}

export interface DraftStorageLike {
  saveDraft(draft: BrainstormDraft): Promise<void>;
  loadDraft(sessionId: string): Promise<BrainstormDraft | null>;
  listDrafts(): Promise<BrainstormDraft[]>;
  deleteDraft(sessionId: string): Promise<void>;
}

export interface BrainstormManagerLike extends EventEmitter {
  startSession(initialMessage?: string): Promise<BrainstormSession>;
  sendMessage(sessionId: string, message: string): Promise<void>;
  endSession(sessionId: string): Promise<void>;
  getSession(sessionId: string): BrainstormSession | undefined;
}

export interface DashboardServerOptions {
  port: number;
  devsfactoryDir?: string;
  updateTaskStatus?: (
    folder: string,
    status: TaskStatus,
    devsfactoryDir: string
  ) => Promise<void>;
  updateSubtaskStatus?: (
    folder: string,
    file: string,
    status: SubtaskStatus,
    devsfactoryDir: string
  ) => Promise<void>;
  createPr?: (folder: string) => Promise<{ prUrl: string }>;
  getDiff?: (folder: string) => Promise<{ diff: string }>;
  getSubtaskLogs?: (
    folder: string,
    file: string
  ) => Promise<{ logs: string[] }>;
  brainstormManager?: BrainstormManagerLike;
  draftStorage?: DraftStorageLike;
  createTask?: (
    taskPreview: TaskPreview,
    subtasks?: SubtaskPreview[]
  ) => Promise<{ taskFolder: string }>;
  listProjects?: () => Promise<ProjectConfig[]>;
  getProject?: (name: string) => Promise<ProjectConfig | null>;
  scanProject?: (projectName: string) => Promise<ProjectScanResult>;
  currentProjectName?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "http://localhost:3001",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  Vary: "Origin"
};

const getCorsHeaders = (origin?: string | null): Record<string, string> => {
  if (origin && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
    return { ...CORS_HEADERS, "Access-Control-Allow-Origin": origin };
  }
  return CORS_HEADERS;
};

const UpdateTaskStatusBodySchema = z.object({ status: TaskStatusSchema });
const UpdateSubtaskStatusBodySchema = z.object({ status: SubtaskStatusSchema });

const StartBrainstormBodySchema = z.object({
  initialMessage: z.string().optional()
});

const SendMessageBodySchema = z.object({
  content: z.string().min(1)
});

const ApproveBrainstormBodySchema = z.object({
  taskTitle: z.string().min(1),
  editedSubtasks: z.array(SubtaskPreviewSchema).optional()
});

const jsonResponse = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: CORS_HEADERS });

const errorResponse = (err: unknown, status = 500) =>
  jsonResponse(
    { error: err instanceof Error ? err.message : String(err) },
    status
  );

type WebSocketData = { id: string };
type EventHandler = (...args: unknown[]) => void;

export class DashboardServer {
  private server: Server<WebSocketData> | null = null;
  private orchestrator: OrchestratorLike;
  private options: DashboardServerOptions;
  private connectedClients = new Set<ServerWebSocket<WebSocketData>>();
  private eventHandlers: Array<{ event: string; handler: EventHandler }> = [];

  constructor(orchestrator: OrchestratorLike, options: DashboardServerOptions) {
    this.orchestrator = orchestrator;
    this.options = options;
  }

  get port(): number {
    return this.server?.port ?? 0;
  }

  async start(): Promise<void> {
    const maxPortAttempts = 10;
    let port = this.options.port;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxPortAttempts; attempt++) {
      try {
        this.server = Bun.serve({
          port,
          routes: {
            "/": dashboardHtml
          },
          fetch: (req, server) => this.handleRequest(req, server),
          websocket: {
            open: (ws: ServerWebSocket<WebSocketData>) => {
              this.connectedClients.add(ws);
              const state = this.orchestrator.getState();
              const message: {
                type: string;
                data: OrchestratorState;
                projectName?: string;
              } = { type: "state", data: state };
              if (this.options.currentProjectName) {
                message.projectName = this.options.currentProjectName;
              }
              ws.send(JSON.stringify(message));
            },
            message: () => {},
            close: (ws: ServerWebSocket<WebSocketData>) => {
              this.connectedClients.delete(ws);
            }
          }
        });

        this.subscribeToOrchestratorEvents();
        return;
      } catch (err) {
        lastError = err as Error;
        const isPortInUse =
          lastError.message?.includes("EADDRINUSE") ||
          lastError.message?.includes("address already in use") ||
          (lastError as NodeJS.ErrnoException).code === "EADDRINUSE";

        if (!isPortInUse) {
          throw lastError;
        }
        port++;
      }
    }

    throw new Error(
      `Failed to start server. Ports ${this.options.port}-${port - 1} are all in use.`
    );
  }

  async stop(): Promise<void> {
    this.unsubscribeFromOrchestratorEvents();

    for (const client of this.connectedClients) {
      client.close();
    }
    this.connectedClients.clear();

    this.server?.stop(true);
    this.server = null;
  }

  private subscribeToOrchestratorEvents(): void {
    const stateHandler: EventHandler = () => {
      const message: {
        type: string;
        data: OrchestratorState;
        projectName?: string;
      } = { type: "state", data: this.orchestrator.getState() };
      if (this.options.currentProjectName) {
        message.projectName = this.options.currentProjectName;
      }
      this.broadcast(message);
    };
    this.orchestrator.on("stateChanged", stateHandler);
    this.eventHandlers.push({ event: "stateChanged", handler: stateHandler });

    const jobFailedHandler: EventHandler = (data) => {
      this.broadcast({ type: "jobFailed", ...(data as object) });
    };
    this.orchestrator.on("workerJobFailed", jobFailedHandler);
    this.eventHandlers.push({
      event: "workerJobFailed",
      handler: jobFailedHandler
    });

    const jobRetryingHandler: EventHandler = (data) => {
      this.broadcast({ type: "jobRetrying", ...(data as object) });
    };
    this.orchestrator.on("workerJobRetrying", jobRetryingHandler);
    this.eventHandlers.push({
      event: "workerJobRetrying",
      handler: jobRetryingHandler
    });

    this.subscribeToBrainstormEvents();
  }

  private subscribeToBrainstormEvents(): void {
    const manager = this.options.brainstormManager;
    if (!manager) return;

    const sessionStartedHandler: EventHandler = (data) => {
      const { sessionId, agentId } = data as {
        sessionId: string;
        agentId: string;
      };
      this.broadcast({ type: "brainstormStarted", sessionId, agentId });
    };
    manager.on("sessionStarted", sessionStartedHandler);
    this.eventHandlers.push({
      event: "sessionStarted",
      handler: sessionStartedHandler
    });

    const messageHandler: EventHandler = (data) => {
      const { sessionId, message } = data as {
        sessionId: string;
        message: unknown;
      };
      this.broadcast({ type: "brainstormMessage", sessionId, message });
    };
    manager.on("message", messageHandler);
    this.eventHandlers.push({ event: "message", handler: messageHandler });

    const completeHandler: EventHandler = (data) => {
      const { sessionId, taskPreview } = data as {
        sessionId: string;
        taskPreview: unknown;
      };
      this.broadcast({ type: "brainstormComplete", sessionId, taskPreview });
    };
    manager.on("brainstormComplete", completeHandler);
    this.eventHandlers.push({
      event: "brainstormComplete",
      handler: completeHandler
    });

    const errorHandler: EventHandler = (data) => {
      const { sessionId, error } = data as { sessionId: string; error: Error };
      this.broadcast({
        type: "brainstormError",
        sessionId,
        error: error.message
      });
    };
    manager.on("error", errorHandler);
    this.eventHandlers.push({ event: "error", handler: errorHandler });
  }

  private unsubscribeFromOrchestratorEvents(): void {
    for (const { event, handler } of this.eventHandlers) {
      this.orchestrator.off(event, handler);
      this.options.brainstormManager?.off(event, handler);
    }
    this.eventHandlers = [];
  }

  private broadcast(message: unknown): void {
    const data = JSON.stringify(message);
    for (const client of this.connectedClients) {
      client.send(data);
    }
  }

  private handleRequest(
    req: Request,
    server: Server<WebSocketData>
  ): Response | Promise<Response> | undefined {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin");
    const corsHeaders = getCorsHeaders(origin);

    if (url.pathname === "/api/events") {
      const upgraded = server.upgrade(req, {
        data: { id: crypto.randomUUID() }
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", {
        status: 400,
        headers: corsHeaders
      });
    }

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    if (url.pathname === "/api/state" && req.method === "GET") {
      return this.handleGetState();
    }

    const taskStatusMatch = url.pathname.match(
      /^\/api\/tasks\/([^/]+)\/status$/
    );
    if (taskStatusMatch?.[1] && req.method === "POST") {
      return this.handleUpdateTaskStatus(
        req,
        decodeURIComponent(taskStatusMatch[1])
      );
    }

    const subtaskStatusMatch = url.pathname.match(
      /^\/api\/subtasks\/([^/]+)\/([^/]+)\/status$/
    );
    if (
      subtaskStatusMatch?.[1] &&
      subtaskStatusMatch[2] &&
      req.method === "POST"
    ) {
      return this.handleUpdateSubtaskStatus(
        req,
        decodeURIComponent(subtaskStatusMatch[1]),
        decodeURIComponent(subtaskStatusMatch[2])
      );
    }

    const createPrMatch = url.pathname.match(
      /^\/api\/tasks\/([^/]+)\/create-pr$/
    );
    if (createPrMatch?.[1] && req.method === "POST") {
      return this.handleCreatePr(decodeURIComponent(createPrMatch[1]));
    }

    const diffMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/diff$/);
    if (diffMatch?.[1] && req.method === "GET") {
      return this.handleGetDiff(decodeURIComponent(diffMatch[1]));
    }

    const logsMatch = url.pathname.match(
      /^\/api\/tasks\/([^/]+)\/subtasks\/([^/]+)\/logs$/
    );
    if (logsMatch?.[1] && logsMatch[2] && req.method === "GET") {
      return this.handleGetSubtaskLogs(
        decodeURIComponent(logsMatch[1]),
        decodeURIComponent(logsMatch[2])
      );
    }

    // Brainstorm API endpoints
    if (url.pathname === "/api/brainstorm/start" && req.method === "POST") {
      return this.handleStartBrainstorm(req);
    }

    if (url.pathname === "/api/brainstorm/drafts" && req.method === "GET") {
      return this.handleListDrafts();
    }

    const brainstormMessageMatch = url.pathname.match(
      /^\/api\/brainstorm\/([^/]+)\/message$/
    );
    if (brainstormMessageMatch?.[1] && req.method === "POST") {
      return this.handleBrainstormMessage(
        req,
        decodeURIComponent(brainstormMessageMatch[1])
      );
    }

    const brainstormEndMatch = url.pathname.match(
      /^\/api\/brainstorm\/([^/]+)\/end$/
    );
    if (brainstormEndMatch?.[1] && req.method === "POST") {
      return this.handleEndBrainstorm(
        decodeURIComponent(brainstormEndMatch[1])
      );
    }

    const brainstormApproveMatch = url.pathname.match(
      /^\/api\/brainstorm\/([^/]+)\/approve$/
    );
    if (brainstormApproveMatch?.[1] && req.method === "POST") {
      return this.handleApproveBrainstorm(
        req,
        decodeURIComponent(brainstormApproveMatch[1])
      );
    }

    const draftResumeMatch = url.pathname.match(
      /^\/api\/brainstorm\/drafts\/([^/]+)\/resume$/
    );
    if (draftResumeMatch?.[1] && req.method === "POST") {
      return this.handleResumeDraft(decodeURIComponent(draftResumeMatch[1]));
    }

    const draftDeleteMatch = url.pathname.match(
      /^\/api\/brainstorm\/drafts\/([^/]+)$/
    );
    if (draftDeleteMatch?.[1] && req.method === "DELETE") {
      return this.handleDeleteDraft(decodeURIComponent(draftDeleteMatch[1]));
    }

    // Multi-project API endpoints
    if (url.pathname === "/api/projects" && req.method === "GET") {
      return this.handleListProjects();
    }

    if (url.pathname === "/api/tasks" && req.method === "GET") {
      return this.handleGetAllTasks();
    }

    const projectTasksMatch = url.pathname.match(
      /^\/api\/projects\/([^/]+)\/tasks$/
    );
    if (projectTasksMatch?.[1] && req.method === "GET") {
      return this.handleGetProjectTasks(
        decodeURIComponent(projectTasksMatch[1])
      );
    }

    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch?.[1] && req.method === "GET") {
      return this.handleGetProject(decodeURIComponent(projectMatch[1]));
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }

  private handleGetState(): Response {
    return jsonResponse(this.orchestrator.getState());
  }

  private async handleUpdateTaskStatus(
    req: Request,
    folder: string
  ): Promise<Response> {
    try {
      const body = await req.json();
      const parsed = UpdateTaskStatusBodySchema.safeParse(body);
      if (!parsed.success) {
        return jsonResponse({ error: parsed.error.message }, 400);
      }

      if (this.options.updateTaskStatus && this.options.devsfactoryDir) {
        await this.options.updateTaskStatus(
          folder,
          parsed.data.status,
          this.options.devsfactoryDir
        );
      }

      return jsonResponse({ success: true });
    } catch (err) {
      return errorResponse(err);
    }
  }

  private async handleUpdateSubtaskStatus(
    req: Request,
    folder: string,
    file: string
  ): Promise<Response> {
    try {
      const body = await req.json();
      const parsed = UpdateSubtaskStatusBodySchema.safeParse(body);
      if (!parsed.success) {
        return jsonResponse({ error: parsed.error.message }, 400);
      }

      if (this.options.updateSubtaskStatus && this.options.devsfactoryDir) {
        await this.options.updateSubtaskStatus(
          folder,
          file,
          parsed.data.status,
          this.options.devsfactoryDir
        );
      }

      return jsonResponse({ success: true });
    } catch (err) {
      return errorResponse(err);
    }
  }

  private async handleCreatePr(folder: string): Promise<Response> {
    try {
      if (!this.options.createPr) {
        return errorResponse("PR creation not configured");
      }
      return jsonResponse(await this.options.createPr(folder));
    } catch (err) {
      return errorResponse(err);
    }
  }

  private async handleGetDiff(folder: string): Promise<Response> {
    try {
      if (!this.options.getDiff) {
        return errorResponse("Diff retrieval not configured");
      }
      return jsonResponse(await this.options.getDiff(folder));
    } catch (err) {
      return errorResponse(err);
    }
  }

  private async handleGetSubtaskLogs(
    folder: string,
    file: string
  ): Promise<Response> {
    try {
      if (!this.options.getSubtaskLogs) {
        return errorResponse("Logs retrieval not configured");
      }
      return jsonResponse(await this.options.getSubtaskLogs(folder, file));
    } catch (err) {
      return errorResponse(err);
    }
  }

  private async handleStartBrainstorm(req: Request): Promise<Response> {
    try {
      if (!this.options.brainstormManager) {
        return errorResponse("Brainstorm manager not configured");
      }

      const body = await req.json();
      const parsed = StartBrainstormBodySchema.safeParse(body);
      if (!parsed.success) {
        return jsonResponse({ error: parsed.error.message }, 400);
      }

      const session = await this.options.brainstormManager.startSession(
        parsed.data.initialMessage
      );

      return jsonResponse({ sessionId: session.id });
    } catch (err) {
      return errorResponse(err);
    }
  }

  private async handleBrainstormMessage(
    req: Request,
    sessionId: string
  ): Promise<Response> {
    try {
      if (!this.options.brainstormManager) {
        return errorResponse("Brainstorm manager not configured");
      }

      const session = this.options.brainstormManager.getSession(sessionId);
      if (!session) {
        return jsonResponse({ error: "Session not found" }, 404);
      }

      const body = await req.json();
      const parsed = SendMessageBodySchema.safeParse(body);
      if (!parsed.success) {
        return jsonResponse({ error: parsed.error.message }, 400);
      }

      await this.options.brainstormManager.sendMessage(
        sessionId,
        parsed.data.content
      );

      return jsonResponse({ success: true });
    } catch (err) {
      return errorResponse(err);
    }
  }

  private async handleEndBrainstorm(sessionId: string): Promise<Response> {
    try {
      if (!this.options.brainstormManager) {
        return errorResponse("Brainstorm manager not configured");
      }

      const session = this.options.brainstormManager.getSession(sessionId);
      if (!session) {
        return jsonResponse({ error: "Session not found" }, 404);
      }

      let draftId: string | undefined;

      if (this.options.draftStorage && session.messages.length > 0) {
        const draft: BrainstormDraft = {
          sessionId: session.id,
          messages: session.messages,
          partialTaskData: session.taskPreview ?? {},
          status: session.status,
          createdAt: session.createdAt,
          updatedAt: new Date()
        };
        await this.options.draftStorage.saveDraft(draft);
        draftId = session.id;
      }

      await this.options.brainstormManager.endSession(sessionId);

      return jsonResponse({ success: true, draftId });
    } catch (err) {
      return errorResponse(err);
    }
  }

  private async handleListDrafts(): Promise<Response> {
    try {
      if (!this.options.draftStorage) {
        return errorResponse("Draft storage not configured");
      }

      const drafts = await this.options.draftStorage.listDrafts();
      return jsonResponse({ drafts });
    } catch (err) {
      return errorResponse(err);
    }
  }

  private async handleResumeDraft(sessionId: string): Promise<Response> {
    try {
      if (!this.options.draftStorage) {
        return errorResponse("Draft storage not configured");
      }
      if (!this.options.brainstormManager) {
        return errorResponse("Brainstorm manager not configured");
      }

      const draft = await this.options.draftStorage.loadDraft(sessionId);
      if (!draft) {
        return jsonResponse({ error: "Draft not found" }, 404);
      }

      const lastUserMessage = draft.messages
        .filter((m) => m.role === "user")
        .pop();
      const resumeContext = lastUserMessage?.content;

      const session =
        await this.options.brainstormManager.startSession(resumeContext);

      await this.options.draftStorage.deleteDraft(sessionId);

      return jsonResponse({ sessionId: session.id });
    } catch (err) {
      return errorResponse(err);
    }
  }

  private async handleDeleteDraft(sessionId: string): Promise<Response> {
    try {
      if (!this.options.draftStorage) {
        return errorResponse("Draft storage not configured");
      }

      await this.options.draftStorage.deleteDraft(sessionId);
      return jsonResponse({ success: true });
    } catch (err) {
      return errorResponse(err);
    }
  }

  private async handleApproveBrainstorm(
    req: Request,
    sessionId: string
  ): Promise<Response> {
    try {
      if (!this.options.brainstormManager) {
        return errorResponse("Brainstorm manager not configured");
      }

      const session = this.options.brainstormManager.getSession(sessionId);
      if (!session) {
        return jsonResponse({ error: "Session not found" }, 404);
      }

      const body = await req.json();
      const parsed = ApproveBrainstormBodySchema.safeParse(body);
      if (!parsed.success) {
        return jsonResponse({ error: parsed.error.message }, 400);
      }

      if (!this.options.createTask) {
        return errorResponse("Task creation not configured");
      }

      const taskPreview: TaskPreview = session.taskPreview ?? {
        title: parsed.data.taskTitle,
        description: "",
        requirements: "",
        acceptanceCriteria: []
      };

      const result = await this.options.createTask(
        { ...taskPreview, title: parsed.data.taskTitle },
        parsed.data.editedSubtasks
      );

      await this.options.brainstormManager.endSession(sessionId);

      if (this.options.draftStorage) {
        await this.options.draftStorage.deleteDraft(sessionId).catch(() => {});
      }

      this.broadcast({
        type: "taskCreated",
        sessionId,
        taskFolder: result.taskFolder
      });

      return jsonResponse({ success: true, taskFolder: result.taskFolder });
    } catch (err) {
      return errorResponse(err);
    }
  }

  private async handleListProjects(): Promise<Response> {
    try {
      if (!this.options.listProjects) {
        return errorResponse("Project listing not configured");
      }

      const projects = await this.options.listProjects();
      const projectsWithTaskCount = await Promise.all(
        projects.map(async (project) => {
          let taskCount = 0;
          if (this.options.scanProject) {
            const scanResult = await this.options.scanProject(project.name);
            taskCount = scanResult.tasks.length;
          }
          return {
            name: project.name,
            path: project.path,
            registered: project.registered,
            taskCount
          };
        })
      );

      return jsonResponse({ projects: projectsWithTaskCount });
    } catch (err) {
      return errorResponse(err);
    }
  }

  private async handleGetProject(name: string): Promise<Response> {
    try {
      if (!this.options.getProject) {
        return errorResponse("Project retrieval not configured");
      }

      const project = await this.options.getProject(name);
      if (!project) {
        return jsonResponse({ error: `Project '${name}' not found` }, 404);
      }

      let state: ProjectScanResult = { tasks: [], plans: {}, subtasks: {} };
      if (this.options.scanProject) {
        state = await this.options.scanProject(name);
      }

      return jsonResponse({ project, state });
    } catch (err) {
      return errorResponse(err);
    }
  }

  private async handleGetProjectTasks(name: string): Promise<Response> {
    try {
      if (!this.options.getProject) {
        return errorResponse("Project retrieval not configured");
      }

      const project = await this.options.getProject(name);
      if (!project) {
        return jsonResponse({ error: `Project '${name}' not found` }, 404);
      }

      if (!this.options.scanProject) {
        return jsonResponse({ tasks: [], plans: {}, subtasks: {} });
      }

      const result = await this.options.scanProject(name);
      return jsonResponse(result);
    } catch (err) {
      return errorResponse(err);
    }
  }

  private async handleGetAllTasks(): Promise<Response> {
    try {
      if (!this.options.listProjects) {
        return errorResponse("Project listing not configured");
      }

      const projects = await this.options.listProjects();
      const projectsData: Record<string, ProjectScanResult> = {};

      for (const project of projects) {
        if (this.options.scanProject) {
          projectsData[project.name] = await this.options.scanProject(
            project.name
          );
        } else {
          projectsData[project.name] = { tasks: [], plans: {}, subtasks: {} };
        }
      }

      return jsonResponse({ projects: projectsData });
    } catch (err) {
      return errorResponse(err);
    }
  }
}
