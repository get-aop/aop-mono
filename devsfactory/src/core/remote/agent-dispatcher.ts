import { EventEmitter } from "node:events";
import type { ServerWebSocket } from "bun";
import KSUID from "ksuid";
import { getLogger } from "../../infra/logger";
import type { Job, JobResult } from "../types/job";
import {
  createPendingAuth,
  isPendingAuthExpired,
  type PendingAuth,
  verifySignature
} from "./auth";
import {
  type AgentCapabilities,
  type AgentMessage,
  type AuthChallengeMessage,
  type AuthFailureMessage,
  type AuthSuccessMessage,
  type HeartbeatAckMessage,
  type JobAssignMessage,
  type JobAssignment,
  type JobCancelMessage,
  PROTOCOL_VERSION,
  parseAgentMessage,
  type RemoteAgentInfo,
  type ServerErrorMessage,
  type ServerMessage,
  serializeMessage
} from "./protocol";
import {
  type AgentWebSocketData,
  RemoteAgentRegistry
} from "./remote-agent-registry";

const log = getLogger("agent-dispatcher");

/**
 * Pending job waiting for an agent
 */
interface PendingJob {
  job: Job;
  cwd: string;
  model?: string;
  systemPrompt?: string;
  timeout?: number;
  devsfactoryDir: string;
  resolve: (result: JobResult) => void;
  reject: (error: Error) => void;
}

/**
 * Events emitted by AgentDispatcher
 */
export interface AgentDispatcherEvents {
  agentConnected: RemoteAgentInfo;
  agentDisconnected: { agentId: string; reason: string };
  jobDispatched: { jobId: string; agentId: string };
  jobCompleted: { jobId: string; agentId: string; result: JobResult };
  jobFailed: { jobId: string; agentId: string; error: string };
  jobOutput: { jobId: string; agentId: string; line: string };
  statusUpdate: {
    agentId: string;
    taskFolder: string;
    subtaskFile?: string;
    status: string;
    timestamp: number;
  };
  stateSnapshot: {
    type: "state:snapshot";
    projectName: string;
    state: {
      tasks: unknown[];
      plans: Record<string, unknown>;
      subtasks: Record<string, unknown[]>;
    };
    timestamp: number;
  };
  stateDelta: {
    type: "state:delta";
    projectName: string;
    updates: unknown[];
    timestamp: number;
  };
}

/**
 * Options for AgentDispatcher
 */
export interface AgentDispatcherOptions {
  secret: string;
  serverVersion?: string;
}

/**
 * AgentDispatcher manages WebSocket connections from remote agents and dispatches jobs to them.
 */
export class AgentDispatcher extends EventEmitter {
  private registry: RemoteAgentRegistry;
  private pendingAuths: Map<ServerWebSocket<AgentWebSocketData>, PendingAuth> =
    new Map();
  private pendingJobs: Map<string, PendingJob> = new Map();
  private jobToAgent: Map<string, string> = new Map();
  private secret: string;
  private serverVersion: string;

  constructor(options: AgentDispatcherOptions) {
    super();
    this.secret = options.secret;
    this.serverVersion = options.serverVersion ?? PROTOCOL_VERSION;
    this.registry = new RemoteAgentRegistry();

    this.setupRegistryEvents();
  }

  /**
   * Start the dispatcher
   */
  start(): void {
    this.registry.start();
    log.info("Agent dispatcher started");
  }

  /**
   * Stop the dispatcher
   */
  stop(): void {
    this.registry.stop();

    // Fail all pending jobs
    for (const [jobId, pending] of this.pendingJobs) {
      pending.reject(new Error("Dispatcher shutting down"));
      this.pendingJobs.delete(jobId);
    }

    log.info("Agent dispatcher stopped");
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws: ServerWebSocket<AgentWebSocketData>): void {
    log.info("New agent connection, sending auth challenge");

    // Create pending auth state
    const pending = createPendingAuth();
    this.pendingAuths.set(ws, pending);

    // Send challenge
    const challenge: AuthChallengeMessage = {
      type: "auth:challenge",
      challenge: pending.challenge,
      timestamp: pending.timestamp
    };

    this.send(ws, challenge);
  }

