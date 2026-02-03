import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { ServerWebSocket } from "bun";
import type { JobAssignment } from "./protocol";
import {
  type AgentWebSocketData,
  RemoteAgentRegistry
} from "./remote-agent-registry";

const createMockSocket = (
  data?: Partial<AgentWebSocketData>
): ServerWebSocket<AgentWebSocketData> => {
  return {
    data: {
      authenticated: false,
      ...data
    },
    send: mock(() => {}),
    close: mock(() => {}),
    readyState: 1
  } as unknown as ServerWebSocket<AgentWebSocketData>;
};

describe("RemoteAgentRegistry", () => {
  let registry: RemoteAgentRegistry;

  beforeEach(() => {
    registry = new RemoteAgentRegistry();
  });

  afterEach(() => {
    registry.stop();
  });

  describe("register", () => {
    it("should register a new agent", () => {
      const socket = createMockSocket();
      const agent = registry.register(
        "agent-1",
        "client-1",
        "machine-1",
        socket
      );

      expect(agent.agentId).toBe("agent-1");
      expect(agent.clientId).toBe("client-1");
      expect(agent.machineId).toBe("machine-1");
      expect(agent.status).toBe("idle");
    });

    it("should emit agentConnected event", () => {
      const socket = createMockSocket();
      let emittedAgent: unknown = null;

      registry.on("agentConnected", (agent) => {
        emittedAgent = agent;
      });

      registry.register("agent-1", "client-1", "machine-1", socket);

      expect(emittedAgent).not.toBeNull();
    });

    it("should store capabilities", () => {
      const socket = createMockSocket();
      const capabilities = {
        maxConcurrentJobs: 2,
        supportedModels: ["opus", "sonnet"],
        claudeVersion: "1.0.0",
        hasLocalStorage: true
      };

      const agent = registry.register(
        "agent-1",
        "client-1",
        "machine-1",
        socket,
        capabilities
      );

      expect(agent.capabilities).toEqual(capabilities);
    });
  });

  describe("unregister", () => {
    it("should remove an agent", () => {
      const socket = createMockSocket();
      registry.register("agent-1", "client-1", "machine-1", socket);

      registry.unregister("agent-1", "Test reason");

      expect(registry.get("agent-1")).toBeUndefined();
    });

    it("should emit agentDisconnected event", () => {
      const socket = createMockSocket();
      registry.register("agent-1", "client-1", "machine-1", socket);

      let emittedData: { agentId: string; reason: string } | null = null;

      registry.on("agentDisconnected", (data) => {
        emittedData = data;
      });

      registry.unregister("agent-1", "Test reason");

      expect(emittedData).not.toBeNull();
      expect(emittedData!.agentId).toBe("agent-1");
      expect(emittedData!.reason).toBe("Test reason");
    });

    it("should close the socket", () => {
      const socket = createMockSocket();
      registry.register("agent-1", "client-1", "machine-1", socket);

      registry.unregister("agent-1", "Test reason");

      expect(socket.close).toHaveBeenCalled();
    });

    it("should handle non-existent agent gracefully", () => {
      expect(() => registry.unregister("non-existent", "reason")).not.toThrow();
    });
  });

  describe("get", () => {
    it("should return agent by ID", () => {
      const socket = createMockSocket();
      registry.register("agent-1", "client-1", "machine-1", socket);

      const agent = registry.get("agent-1");
      expect(agent).toBeDefined();
      expect(agent!.agentId).toBe("agent-1");
    });

    it("should return undefined for non-existent agent", () => {
      expect(registry.get("non-existent")).toBeUndefined();
    });
  });

  describe("getSocket", () => {
    it("should return socket for agent", () => {
      const socket = createMockSocket();
      registry.register("agent-1", "client-1", "machine-1", socket);

      expect(registry.getSocket("agent-1")).toBe(socket);
    });

    it("should return undefined for non-existent agent", () => {
      expect(registry.getSocket("non-existent")).toBeUndefined();
    });
  });

  describe("getAll", () => {
    it("should return all agents", () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      registry.register("agent-1", "client-1", "machine-1", socket1);
      registry.register("agent-2", "client-2", "machine-2", socket2);

      const agents = registry.getAll();
      expect(agents).toHaveLength(2);
    });

    it("should return empty array when no agents", () => {
      expect(registry.getAll()).toEqual([]);
    });
  });

  describe("getIdle and getBusy", () => {
    it("should filter by status", () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      registry.register("agent-1", "client-1", "machine-1", socket1);
      registry.register("agent-2", "client-2", "machine-2", socket2);

      registry.updateStatus("agent-1", "busy");

      const idle = registry.getIdle();
      const busy = registry.getBusy();
      expect(idle).toHaveLength(1);
      expect(busy).toHaveLength(1);
      expect(idle[0]!.agentId).toBe("agent-2");
      expect(busy[0]!.agentId).toBe("agent-1");
    });
  });

  describe("count and countIdle", () => {
    it("should return correct counts", () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      registry.register("agent-1", "client-1", "machine-1", socket1);
      registry.register("agent-2", "client-2", "machine-2", socket2);

      registry.updateStatus("agent-1", "busy");

      expect(registry.count()).toBe(2);
      expect(registry.countIdle()).toBe(1);
    });
  });

  describe("updateStatus", () => {
    it("should update agent status", () => {
      const socket = createMockSocket();
      registry.register("agent-1", "client-1", "machine-1", socket);

      registry.updateStatus("agent-1", "busy");

      expect(registry.get("agent-1")!.status).toBe("busy");
    });

    it("should emit agentStatusChanged event", () => {
      const socket = createMockSocket();
      registry.register("agent-1", "client-1", "machine-1", socket);

      let emittedAgentId: string | undefined;
      let emittedStatus: string | undefined;

      registry.on(
        "agentStatusChanged",
        (data: { agentId: string; status: string }) => {
          emittedAgentId = data.agentId;
          emittedStatus = data.status;
        }
      );

      registry.updateStatus("agent-1", "busy");

      expect(emittedAgentId).toBe("agent-1");
      expect(emittedStatus).toBe("busy");
    });

    it("should not emit event if status unchanged", () => {
      const socket = createMockSocket();
      registry.register("agent-1", "client-1", "machine-1", socket);

      let emitCount = 0;
      registry.on("agentStatusChanged", () => {
        emitCount++;
      });

      registry.updateStatus("agent-1", "idle"); // Same as initial
      registry.updateStatus("agent-1", "idle"); // Same again

      expect(emitCount).toBe(0);
    });
  });

  describe("updateHeartbeat", () => {
    it("should update heartbeat timestamp", async () => {
      const socket = createMockSocket();
      registry.register("agent-1", "client-1", "machine-1", socket);

      const before = registry.get("agent-1")!.lastHeartbeat;

      // Wait a bit to ensure time difference
      await new Promise((r) => setTimeout(r, 10));

      registry.updateHeartbeat("agent-1");

      const after = registry.get("agent-1")!.lastHeartbeat;
      expect(after.getTime()).toBeGreaterThan(before.getTime());
    });

    it("should emit agentHeartbeat event", () => {
      const socket = createMockSocket();
      registry.register("agent-1", "client-1", "machine-1", socket);

      let emittedAgentId: string | undefined;
      registry.on("agentHeartbeat", ({ agentId }: { agentId: string }) => {
        emittedAgentId = agentId;
      });

      registry.updateHeartbeat("agent-1");

      expect(emittedAgentId).toBe("agent-1");
    });
  });

  describe("assignJob", () => {
    it("should assign job to idle agent", () => {
      const socket = createMockSocket();
      registry.register("agent-1", "client-1", "machine-1", socket);

      const job: JobAssignment = {
        jobId: "job-1",
        job: {
          id: "job-1",
          type: "implementation",
          taskFolder: "task-1",
          status: "pending",
          priority: 0,
          createdAt: new Date()
        },
        prompt: "Test prompt",
        cwd: "/path"
      };

      const result = registry.assignJob("agent-1", job);

      expect(result).toBe(true);
      expect(registry.get("agent-1")!.status).toBe("busy");
      expect(registry.get("agent-1")!.currentJob).toBe(job);
    });

    it("should not assign job to busy agent", () => {
      const socket = createMockSocket();
      registry.register("agent-1", "client-1", "machine-1", socket);
      registry.updateStatus("agent-1", "busy");

      const job: JobAssignment = {
        jobId: "job-1",
        job: {
          id: "job-1",
          type: "implementation",
          taskFolder: "task-1",
          status: "pending",
          priority: 0,
          createdAt: new Date()
        },
        prompt: "Test prompt",
        cwd: "/path"
      };

      const result = registry.assignJob("agent-1", job);

      expect(result).toBe(false);
    });

    it("should return false for non-existent agent", () => {
      const job: JobAssignment = {
        jobId: "job-1",
        job: {
          id: "job-1",
          type: "implementation",
          taskFolder: "task-1",
          status: "pending",
          priority: 0,
          createdAt: new Date()
        },
        prompt: "Test prompt",
        cwd: "/path"
      };

      const result = registry.assignJob("non-existent", job);

      expect(result).toBe(false);
    });
  });

  describe("clearJob", () => {
    it("should clear job and set agent to idle", () => {
      const socket = createMockSocket();
      registry.register("agent-1", "client-1", "machine-1", socket);

      const job: JobAssignment = {
        jobId: "job-1",
        job: {
          id: "job-1",
          type: "implementation",
          taskFolder: "task-1",
          status: "pending",
          priority: 0,
          createdAt: new Date()
        },
        prompt: "Test prompt",
        cwd: "/path"
      };

      registry.assignJob("agent-1", job);
      const clearedJob = registry.clearJob("agent-1");

      expect(clearedJob).toBe(job);
      expect(registry.get("agent-1")!.status).toBe("idle");
      expect(registry.get("agent-1")!.currentJob).toBeUndefined();
    });

    it("should return undefined if no job assigned", () => {
      const socket = createMockSocket();
      registry.register("agent-1", "client-1", "machine-1", socket);

      const result = registry.clearJob("agent-1");

      expect(result).toBeUndefined();
    });
  });

  describe("findByJob", () => {
    it("should find agent by job ID", () => {
      const socket = createMockSocket();
      registry.register("agent-1", "client-1", "machine-1", socket);

      const job: JobAssignment = {
        jobId: "job-123",
        job: {
          id: "job-123",
          type: "implementation",
          taskFolder: "task-1",
          status: "pending",
          priority: 0,
          createdAt: new Date()
        },
        prompt: "Test prompt",
        cwd: "/path"
      };

      registry.assignJob("agent-1", job);

      const found = registry.findByJob("job-123");
      expect(found).toBeDefined();
      expect(found!.agentId).toBe("agent-1");
    });

    it("should return undefined if job not found", () => {
      expect(registry.findByJob("non-existent")).toBeUndefined();
    });
  });
});
