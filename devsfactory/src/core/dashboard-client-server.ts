import type { Server, ServerWebSocket, Subprocess } from "bun";
import dashboardHtml from "../../packages/dashboard/index.html";
import { getLogger } from "../infra/logger";
import type { SubtaskStatus, TaskStatus } from "../types";
import { createSimpleTask, ensureProjectRecord } from "./sqlite";
import { getProjectByName, listProjects } from "./sqlite/project-store";
import { SQLiteTaskStorage } from "./sqlite/sqlite-task-storage";

const log = getLogger("dashboard-client");

export interface DashboardClientServerOptions {
  port: number;
  serverUrl: string;
}

type WebSocketData = { id: string };

/**
 * DashboardClientServer serves the dashboard UI locally and proxies
 * WebSocket/API connections to a remote AOP server.
 */
export class DashboardClientServer {
  private server: Server<WebSocketData> | null = null;
  private options: DashboardClientServerOptions;
  private connectedClients = new Set<ServerWebSocket<WebSocketData>>();
  private remoteSocket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private createTaskProcesses = new Map<string, Subprocess>();

  constructor(options: DashboardClientServerOptions) {
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
              log.debug(`Dashboard client connected: ${ws.data.id}`);
            },
            message: (
              _ws: ServerWebSocket<WebSocketData>,
              _message: string
            ) => {
              // Dashboard clients only receive, they don't send commands
            },
            close: (ws: ServerWebSocket<WebSocketData>) => {
              this.connectedClients.delete(ws);
              log.debug(`Dashboard client disconnected: ${ws.data.id}`);
            }
          }
        });

        // Connect to remote server
        await this.connectToRemoteServer();
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
    this.stopped = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.remoteSocket) {
      this.remoteSocket.close();
      this.remoteSocket = null;
    }

    for (const client of this.connectedClients) {
      client.close();
    }
    this.connectedClients.clear();

    for (const process of this.createTaskProcesses.values()) {
      try {
        process.kill();
      } catch {
        // Ignore kill errors
      }
    }
    this.createTaskProcesses.clear();

    this.server?.stop(true);
    this.server = null;
  }

  private async connectToRemoteServer(): Promise<void> {
    const wsUrl = `${this.options.serverUrl.replace(/^http/, "ws")}/api/events`;
    log.info(`Connecting to remote server: ${wsUrl}`);

    return new Promise((resolve, reject) => {
      try {
        this.remoteSocket = new WebSocket(wsUrl);

        const connectTimeout = setTimeout(() => {
          if (
            this.remoteSocket &&
            this.remoteSocket.readyState !== WebSocket.OPEN
          ) {
            this.remoteSocket.close();
            reject(new Error("Connection timeout"));
          }
        }, 10000);

        this.remoteSocket.onopen = () => {
          clearTimeout(connectTimeout);
          log.info("Connected to remote server");
          resolve();
        };

        this.remoteSocket.onmessage = (event) => {
          // Broadcast to all local dashboard clients
          const data =
            typeof event.data === "string" ? event.data : String(event.data);
          this.broadcast(data);
        };

        this.remoteSocket.onclose = () => {
          log.info("Disconnected from remote server");
          this.remoteSocket = null;
          this.scheduleReconnect();
        };

        this.remoteSocket.onerror = () => {
          clearTimeout(connectTimeout);
          const error = new Error("WebSocket connection error");
          log.error(error.message);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;

    if (this.reconnectTimer) return;

    log.info("Scheduling reconnect in 5 seconds...");
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.stopped) return;

      try {
        await this.connectToRemoteServer();
      } catch (error) {
        log.error(
          `Reconnect failed: ${error instanceof Error ? error.message : String(error)}`
        );
        this.scheduleReconnect();
      }
    }, 5000);
  }

  private broadcast(data: string): void {
    for (const client of this.connectedClients) {
      client.send(data);
    }
  }

  private handleRequest(
    req: Request,
    server: Server<WebSocketData>
  ): Response | Promise<Response> | undefined {
    const url = new URL(req.url);

    // WebSocket upgrade for local dashboard clients
    if (url.pathname === "/api/events") {
      const upgraded = server.upgrade(req, {
        data: { id: crypto.randomUUID() }
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Handle local task creation for agent machine
    if (url.pathname === "/api/tasks/create" && req.method === "POST") {
      return this.handleCreateTask(req);
    }

    if (url.pathname === "/api/tasks/create-cli" && req.method === "POST") {
      return this.handleCreateTaskCli(req);
    }

    if (
      url.pathname === "/api/tasks/create-cli/input" &&
      req.method === "POST"
    ) {
      return this.handleCreateTaskCliInput(req);
    }

    if (
      url.pathname.match(/^\/api\/tasks\/[^/]+\/status$/) &&
      req.method === "POST"
    ) {
      return this.handleUpdateTaskStatus(req, url.pathname);
    }

    if (
      url.pathname.match(/^\/api\/subtasks\/[^/]+\/[^/]+\/status$/) &&
      req.method === "POST"
    ) {
      return this.handleUpdateSubtaskStatus(req, url.pathname);
    }

    // Handle local project listing
    if (url.pathname === "/api/projects" && req.method === "GET") {
      return this.handleListProjects();
    }

    // Handle local task listing from SQLite
    if (url.pathname === "/api/tasks" && req.method === "GET") {
      const projectName = url.searchParams.get("project");
      return this.handleListTasks(projectName);
    }

    // Handle subtask logs - return empty for now (logs stored elsewhere)
    const logsMatch = url.pathname.match(
      /^\/api\/tasks\/([^/]+)\/subtasks\/([^/]+)\/logs$/
    );
    if (logsMatch && req.method === "GET") {
      return new Response(JSON.stringify({ logs: [] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    // Proxy API requests to remote server
    if (url.pathname.startsWith("/api/")) {
      return this.proxyRequest(req);
    }

    return new Response("Not Found", { status: 404 });
  }

  private async proxyRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const targetUrl = `${this.options.serverUrl}${url.pathname}${url.search}`;

    try {
      const headers = new Headers(req.headers);
      // Remove hop-by-hop headers
      headers.delete("connection");
      headers.delete("keep-alive");
      headers.delete("upgrade");

      const response = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: req.body
      });

      // Copy response headers
      const responseHeaders = new Headers(response.headers);
      // Update CORS headers for local access
      responseHeaders.set("Access-Control-Allow-Origin", "*");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    } catch (error) {
      log.error(
        `Proxy error: ${error instanceof Error ? error.message : String(error)}`
      );
      return new Response(
        JSON.stringify({
          error: "Failed to proxy request to server"
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  }

  private async handleCreateTask(req: Request): Promise<Response> {
    try {
      const body = (await req.json()) as {
        description?: string;
        projectName?: string;
      };

      if (!body?.description || !body?.projectName) {
        return new Response(
          JSON.stringify({ error: "description and projectName are required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const project = getProjectByName(body.projectName);
      if (!project) {
        return new Response(
          JSON.stringify({ error: `Project '${body.projectName}' not found` }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      ensureProjectRecord({
        name: project.name,
        path: project.path,
        gitRemote: project.gitRemote ?? null
      });

      const result = await createSimpleTask({
        projectName: project.name,
        description: body.description
      });

      return new Response(
        JSON.stringify({
          success: true,
          taskFolder: result.taskFolder,
          taskId: result.taskId
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error) {
      log.error(
        `Create task error: ${error instanceof Error ? error.message : String(error)}`
      );
      return new Response(JSON.stringify({ error: "Failed to create task" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  private async handleCreateTaskCli(req: Request): Promise<Response> {
    try {
      const body = (await req.json()) as {
        description?: string;
        projectName?: string;
      };

      if (!body?.description || !body?.projectName) {
        return new Response(
          JSON.stringify({ error: "description and projectName are required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const project = getProjectByName(body.projectName);
      if (!project) {
        return new Response(
          JSON.stringify({ error: `Project '${body.projectName}' not found` }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      const runId = crypto.randomUUID();
      this.broadcast(
        JSON.stringify({
          type: "taskCreateStarted",
          runId,
          projectName: project.name,
          description: body.description
        })
      );

      const proc = Bun.spawn({
        cmd: [
          "aop",
          "create-task",
          "-d", // Enable debug logging for troubleshooting
          body.description,
          "--project",
          project.name
        ],
        cwd: project.path,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
        env: {
          ...process.env,
          DEBUG: "true" // Enable logger debug output
        }
      });

      this.createTaskProcesses.set(runId, proc);

      const emitLine = (line: string, stream: "stdout" | "stderr") => {
        const trimmed = line.trim();
        if (!trimmed) return;
        this.broadcast(
          JSON.stringify({
            type: "taskCreateOutput",
            runId,
            stream,
            line: trimmed
          })
        );
      };

      const readStream = async (
        stream: ReadableStream<Uint8Array> | null,
        name: "stdout" | "stderr"
      ) => {
        if (!stream) return;
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          buffer += decoder.decode(result.value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) emitLine(line, name);
        }
        if (buffer) emitLine(buffer, name);
      };

      const finalize = async () => {
        try {
          await proc.exited;
        } finally {
          this.createTaskProcesses.delete(runId);
        }
        this.broadcast(
          JSON.stringify({
            type: "taskCreateCompleted",
            runId,
            exitCode: proc.exitCode ?? null
          })
        );
      };

      void readStream(proc.stdout, "stdout");
      void readStream(proc.stderr, "stderr");
      void finalize();

      return new Response(JSON.stringify({ success: true, runId }), {
        status: 202,
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      log.error(
        `Create task CLI error: ${error instanceof Error ? error.message : String(error)}`
      );
      return new Response(JSON.stringify({ error: "Failed to create task" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  private async handleCreateTaskCliInput(req: Request): Promise<Response> {
    try {
      const body = (await req.json()) as {
        runId?: string;
        line?: string;
      };

      if (!body?.runId || body.line === undefined) {
        return new Response(
          JSON.stringify({ error: "runId and line are required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const proc = this.createTaskProcesses.get(body.runId);
      if (!proc) {
        return new Response(
          JSON.stringify({ error: "Task create session not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      const stdin = proc.stdin;
      if (!stdin || typeof stdin === "number") {
        return new Response(
          JSON.stringify({ error: "Task create session is not writable" }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        );
      }

      const payload = `${body.line}\n`;
      await stdin.write(new TextEncoder().encode(payload));
      await stdin.flush();

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      log.error(
        `Create task CLI input error: ${error instanceof Error ? error.message : String(error)}`
      );
      return new Response(JSON.stringify({ error: "Failed to send input" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  private async handleUpdateTaskStatus(
    req: Request,
    path: string
  ): Promise<Response> {
    try {
      const body = (await req.json()) as {
        status?: string;
        projectName?: string;
      };
      const folderMatch = path.match(/^\/api\/tasks\/([^/]+)\/status$/);
      const folder = folderMatch ? decodeURIComponent(folderMatch[1]!) : null;
      if (!folder || !body?.status || !body?.projectName) {
        return new Response(
          JSON.stringify({ error: "folder, status, projectName are required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const storage = new SQLiteTaskStorage({ projectName: body.projectName });
      await storage.updateTaskStatus(folder, body.status as TaskStatus);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      log.error(
        `Update task status error: ${error instanceof Error ? error.message : String(error)}`
      );
      return new Response(JSON.stringify({ error: "Failed to update task" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  private async handleUpdateSubtaskStatus(
    req: Request,
    path: string
  ): Promise<Response> {
    try {
      const body = (await req.json()) as {
        status?: string;
        projectName?: string;
      };
      const match = path.match(/^\/api\/subtasks\/([^/]+)\/([^/]+)\/status$/);
      const folder = match ? decodeURIComponent(match[1]!) : null;
      const file = match ? decodeURIComponent(match[2]!) : null;
      if (!folder || !file || !body?.status || !body?.projectName) {
        return new Response(
          JSON.stringify({
            error: "folder, file, status, projectName are required"
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const storage = new SQLiteTaskStorage({ projectName: body.projectName });
      await storage.updateSubtaskStatus(
        folder,
        file,
        body.status as SubtaskStatus
      );
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      log.error(
        `Update subtask status error: ${error instanceof Error ? error.message : String(error)}`
      );
      return new Response(
        JSON.stringify({ error: "Failed to update subtask" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  private async handleListProjects(): Promise<Response> {
    try {
      const projects = listProjects();
      const projectsWithTaskCount = projects.map((project) => ({
        name: project.name,
        path: project.path,
        registered: project.registeredAt,
        taskCount: 0
      }));
      return new Response(
        JSON.stringify({ projects: projectsWithTaskCount, isGlobalMode: true }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    } catch (error) {
      log.error(
        `List projects error: ${error instanceof Error ? error.message : String(error)}`
      );
      return new Response(
        JSON.stringify({ error: "Failed to list projects" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  private async handleListTasks(projectName: string | null): Promise<Response> {
    try {
      if (!projectName) {
        return new Response(
          JSON.stringify({ error: "project query param required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const storage = new SQLiteTaskStorage({ projectName });
      const scanResult = await storage.scan();

      // Format subtasks to match dashboard types
      const subtasksMap: Record<string, unknown[]> = {};
      for (const [folder, subtaskList] of Object.entries(scanResult.subtasks)) {
        subtasksMap[folder] = subtaskList.map((s) => ({
          filename: s.filename,
          number: s.number,
          slug: s.slug,
          frontmatter: {
            title: s.frontmatter.title,
            status: s.frontmatter.status,
            dependencies: s.frontmatter.dependencies ?? []
          },
          description: s.description ?? "",
          context: s.context ?? ""
        }));
      }

      // Format tasks to match dashboard types
      const response = {
        tasks: scanResult.tasks.map((t) => ({
          folder: t.folder,
          frontmatter: {
            title: t.frontmatter.title,
            status: t.frontmatter.status,
            created: t.frontmatter.created,
            priority: t.frontmatter.priority ?? "medium",
            tags: t.frontmatter.tags ?? [],
            assignee: t.frontmatter.assignee ?? null,
            dependencies: t.frontmatter.dependencies ?? [],
            branch: t.frontmatter.branch
          },
          description: t.description ?? "",
          requirements: t.requirements ?? "",
          acceptanceCriteria: t.acceptanceCriteria ?? [],
          notes: t.notes ?? ""
        })),
        subtasks: subtasksMap
      };

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    } catch (error) {
      log.error(
        `List tasks error: ${error instanceof Error ? error.message : String(error)}`
      );
      return new Response(JSON.stringify({ error: "Failed to list tasks" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
}
