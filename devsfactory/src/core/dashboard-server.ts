import type { EventEmitter } from "node:events";
import type { Server, ServerWebSocket } from "bun";
import { z } from "zod";

// Import the dashboard HTML for Bun's bundler
import dashboardHtml from "../../packages/dashboard/index.html";
import {
  type OrchestratorState,
  type SubtaskStatus,
  SubtaskStatusSchema,
  type TaskStatus,
  TaskStatusSchema
} from "../types";

export interface OrchestratorLike extends EventEmitter {
  getState(): OrchestratorState;
  getActiveAgents(): Promise<unknown[]>;
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
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const UpdateTaskStatusBodySchema = z.object({ status: TaskStatusSchema });
const UpdateSubtaskStatusBodySchema = z.object({ status: SubtaskStatusSchema });

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
    this.server = Bun.serve({
      port: this.options.port,
      routes: {
        "/": dashboardHtml
      },
      fetch: (req, server) => this.handleRequest(req, server),
      websocket: {
        open: (ws: ServerWebSocket<WebSocketData>) => {
          this.connectedClients.add(ws);
          const state = this.orchestrator.getState();
          ws.send(JSON.stringify({ type: "state", data: state }));
        },
        message: () => {},
        close: (ws: ServerWebSocket<WebSocketData>) => {
          this.connectedClients.delete(ws);
        }
      }
    });

    this.subscribeToOrchestratorEvents();
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
      this.broadcast({ type: "state", data: this.orchestrator.getState() });
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
  }

  private unsubscribeFromOrchestratorEvents(): void {
    for (const { event, handler } of this.eventHandlers) {
      this.orchestrator.off(event, handler);
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

    if (url.pathname === "/api/events") {
      const upgraded = server.upgrade(req, {
        data: { id: crypto.randomUUID() }
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", {
        status: 400,
        headers: CORS_HEADERS
      });
    }

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    if (url.pathname === "/api/state" && req.method === "GET") {
      return this.handleGetState();
    }

    const taskStatusMatch = url.pathname.match(
      /^\/api\/tasks\/([^/]+)\/status$/
    );
    if (taskStatusMatch && req.method === "POST") {
      return this.handleUpdateTaskStatus(req, taskStatusMatch[1]!);
    }

    const subtaskStatusMatch = url.pathname.match(
      /^\/api\/subtasks\/([^/]+)\/([^/]+)\/status$/
    );
    if (subtaskStatusMatch && req.method === "POST") {
      return this.handleUpdateSubtaskStatus(
        req,
        subtaskStatusMatch[1]!,
        subtaskStatusMatch[2]!
      );
    }

    const createPrMatch = url.pathname.match(
      /^\/api\/tasks\/([^/]+)\/create-pr$/
    );
    if (createPrMatch && req.method === "POST") {
      return this.handleCreatePr(createPrMatch[1]!);
    }

    const diffMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/diff$/);
    if (diffMatch && req.method === "GET") {
      return this.handleGetDiff(diffMatch[1]!);
    }

    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
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
}
