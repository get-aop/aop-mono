import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { hostname } from "node:os";
import { join } from "node:path";
import {
  ClaudeCodeSession,
  type ClaudeCodeSessionResult
} from "../core/claude-code-session";
import {
  createSubtaskWorktree,
  createTaskWorktree,
  deleteWorktree,
  mergeSubtaskIntoTask,
  migrateWorktree
} from "../core/git";
import { getGlobalDir } from "../core/global-bootstrap";
import { signChallenge } from "../core/remote/auth";
import {
  type AgentMessage,
  type AuthHelloMessage,
  type AuthResponseMessage,
  type HeartbeatMessage,
  type JobAcceptedMessage,
  type JobAssignMessage,
  type JobCompletedMessage,
  type JobFailedMessage,
  type JobOutputMessage,
  PROTOCOL_VERSION,
  parseServerMessage,
  type StateDeltaMessage,
  type StateDeltaUpdate,
  type StateSnapshotMessage,
  serializeMessage
} from "../core/remote/protocol";
import { ensureProjectRecord } from "../core/sqlite";
import { SQLiteTaskStorage } from "../core/sqlite/sqlite-task-storage";
import { getLogger } from "../infra/logger";
import { ClientPromptGenerator, type JobType } from "./client-prompts";
import { AgentStatePublisher } from "./state-publisher";

const log = getLogger("agent-client");

/**
 * Heartbeat interval in milliseconds
 */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Reconnection delay in milliseconds
 */
export const RECONNECT_DELAY_MS = 5_000;

/**
 * Maximum reconnection attempts
 */
export const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Agent client configuration
 */
export interface AgentClientConfig {
  serverUrl: string;
  secret: string;
  clientId?: string;
  machineId?: string;
  maxConcurrentJobs?: number;
  model?: string;
  reconnect?: boolean;
  projectName: string;
  repoPath: string;
}

/**
 * Events emitted by AgentClient
 */
export interface AgentClientEvents {
  connected: { agentId: string };
  disconnected: { reason: string };
  error: { error: Error };
  jobStarted: { jobId: string; taskFolder: string };
  jobCompleted: { jobId: string; exitCode: number };
  jobFailed: { jobId: string; error: string };
}

/**
 * Running job state
 */
interface RunningJob {
  jobId: string;
  taskFolder: string;
  subtaskFile?: string;
  session: ClaudeCodeSession;
  aborted: boolean;
}

type AgentJobType = JobType | "merge" | "migrate-worktree";

/**
 * AgentClient connects to a remote server and executes Claude CLI jobs locally.
 */
export class AgentClient extends EventEmitter {
  private config: AgentClientConfig;
  private socket: WebSocket | null = null;
  private agentId: string | null = null;
  private authenticated = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private stopped = false;
  private currentJob: RunningJob | null = null;
  private promptGenerator: ClientPromptGenerator;
  private statePublisher: AgentStatePublisher;
  private storage: SQLiteTaskStorage;

  constructor(config: AgentClientConfig) {
    super();
    this.config = {
      ...config,
      clientId: config.clientId ?? randomUUID(),
      machineId: config.machineId ?? hostname(),
      maxConcurrentJobs: config.maxConcurrentJobs ?? 1,
      reconnect: config.reconnect ?? true
    };

    this.storage = new SQLiteTaskStorage({
      projectName: this.config.projectName
    });
    this.promptGenerator = new ClientPromptGenerator(this.storage);
    this.statePublisher = new AgentStatePublisher({
      projectName: this.config.projectName,
      onSnapshot: (state) => this.sendStateSnapshot(state),
      onDelta: (updates) => this.sendStateDelta(updates)
    });
    log.info(
      `Agent configured: projectName=${config.projectName}, repoPath=${config.repoPath}`
    );
  }

  /**
   * Connect to the server
   */
  async connect(): Promise<void> {
    if (this.socket) {
      throw new Error("Already connected");
    }

    this.stopped = false;
    await this.establishConnection();
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.stopped = true;
    this.cleanup();
  }

