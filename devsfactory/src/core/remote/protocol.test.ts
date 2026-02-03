import { describe, expect, it } from "bun:test";
import {
  type AgentMessage,
  PROTOCOL_VERSION,
  parseAgentMessage,
  parseServerMessage,
  type ServerMessage,
  serializeMessage
} from "./protocol";

describe("protocol", () => {
  describe("PROTOCOL_VERSION", () => {
    it("should be a valid semver string", () => {
      expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("parseServerMessage", () => {
    it("should parse auth:challenge message", () => {
      const message = {
        type: "auth:challenge",
        challenge: "abc123",
        timestamp: Date.now()
      };

      const result = parseServerMessage(JSON.stringify(message));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("auth:challenge");
      }
    });

    it("should parse auth:success message", () => {
      const message = {
        type: "auth:success",
        agentId: "ra-123",
        serverVersion: "1.1.0"
      };

      const result = parseServerMessage(JSON.stringify(message));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("auth:success");
      }
    });

    it("should parse auth:failure message", () => {
      const message = {
        type: "auth:failure",
        reason: "Invalid signature"
      };

      const result = parseServerMessage(JSON.stringify(message));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("auth:failure");
      }
    });

    it("should parse job:assign message", () => {
      const message = {
        type: "job:assign",
        jobId: "job-123",
        job: {
          type: "implementation",
          taskFolder: "task-1",
          subtaskFile: "001-implement-feature.md",
          priority: 10
        },
        paths: {
          devsfactoryDir: "/project/.devsfactory",
          worktreeCwd: "/worktrees/task-1"
        },
        model: "sonnet"
      };

      const result = parseServerMessage(JSON.stringify(message));
      expect(result.success).toBe(true);
      if (result.success && result.message.type === "job:assign") {
        expect(result.message.job.taskFolder).toBe("task-1");
        expect(result.message.paths.devsfactoryDir).toBe(
          "/project/.devsfactory"
        );
        expect(result.message.paths.worktreeCwd).toBe("/worktrees/task-1");
      }
    });

    it("should parse job:cancel message", () => {
      const message = {
        type: "job:cancel",
        jobId: "job-123",
        reason: "User requested"
      };

      const result = parseServerMessage(JSON.stringify(message));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("job:cancel");
      }
    });

    it("should parse heartbeat:ack message", () => {
      const message = {
        type: "heartbeat:ack",
        serverTime: Date.now()
      };

      const result = parseServerMessage(JSON.stringify(message));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("heartbeat:ack");
      }
    });

    it("should parse state:request message", () => {
      const message = {
        type: "state:request",
        projectName: "my-project"
      };

      const result = parseServerMessage(JSON.stringify(message));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("state:request");
      }
    });

    it("should parse error message", () => {
      const message = {
        type: "error",
        code: "INVALID_MESSAGE",
        message: "Something went wrong"
      };

      const result = parseServerMessage(JSON.stringify(message));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("error");
      }
    });

    it("should fail on invalid JSON", () => {
      const result = parseServerMessage("not json");
      expect(result.success).toBe(false);
    });

    it("should fail on unknown message type", () => {
      const message = {
        type: "unknown:type",
        data: {}
      };

      const result = parseServerMessage(JSON.stringify(message));
      expect(result.success).toBe(false);
    });
  });

  describe("parseAgentMessage", () => {
    it("should parse auth:hello message", () => {
      const message = {
        type: "auth:hello",
        clientId: "client-123",
        machineId: "machine-abc",
        projectName: "my-project",
        protocolVersion: "1.1.0",
        capabilities: {
          maxConcurrentJobs: 1,
          supportedModels: ["opus", "sonnet", "haiku"],
          hasLocalStorage: true
        }
      };

      const result = parseAgentMessage(JSON.stringify(message));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("auth:hello");
      }
    });

    it("should parse auth:response message", () => {
      const message = {
        type: "auth:response",
        signature: "hmac-signature",
        timestamp: Date.now()
      };

      const result = parseAgentMessage(JSON.stringify(message));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("auth:response");
      }
    });

    it("should parse job:accepted message", () => {
      const message = {
        type: "job:accepted",
        jobId: "job-123"
      };

      const result = parseAgentMessage(JSON.stringify(message));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("job:accepted");
      }
    });

    it("should parse job:output message", () => {
      const message = {
        type: "job:output",
        jobId: "job-123",
        line: "Processing file...",
        timestamp: Date.now()
      };

      const result = parseAgentMessage(JSON.stringify(message));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("job:output");
      }
    });

    it("should parse job:completed message", () => {
      const message = {
        type: "job:completed",
        jobId: "job-123",
        exitCode: 0,
        usage: {
          inputTokens: 1000,
          outputTokens: 500,
          totalCostUsd: 0.05
        }
      };

      const result = parseAgentMessage(JSON.stringify(message));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("job:completed");
      }
    });

    it("should parse job:failed message", () => {
      const message = {
        type: "job:failed",
        jobId: "job-123",
        error: "Agent exited with code 1"
      };

      const result = parseAgentMessage(JSON.stringify(message));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("job:failed");
      }
    });

    it("should parse heartbeat message", () => {
      const message = {
        type: "heartbeat",
        status: "idle",
        timestamp: Date.now()
      };

      const result = parseAgentMessage(JSON.stringify(message));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("heartbeat");
      }
    });

    it("should parse status:update message", () => {
      const message = {
        type: "status:update",
        taskFolder: "task-1",
        subtaskFile: "001-implement-feature.md",
        status: "IN_PROGRESS",
        timestamp: Date.now()
      };

      const result = parseAgentMessage(JSON.stringify(message));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("status:update");
      }
    });

    it("should parse state:snapshot message", () => {
      const message = {
        type: "state:snapshot",
        projectName: "my-project",
        state: { tasks: [], plans: {}, subtasks: {} },
        timestamp: Date.now()
      };

      const result = parseAgentMessage(JSON.stringify(message));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("state:snapshot");
      }
    });

    it("should parse state:delta message", () => {
      const message = {
        type: "state:delta",
        projectName: "my-project",
        updates: [{ type: "task:delete", taskFolder: "task-1" }],
        timestamp: Date.now()
      };

      const result = parseAgentMessage(JSON.stringify(message));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("state:delta");
      }
    });

    it("should parse auth:hello with capabilities", () => {
      const message = {
        type: "auth:hello",
        clientId: "client-123",
        machineId: "machine-abc",
        projectName: "my-project",
        protocolVersion: "1.1.0",
        capabilities: {
          maxConcurrentJobs: 1,
          supportedModels: ["opus", "sonnet"],
          hasLocalStorage: true
        }
      };

      const result = parseAgentMessage(JSON.stringify(message));
      expect(result.success).toBe(true);
      if (result.success && result.message.type === "auth:hello") {
        expect(result.message.capabilities?.hasLocalStorage).toBe(true);
      }
    });

    it("should fail on invalid JSON", () => {
      const result = parseAgentMessage("not json");
      expect(result.success).toBe(false);
    });

    it("should fail on missing required fields", () => {
      const message = {
        type: "heartbeat"
        // missing status and timestamp
      };

      const result = parseAgentMessage(JSON.stringify(message));
      expect(result.success).toBe(false);
    });
  });

  describe("serializeMessage", () => {
    it("should serialize server message to JSON", () => {
      const message: ServerMessage = {
        type: "auth:challenge",
        challenge: "abc123",
        timestamp: 1234567890
      };

      const serialized = serializeMessage(message);
      expect(serialized).toBe(JSON.stringify(message));
    });

    it("should serialize agent message to JSON", () => {
      const message: AgentMessage = {
        type: "heartbeat",
        status: "idle",
        timestamp: 1234567890
      };

      const serialized = serializeMessage(message);
      expect(serialized).toBe(JSON.stringify(message));
    });
  });
});
