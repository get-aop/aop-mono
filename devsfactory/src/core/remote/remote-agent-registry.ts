import { EventEmitter } from "node:events";
import type { ServerWebSocket } from "bun";
import { getLogger } from "../../infra/logger";
import type { AgentStatus, JobAssignment, RemoteAgentInfo } from "./protocol";

const log = getLogger("remote-agent-registry");

/**
 * Heartbeat timeout in milliseconds
 * Agents are considered disconnected if no heartbeat is received within this time
 */
export const HEARTBEAT_TIMEOUT_MS = 45_000;

/**
 * Heartbeat check interval in milliseconds
 */
export const HEARTBEAT_CHECK_INTERVAL_MS = 15_000;

import type { AgentCapabilities } from "./protocol";

/**
 * WebSocket data attached to each agent connection
 */
export interface AgentWebSocketData {
  agentId?: string;
  clientId?: string;
  machineId?: string;
  projectName?: string;
  authenticated: boolean;
  capabilities?: AgentCapabilities;
}

/**
 * Events emitted by RemoteAgentRegistry
 */
export interface RemoteAgentRegistryEvents {
  agentConnected: RemoteAgentInfo;
  agentDisconnected: { agentId: string; reason: string };
  agentStatusChanged: { agentId: string; status: AgentStatus };
  agentHeartbeat: { agentId: string };
}

/**
 * Registry for tracking connected remote agents
 */
export class RemoteAgentRegistry extends EventEmitter {
  private agents: Map<string, RemoteAgentInfo> = new Map();
  private sockets: Map<string, ServerWebSocket<AgentWebSocketData>> = new Map();
  private heartbeatChecker: ReturnType<typeof setInterval> | null = null;

  /**
   * Start the heartbeat checker
   */
  start(): void {
    if (this.heartbeatChecker) return;

    this.heartbeatChecker = setInterval(() => {
      this.checkHeartbeats();
    }, HEARTBEAT_CHECK_INTERVAL_MS);

    log.info("Remote agent registry started");
  }

  /**
   * Stop the heartbeat checker and disconnect all agents
   */
  stop(): void {
    if (this.heartbeatChecker) {
      clearInterval(this.heartbeatChecker);
      this.heartbeatChecker = null;
    }

    for (const agentId of this.agents.keys()) {
      this.unregister(agentId, "Server shutting down");
    }

    log.info("Remote agent registry stopped");
  }

  /**
   * Register a new authenticated agent
   */
  register(
    agentId: string,
    clientId: string,
    machineId: string,
    socket: ServerWebSocket<AgentWebSocketData>,
    capabilities?: RemoteAgentInfo["capabilities"]
  ): RemoteAgentInfo {
    const now = new Date();
    const agent: RemoteAgentInfo = {
      agentId,
      clientId,
      machineId,
      projectName: socket.data.projectName,
      status: "idle",
      connectedAt: now,
      lastHeartbeat: now,
      capabilities
    };

    this.agents.set(agentId, agent);
    this.sockets.set(agentId, socket);

    log.info(`Agent ${agentId} registered (machine: ${machineId})`);
    this.emit("agentConnected", agent);

    return agent;
  }

  /**
   * Unregister an agent (disconnect)
   */
  unregister(agentId: string, reason: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    this.agents.delete(agentId);
    const socket = this.sockets.get(agentId);
    this.sockets.delete(agentId);

    if (socket) {
      try {
        socket.close(1000, reason);
      } catch {
        // Socket may already be closed
      }
    }

    log.info(`Agent ${agentId} unregistered: ${reason}`);
    this.emit("agentDisconnected", { agentId, reason });
  }

  /**
   * Get an agent by ID
   */
  get(agentId: string): RemoteAgentInfo | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get the WebSocket for an agent
   */
  getSocket(agentId: string): ServerWebSocket<AgentWebSocketData> | undefined {
    return this.sockets.get(agentId);
  }

  /**
   * Get all connected agents
   */
  getAll(): RemoteAgentInfo[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get all idle agents
   */
  getIdle(): RemoteAgentInfo[] {
    return this.getAll().filter((a) => a.status === "idle");
  }

  /**
   * Get all busy agents
   */
  getBusy(): RemoteAgentInfo[] {
    return this.getAll().filter((a) => a.status === "busy");
  }

  /**
   * Count connected agents
   */
  count(): number {
    return this.agents.size;
  }

  /**
   * Count idle agents
   */
  countIdle(): number {
    return this.getIdle().length;
  }

  /**
   * Update agent status
   */
  updateStatus(agentId: string, status: AgentStatus): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const previousStatus = agent.status;
    agent.status = status;

    if (previousStatus !== status) {
      log.debug(`Agent ${agentId} status: ${previousStatus} -> ${status}`);
      this.emit("agentStatusChanged", { agentId, status });
    }
  }

  /**
   * Update agent heartbeat timestamp
   */
  updateHeartbeat(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.lastHeartbeat = new Date();
    this.emit("agentHeartbeat", { agentId });
  }

  /**
   * Assign a job to an agent
   */
  assignJob(agentId: string, job: JobAssignment): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    if (agent.status !== "idle") {
      log.warn(`Cannot assign job to non-idle agent ${agentId}`);
      return false;
    }

    agent.currentJob = job;
    agent.status = "busy";

    log.info(`Job ${job.jobId} assigned to agent ${agentId}`);
    this.emit("agentStatusChanged", { agentId, status: "busy" });

    return true;
  }

  /**
   * Clear job assignment from an agent
   */
  clearJob(agentId: string): JobAssignment | undefined {
    const agent = this.agents.get(agentId);
    if (!agent) return undefined;

    const job = agent.currentJob;
    agent.currentJob = undefined;
    agent.status = "idle";

    if (job) {
      log.info(`Job ${job.jobId} cleared from agent ${agentId}`);
      this.emit("agentStatusChanged", { agentId, status: "idle" });
    }

    return job;
  }

  /**
   * Find agent running a specific job
   */
  findByJob(jobId: string): RemoteAgentInfo | undefined {
    for (const agent of this.agents.values()) {
      if (agent.currentJob?.jobId === jobId) {
        return agent;
      }
    }
    return undefined;
  }

  /**
   * Check for stale agents (missed heartbeats)
   */
  private checkHeartbeats(): void {
    const now = Date.now();
    const staleAgents: string[] = [];

    for (const [agentId, agent] of this.agents) {
      const timeSinceHeartbeat = now - agent.lastHeartbeat.getTime();
      if (timeSinceHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        staleAgents.push(agentId);
      }
    }

    for (const agentId of staleAgents) {
      log.warn(`Agent ${agentId} missed heartbeat, disconnecting`);
      this.unregister(agentId, "Heartbeat timeout");
    }
  }
}