  /**
   * Check if connected and authenticated
   */
  isConnected(): boolean {
    return this.authenticated && this.socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Get the agent ID assigned by the server
   */
  getAgentId(): string | null {
    return this.agentId;
  }

  private async establishConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        log.info(`Connecting to ${this.config.serverUrl}`);
        this.socket = new WebSocket(this.config.serverUrl);

        const connectTimeout = setTimeout(() => {
          if (this.socket?.readyState !== WebSocket.OPEN) {
            this.socket?.close();
            reject(new Error("Connection timeout"));
          }
        }, 10_000);

        this.socket.onopen = () => {
          clearTimeout(connectTimeout);
          log.info("WebSocket connected, sending hello");
          this.sendHello();
        };

        this.socket.onmessage = (event) => {
          this.handleMessage(event.data as string);

          // Resolve once authenticated
          if (this.authenticated && !this.heartbeatTimer) {
            this.startHeartbeat();
            resolve();
          }
        };

        this.socket.onclose = (event) => {
          clearTimeout(connectTimeout);
          log.info(`WebSocket closed: ${event.code} ${event.reason}`);
          this.handleDisconnect(event.reason || "Connection closed");
        };

        this.socket.onerror = (_event) => {
          clearTimeout(connectTimeout);
          const error = new Error("WebSocket error");
          log.error(`WebSocket error: ${error.message}`);
          this.emit("error", { error });

          if (!this.authenticated) {
            reject(error);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private sendHello(): void {
    const hello: AuthHelloMessage = {
      type: "auth:hello",
      clientId: this.config.clientId!,
      machineId: this.config.machineId!,
      projectName: this.config.projectName,
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        maxConcurrentJobs: this.config.maxConcurrentJobs!,
        supportedModels: ["opus", "sonnet", "haiku"],
        hasLocalStorage: true
      }
    };

    this.send(hello);
  }

  private handleMessage(data: string): void {
    const parsed = parseServerMessage(data);
    if (!parsed.success) {
      log.warn(
        `Invalid message from server: ${(parsed as { success: false; error: string }).error}`
      );
      return;
    }

    const message = parsed.message;

    switch (message.type) {
      case "auth:challenge":
        this.handleAuthChallenge(message.challenge, message.timestamp);
        break;

      case "auth:success":
        this.handleAuthSuccess(message.agentId, message.serverVersion);
        break;

      case "auth:failure":
        this.handleAuthFailure(message.reason);
        break;

      case "job:assign":
        this.handleJobAssign(message);
        break;

      case "job:cancel":
        this.handleJobCancel(message.jobId, message.reason);
        break;

      case "heartbeat:ack":
        log.debug(
          `Heartbeat acknowledged (server time: ${message.serverTime})`
        );
        break;

      case "state:request":
        this.handleStateRequest();
        break;

      case "task:create":
        log.warn("task:create not supported by this agent");
        break;

      case "error":
        log.error(`Server error: ${message.code} - ${message.message}`);
        this.emit("error", { error: new Error(message.message) });
        break;
    }
  }

  private handleAuthChallenge(challenge: string, _timestamp: number): void {
    log.debug("Received auth challenge");

    // Sign the challenge
    const now = Date.now();
    const signature = signChallenge(challenge, now, this.config.secret);

    const response: AuthResponseMessage = {
      type: "auth:response",
      signature,
      timestamp: now
    };

    this.send(response);
  }

  private handleAuthSuccess(agentId: string, serverVersion: string): void {
    this.agentId = agentId;
    this.authenticated = true;
    this.reconnectAttempts = 0;

    ensureProjectRecord({
      name: this.config.projectName,
      path: this.config.repoPath
    });

    log.info(`Authenticated as ${agentId} (server: ${serverVersion})`);
    this.emit("connected", { agentId });

    this.statePublisher.start().catch((error) => {
      log.error(
        `Failed to start state publisher: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  }

  private handleAuthFailure(reason: string): void {
    log.error(`Authentication failed: ${reason}`);
    this.emit("error", {
      error: new Error(`Authentication failed: ${reason}`)
    });
    this.cleanup();
  }

  private handleStateRequest(): void {
    this.statePublisher.sendSnapshot().catch((error) => {
      log.error(
        `Failed to send snapshot: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  }

  private async handleJobAssign(message: JobAssignMessage): Promise<void> {
    log.info(`Job assigned: ${message.jobId} (${message.job.type})`);

    if (this.currentJob) {
      log.error("Already running a job, cannot accept another");
      this.sendJobFailed(message.jobId, "Agent busy");
      return;
    }

    // Accept the job
    const accepted: JobAcceptedMessage = {
      type: "job:accepted",
      jobId: message.jobId
    };
    this.send(accepted);

    try {
      const jobType = message.job.type as AgentJobType;
      const taskFolder = message.job.taskFolder;
      const subtaskFile = message.job.subtaskFile;
      if (
        message.job.projectName &&
        message.job.projectName !== this.config.projectName
      ) {
        throw new Error(
          `Job project mismatch: ${message.job.projectName} != ${this.config.projectName}`
        );
      }
      const cwd = await this.prepareJob(jobType, taskFolder, subtaskFile);

      if (jobType === "merge") {
        await this.runMergeJob(taskFolder, subtaskFile!);
        this.sendJobCompleted(message.jobId);
        return;
      }

      if (jobType === "migrate-worktree") {
        await this.runMigrateJob(taskFolder);
        this.sendJobCompleted(message.jobId);
        return;
      }

      const prompt = await this.promptGenerator.generate(
        jobType as JobType,
        taskFolder,
        subtaskFile
      );

      this.executeJob({
        jobId: message.jobId,
        job: {
          type: jobType,
          taskFolder,
          subtaskFile
        },
        prompt,
        cwd,
        model: message.model,
        systemPrompt: message.systemPrompt,
        timeout: message.timeout
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error(`Failed to handle job ${message.jobId}: ${errorMsg}`);
      this.sendJobFailed(message.jobId, errorMsg);
    }
  }

  private handleJobCancel(jobId: string, reason?: string): void {
    log.info(`Job cancel requested: ${jobId} (${reason ?? "no reason"})`);

    if (!this.currentJob || this.currentJob.jobId !== jobId) {
      log.warn(`Job ${jobId} not running`);
      return;
    }

    this.currentJob.aborted = true;
    // The session will be killed in the next tick
  }

  private async executeJob(message: {
    jobId: string;
    job: { type: AgentJobType; taskFolder: string; subtaskFile?: string };
    prompt: string;
    cwd: string;
    model?: string;
    systemPrompt?: string;
    timeout?: number;
  }): Promise<void> {
    const session = new ClaudeCodeSession();

    const job: RunningJob = {
      jobId: message.jobId,
      taskFolder: message.job.taskFolder,
      subtaskFile: message.job.subtaskFile,
      session,
      aborted: false
    };

    this.currentJob = job;
    this.emit("jobStarted", {
      jobId: message.jobId,
      taskFolder: message.job.taskFolder
    });

    // Subscribe to output events
    session.on("output", ({ line }) => {
      if (job.aborted) return;

      const output: JobOutputMessage = {
        type: "job:output",
        jobId: message.jobId,
        line,
        timestamp: Date.now()
      };
      this.send(output);
    });

    try {
      log.info(`Executing job ${message.jobId} in ${message.cwd}`);

      const result = await session.run({
        cwd: message.cwd,
        prompt: message.prompt,
        model: message.model ?? this.config.model ?? "opus",
        systemPrompt: message.systemPrompt,
        dangerouslySkipPermissions: true,
        outputFormat: "stream-json",
        verbose: true
      });

      if (job.aborted) {
        log.info(`Job ${message.jobId} was aborted`);
        this.sendJobFailed(message.jobId, "Job cancelled");
        return;
      }

      await this.handleJobResult(message.jobId, message.job, result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error(`Job ${message.jobId} error: ${errorMsg}`);
      this.sendJobFailed(message.jobId, errorMsg);
    } finally {
      this.currentJob = null;
    }
  }

  private async handleJobResult(
    jobId: string,
    job: { type: AgentJobType; taskFolder: string; subtaskFile?: string },
    result: ClaudeCodeSessionResult
  ): Promise<void> {
    if (result.status === "error") {
      this.sendJobFailed(jobId, result.error ?? "Unknown error");
      this.emit("jobFailed", { jobId, error: result.error ?? "Unknown error" });
      return;
    }

    if (result.status === "waiting_for_input") {
      // Agents shouldn't need user input
      this.sendJobFailed(jobId, "Agent unexpectedly requested user input");
      this.emit("jobFailed", {
        jobId,
        error: "Agent unexpectedly requested user input"
      });
      return;
    }

    await this.updateStatusAfterSuccess(
      job.type,
      job.taskFolder,
      job.subtaskFile
    );

    // Success
    this.sendJobCompleted(jobId, result.usage);
    log.info(`Job ${jobId} completed successfully`);
    this.emit("jobCompleted", { jobId, exitCode: result.exitCode ?? 0 });
  }

  private sendJobFailed(jobId: string, error: string): void {
    const failed: JobFailedMessage = {
      type: "job:failed",
      jobId,
      error
    };
    this.send(failed);
  }

  private sendJobCompleted(
    jobId: string,
    usage?: { inputTokens: number; outputTokens: number; totalCostUsd: number }
  ): void {
    const completed: JobCompletedMessage = {
      type: "job:completed",
      jobId,
      exitCode: 0,
      usage
    };
    this.send(completed);
  }

  private handleDisconnect(reason: string): void {
    this.cleanup();
    this.emit("disconnected", { reason });

    if (!this.stopped && this.config.reconnect) {
      this.attemptReconnect();
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.stopped) return;

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      log.error(
        `Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached`
      );
      this.emit("error", {
        error: new Error("Max reconnection attempts reached")
      });
      return;
    }

    this.reconnectAttempts++;
    const delay = RECONNECT_DELAY_MS * Math.min(this.reconnectAttempts, 5);

    log.info(
      `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    if (this.stopped) return;

    try {
      await this.establishConnection();
    } catch (error) {
      log.error(
        `Reconnection failed: ${error instanceof Error ? error.message : String(error)}`
      );
      this.attemptReconnect();
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(() => {
      if (!this.isConnected()) return;

      const heartbeat: HeartbeatMessage = {
        type: "heartbeat",
        status: this.currentJob ? "busy" : "idle",
        currentJobId: this.currentJob?.jobId,
        timestamp: Date.now()
      };

      this.send(heartbeat);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private cleanup(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.currentJob) {
      this.currentJob.aborted = true;
    }

    this.authenticated = false;
    this.agentId = null;
    this.statePublisher.stop().catch(() => {});

    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Ignore close errors
      }
      this.socket = null;
    }
  }

  private send(message: AgentMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      log.warn("Cannot send message: not connected");
      return;
    }

    this.socket.send(serializeMessage(message));
  }

  private sendStateSnapshot(state: StateSnapshotMessage["state"]): void {
    const message: StateSnapshotMessage = {
      type: "state:snapshot",
      projectName: this.config.projectName,
      state,
      timestamp: Date.now()
    };
    this.send(message);
  }

  private sendStateDelta(updates: StateDeltaUpdate[]): void {
    if (updates.length === 0) return;
    const message: StateDeltaMessage = {
      type: "state:delta",
      projectName: this.config.projectName,
      updates,
      timestamp: Date.now()
    };
    this.send(message);
  }

  private getRepoRoot(): string {
    return this.config.repoPath;
  }

  private getWorktreesDir(): string {
    return join(getGlobalDir(), "worktrees");
  }

  private async prepareJob(
    type: AgentJobType,
    taskFolder: string,
    subtaskFile?: string
  ): Promise<string> {
    const task = await this.storage.getTask(taskFolder);
    if (subtaskFile && task?.frontmatter.status === "PENDING") {
      await this.storage.updateTaskStatus(taskFolder, "INPROGRESS");
    }
    const taskBranch = task?.frontmatter.branch;

    switch (type) {
      case "implementation":
      case "review":
      case "conflict-solver": {
        const slug = this.extractSubtaskSlug(subtaskFile!);
        await createSubtaskWorktree(
          this.getRepoRoot(),
          taskFolder,
          slug,
          this.getWorktreesDir(),
          taskBranch
        );
        if (type === "implementation") {
          await this.storage.updateSubtaskStatus(
            taskFolder,
            subtaskFile!,
            "INPROGRESS"
          );
        }
        return join(this.getWorktreesDir(), `${taskFolder}--${slug}`);
      }
      case "merge": {
        // Merge needs the TASK worktree to merge the subtask branch into
        // The subtask worktree already exists from the implementation job
        await createTaskWorktree(
          this.getRepoRoot(),
          taskFolder,
          this.getWorktreesDir(),
          taskBranch
        );
        return join(this.getWorktreesDir(), taskFolder);
      }
      case "completing-task":
      case "completion-review":
      case "migrate-worktree": {
        await createTaskWorktree(
          this.getRepoRoot(),
          taskFolder,
          this.getWorktreesDir(),
          taskBranch
        );
        return join(this.getWorktreesDir(), taskFolder);
      }
    }
    throw new Error(`Unsupported job type: ${type}`);
  }

  private async runMergeJob(
    taskFolder: string,
    subtaskFile: string
  ): Promise<void> {
    const task = await this.storage.getTask(taskFolder);
    const taskBranch = task?.frontmatter.branch;
    const slug = this.extractSubtaskSlug(subtaskFile);
    const result = await mergeSubtaskIntoTask(
      this.getRepoRoot(),
      taskFolder,
      slug,
      this.getWorktreesDir(),
      taskBranch
    );

    if (result.success) {
      await deleteWorktree(
        this.getRepoRoot(),
        join(this.getWorktreesDir(), `${taskFolder}--${slug}`)
      );
      await this.storage.updateSubtaskStatus(taskFolder, subtaskFile, "DONE");
      return;
    }

    if (result.hasConflict) {
      await this.storage.updateSubtaskStatus(
        taskFolder,
        subtaskFile,
        "MERGE_CONFLICT"
      );
      throw new Error(result.error ?? "Merge conflict");
    }

    throw new Error(result.error ?? "Merge failed");
  }

  private async runMigrateJob(taskFolder: string): Promise<void> {
    const worktreePath = join(this.getWorktreesDir(), taskFolder);
    const result = await migrateWorktree(this.getRepoRoot(), worktreePath);
    if (result.success) {
      await this.storage.updateTaskStatus(taskFolder, "DONE");
      return;
    }
    throw new Error(result.error ?? "Migration failed");
  }

  private async updateStatusAfterSuccess(
    type: AgentJobType,
    taskFolder: string,
    subtaskFile?: string
  ): Promise<void> {
    switch (type) {
      case "implementation":
        if (subtaskFile) {
          await this.storage.updateSubtaskStatus(
            taskFolder,
            subtaskFile,
            "AGENT_REVIEW"
          );
        }
        return;
      case "review":
        if (subtaskFile) {
          await this.storage.updateSubtaskStatus(
            taskFolder,
            subtaskFile,
            "PENDING_MERGE"
          );
        }
        return;
      case "conflict-solver":
        if (subtaskFile) {
          await this.storage.updateSubtaskStatus(
            taskFolder,
            subtaskFile,
            "DONE"
          );
        }
        return;
      case "completing-task":
      case "completion-review":
        await this.storage.updateTaskStatus(taskFolder, "REVIEW");
        return;
      case "merge":
      case "migrate-worktree":
        return;
    }
  }

  private extractSubtaskSlug(subtaskFile: string): string {
    const match = subtaskFile.match(/^\d{3}-(.+)\.md$/);
    return match ? match[1]! : subtaskFile.replace(/\.md$/, "");
  }
}