  /**
   * Handle WebSocket message
   */
  handleMessage(
    ws: ServerWebSocket<AgentWebSocketData>,
    data: string | Buffer
  ): void {
    const rawData = typeof data === "string" ? data : data.toString();
    const parsed = parseAgentMessage(rawData);

    if (!parsed.success) {
      const errorMsg = (parsed as { success: false; error: string }).error;
      log.warn(`Invalid message from agent: ${errorMsg}`);
      this.sendError(ws, "INVALID_MESSAGE", errorMsg);
      return;
    }

    const message = parsed.message;

    // Handle unauthenticated messages
    if (!ws.data.authenticated) {
      this.handleUnauthenticatedMessage(ws, message);
      return;
    }

    // Handle authenticated messages
    this.handleAuthenticatedMessage(ws, message);
  }

  /**
   * Handle WebSocket close
   */
  handleClose(ws: ServerWebSocket<AgentWebSocketData>): void {
    this.pendingAuths.delete(ws);

    if (ws.data.agentId) {
      // Fail any running job
      const agent = this.registry.get(ws.data.agentId);
      if (agent?.currentJob) {
        this.handleJobFailure(
          agent.currentJob.jobId,
          ws.data.agentId,
          "Agent disconnected"
        );
      }

      this.registry.unregister(ws.data.agentId, "Connection closed");
    }
  }

  /**
   * Dispatch a job to an available agent
   * Returns a promise that resolves when the job completes
   */
  async dispatch(
    job: Job,
    cwd: string,
    devsfactoryDir: string,
    options?: {
      model?: string;
      systemPrompt?: string;
      timeout?: number;
    }
  ): Promise<JobResult> {
    return new Promise((resolve, reject) => {
      const pending: PendingJob = {
        job,
        cwd,
        model: options?.model,
        systemPrompt: options?.systemPrompt,
        timeout: options?.timeout,
        devsfactoryDir,
        resolve,
        reject
      };

      this.pendingJobs.set(job.id, pending);
      this.tryDispatch();
    });
  }

  /**
   * Cancel a running job
   */
  cancel(jobId: string, reason?: string): void {
    const agentId = this.jobToAgent.get(jobId);
    if (!agentId) {
      // Job not dispatched yet, just remove from pending
      const pending = this.pendingJobs.get(jobId);
      if (pending) {
        pending.reject(new Error(reason ?? "Job cancelled"));
        this.pendingJobs.delete(jobId);
      }
      return;
    }

    const socket = this.registry.getSocket(agentId);
    if (socket) {
      const cancel: JobCancelMessage = {
        type: "job:cancel",
        jobId,
        reason
      };
      this.send(socket, cancel);
    }
  }

  /**
   * Get the number of connected agents
   */
  getAgentCount(): number {
    return this.registry.count();
  }

  /**
   * Get the number of idle agents
   */
  getIdleAgentCount(): number {
    return this.registry.countIdle();
  }

  /**
   * Get all connected agents
   */
  getAgents(): RemoteAgentInfo[] {
    return this.registry.getAll();
  }

  /**
   * Get queue depth (pending jobs)
   */
  getQueueDepth(): number {
    return this.pendingJobs.size;
  }

  private setupRegistryEvents(): void {
    this.registry.on("agentConnected", (agent: RemoteAgentInfo) => {
      this.emit("agentConnected", agent);
      this.tryDispatch();
    });

    this.registry.on(
      "agentDisconnected",
      (data: { agentId: string; reason: string }) => {
        this.emit("agentDisconnected", data);
      }
    );

    this.registry.on("agentStatusChanged", () => {
      this.tryDispatch();
    });
  }

  private handleUnauthenticatedMessage(
    ws: ServerWebSocket<AgentWebSocketData>,
    message: AgentMessage
  ): void {
    if (message.type === "auth:hello") {
      // Store client info for later
      ws.data.clientId = message.clientId;
      ws.data.machineId = message.machineId;
      ws.data.projectName = message.projectName;
      ws.data.capabilities = message.capabilities as
        | AgentCapabilities
        | undefined;

      // Verify protocol version
      if (message.protocolVersion !== PROTOCOL_VERSION) {
        log.warn(
          `Protocol version mismatch: ${message.protocolVersion} vs ${PROTOCOL_VERSION}`
        );
        this.sendAuthFailure(
          ws,
          `Protocol version mismatch (expected ${PROTOCOL_VERSION})`
        );
        return;
      }

      log.debug(
        `Agent hello from ${message.machineId} (hasLocalStorage: ${message.capabilities?.hasLocalStorage})`
      );
      return;
    }

    if (message.type === "auth:response") {
      const pending = this.pendingAuths.get(ws);
      if (!pending) {
        this.sendAuthFailure(ws, "No pending authentication");
        return;
      }

      if (isPendingAuthExpired(pending)) {
        this.pendingAuths.delete(ws);
        this.sendAuthFailure(ws, "Authentication expired");
        return;
      }

      // Verify signature
      const result = verifySignature(
        pending.challenge,
        message.timestamp,
        message.signature,
        this.secret
      );

      if (!result.valid) {
        log.warn(`Auth failed for ${ws.data.machineId}: ${result.reason}`);
        this.sendAuthFailure(ws, result.reason ?? "Invalid signature");
        return;
      }

      // Authentication successful
      this.pendingAuths.delete(ws);

      const agentId = this.generateAgentId();
      ws.data.authenticated = true;
      ws.data.agentId = agentId;

      this.registry.register(
        agentId,
        ws.data.clientId ?? "unknown",
        ws.data.machineId ?? "unknown",
        ws,
        ws.data.capabilities
      );

      const success: AuthSuccessMessage = {
        type: "auth:success",
        agentId,
        serverVersion: this.serverVersion
      };

      this.send(ws, success);
      log.info(
        `Agent ${agentId} authenticated (machine: ${ws.data.machineId})`
      );
      return;
    }

    // Invalid message for unauthenticated connection
    this.sendAuthFailure(ws, "Authentication required");
  }

  private handleAuthenticatedMessage(
    ws: ServerWebSocket<AgentWebSocketData>,
    message: AgentMessage
  ): void {
    const agentId = ws.data.agentId!;

    switch (message.type) {
      case "heartbeat": {
        this.registry.updateHeartbeat(agentId);
        this.registry.updateStatus(agentId, message.status);

        const ack: HeartbeatAckMessage = {
          type: "heartbeat:ack",
          serverTime: Date.now()
        };
        this.send(ws, ack);
        break;
      }

      case "job:accepted":
        log.debug(`Job ${message.jobId} accepted by agent ${agentId}`);
        break;

      case "job:output":
        this.emit("jobOutput", {
          jobId: message.jobId,
          agentId,
          line: message.line
        });
        break;

      case "job:completed":
        this.handleJobCompletion(
          message.jobId,
          agentId,
          message.exitCode,
          message.usage
        );
        break;

      case "job:failed":
        this.handleJobFailure(message.jobId, agentId, message.error);
        break;

      case "status:update":
        log.debug(
          `Status update from agent ${agentId}: ${message.taskFolder}/${message.subtaskFile ?? "*"} -> ${message.status}`
        );
        this.emit("statusUpdate", {
          agentId,
          taskFolder: message.taskFolder,
          subtaskFile: message.subtaskFile,
          status: message.status,
          timestamp: message.timestamp
        });
        break;

      case "state:snapshot":
        this.emit("stateSnapshot", message);
        break;

      case "state:delta":
        this.emit("stateDelta", message);
        break;

      default:
        log.warn(
          `Unexpected message type from agent ${agentId}: ${(message as { type: string }).type}`
        );
    }
  }

  private handleJobCompletion(
    jobId: string,
    agentId: string,
    exitCode: number,
    _usage?: { inputTokens: number; outputTokens: number; totalCostUsd: number }
  ): void {
    const pending = this.pendingJobs.get(jobId);
    if (!pending) {
      log.warn(`Completed job ${jobId} not found in pending jobs`);
      return;
    }

    this.pendingJobs.delete(jobId);
    this.jobToAgent.delete(jobId);
    this.registry.clearJob(agentId);

    const result: JobResult = {
      jobId,
      success: exitCode === 0
    };

    if (exitCode !== 0) {
      result.error = `Agent exited with code ${exitCode}`;
    }

    log.info(`Job ${jobId} completed by agent ${agentId} (exit: ${exitCode})`);
    this.emit("jobCompleted", { jobId, agentId, result });
    pending.resolve(result);
  }

  private handleJobFailure(
    jobId: string,
    agentId: string,
    error: string
  ): void {
    const pending = this.pendingJobs.get(jobId);
    if (!pending) {
      log.warn(`Failed job ${jobId} not found in pending jobs`);
      return;
    }

    this.pendingJobs.delete(jobId);
    this.jobToAgent.delete(jobId);
    this.registry.clearJob(agentId);

    const result: JobResult = {
      jobId,
      success: false,
      error
    };

    log.error(`Job ${jobId} failed on agent ${agentId}: ${error}`);
    this.emit("jobFailed", { jobId, agentId, error });
    pending.resolve(result);
  }

  private tryDispatch(): void {
    if (this.pendingJobs.size === 0) return;

    const idleAgents = this.registry.getIdle();
    if (idleAgents.length === 0) return;

    // Sort pending jobs by priority (highest first)
    const sortedJobs = Array.from(this.pendingJobs.entries()).sort(
      ([, a], [, b]) => (b.job.priority ?? 0) - (a.job.priority ?? 0)
    );

    for (const [jobId, pending] of sortedJobs) {
      if (this.jobToAgent.has(jobId)) continue; // Already dispatched

      const agent = pending.job.projectName
        ? idleAgents.find(
            (candidate) => candidate.projectName === pending.job.projectName
          )
        : idleAgents[0];
      if (!agent) break;

      if (pending.job.projectName) {
        const index = idleAgents.findIndex(
          (candidate) => candidate.agentId === agent.agentId
        );
        if (index !== -1) {
          idleAgents.splice(index, 1);
        }
      } else {
        idleAgents.shift();
      }

      this.dispatchToAgent(pending, agent);
    }
  }

  private dispatchToAgent(pending: PendingJob, agent: RemoteAgentInfo): void {
    const socket = this.registry.getSocket(agent.agentId);
    if (!socket) {
      log.error(`No socket for agent ${agent.agentId}`);
      return;
    }

    // Validate agent has local storage capability
    if (!agent.capabilities?.hasLocalStorage) {
      log.error(
        `Agent ${agent.agentId} does not have local storage capability`
      );
      pending.reject(
        new Error("Agent does not have required local storage capability")
      );
      return;
    }

    const assignment: JobAssignment = {
      jobId: pending.job.id,
      job: pending.job,
      prompt: "", // No longer used - agent generates prompt locally
      cwd: pending.cwd,
      model: pending.model,
      timeout: pending.timeout,
      systemPrompt: pending.systemPrompt
    };

    if (!this.registry.assignJob(agent.agentId, assignment)) {
      log.warn(
        `Failed to assign job ${pending.job.id} to agent ${agent.agentId}`
      );
      return;
    }

    this.jobToAgent.set(pending.job.id, agent.agentId);

    const message: JobAssignMessage = {
      type: "job:assign",
      jobId: pending.job.id,
      job: {
        type: pending.job.type,
        taskFolder: pending.job.taskFolder,
        projectName: pending.job.projectName,
        subtaskFile: pending.job.subtaskFile,
        priority: pending.job.priority
      },
      paths: {
        devsfactoryDir: pending.devsfactoryDir,
        worktreeCwd: pending.cwd
      },
      model: pending.model,
      timeout: pending.timeout,
      systemPrompt: pending.systemPrompt
    };

    log.info(`Job ${pending.job.id} dispatched to agent ${agent.agentId}`);

    this.send(socket, message);
    this.emit("jobDispatched", {
      jobId: pending.job.id,
      agentId: agent.agentId
    });
  }

  sendToAgent(agentId: string, message: ServerMessage): void {
    const socket = this.registry.getSocket(agentId);
    if (!socket) {
      log.warn(`No socket for agent ${agentId}`);
      return;
    }
    this.send(socket, message);
  }

  private send(
    ws: ServerWebSocket<AgentWebSocketData>,
    message: ServerMessage
  ): void {
    ws.send(serializeMessage(message));
  }

  private sendError(
    ws: ServerWebSocket<AgentWebSocketData>,
    code: string,
    message: string
  ): void {
    const error: ServerErrorMessage = {
      type: "error",
      code,
      message
    };
    this.send(ws, error);
  }

  private sendAuthFailure(
    ws: ServerWebSocket<AgentWebSocketData>,
    reason: string
  ): void {
    const failure: AuthFailureMessage = {
      type: "auth:failure",
      reason
    };
    this.send(ws, failure);

    // Close connection after failure
    setTimeout(() => {
      try {
        ws.close(4001, reason);
      } catch {
        // Ignore close errors
      }
    }, 100);
  }

  private generateAgentId(): string {
    return `ra-${KSUID.randomSync().string}`;
  }
}
