import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import { ClientPromptGenerator } from "../../agent/client-prompts";
import { ClientStorage } from "../../agent/client-storage";
import { AopDatabase } from "../sqlite/database";
import { SQLiteTaskStorage } from "../sqlite/sqlite-task-storage";
import { AgentDispatcher } from "./agent-dispatcher";
import {
  PROTOCOL_VERSION,
  parseAgentMessage,
  parseServerMessage
} from "./protocol";
import type {
  AgentWebSocketData,
  RemoteAgentRegistry
} from "./remote-agent-registry";

// Helper type for accessing dispatcher internals in tests
interface DispatcherWithRegistry {
  registry: RemoteAgentRegistry;
}

const createMockSocket = (
  data?: Partial<AgentWebSocketData>
): ServerWebSocket<AgentWebSocketData> => {
  const sentMessages: string[] = [];
  return {
    data: {
      authenticated: false,
      ...data
    },
    send: mock((msg: string) => {
      sentMessages.push(msg);
    }),
    close: mock(() => {}),
    readyState: 1,
    // Helper to get sent messages
    _sentMessages: sentMessages
  } as unknown as ServerWebSocket<AgentWebSocketData> & {
    _sentMessages: string[];
  };
};

describe("Protocol Integration", () => {
  let tempDir: string;
  let dbPath: string;
  let db: AopDatabase;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "protocol-test-"));
    dbPath = join(tempDir, "test.db");
    db = new AopDatabase(dbPath);

    // Insert test project
    db.run(
      `INSERT INTO projects (name, path, registered_at) VALUES (?, ?, ?)`,
      ["test-project", "/test/path", new Date().toISOString()]
    );

    // Insert test task
    db.run(
      `INSERT INTO tasks (
        project_name, folder, title, status, priority, created_at,
        description, requirements, acceptance_criteria
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "test-project",
        "task-1",
        "Test Task",
        "INPROGRESS",
        "high",
        new Date().toISOString(),
        "Test description",
        "Test requirements",
        JSON.stringify(["AC1", "AC2"])
      ]
    );

    // Insert test subtask
    db.run(
      `INSERT INTO subtasks (
        project_name, task_folder, filename, number, slug, title, status,
        dependencies, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "test-project",
        "task-1",
        "001-implement-feature.md",
        1,
        "implement-feature",
        "Implement Feature",
        "PENDING",
        "[]",
        "Implement the feature"
      ]
    );
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("Capability Negotiation", () => {
    it("should parse capabilities from auth:hello message", () => {
      const helloMessage = {
        type: "auth:hello",
        clientId: "client-1",
        machineId: "machine-1",
        projectName: "test-project",
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          maxConcurrentJobs: 1,
          supportedModels: ["opus", "sonnet"],
          hasLocalStorage: true
        }
      };

      const result = parseAgentMessage(JSON.stringify(helloMessage));
      expect(result.success).toBe(true);

      if (result.success && result.message.type === "auth:hello") {
        const caps = result.message.capabilities;
        expect(caps?.hasLocalStorage).toBe(true);
      }
    });
  });

  describe("Job Dispatch", () => {
    let dispatcher: AgentDispatcher;

    beforeEach(() => {
      dispatcher = new AgentDispatcher({
        secret: "test-secret-at-least-16-chars",
        serverVersion: PROTOCOL_VERSION
      });
      dispatcher.start();
    });

    afterEach(() => {
      dispatcher.stop();
    });

    it("should send job:assign to capable agent", async () => {
      const socket = createMockSocket({
        authenticated: true,
        agentId: "agent-1",
        clientId: "client-1",
        machineId: "machine-1",
        capabilities: {
          maxConcurrentJobs: 1,
          supportedModels: ["opus"],
          hasLocalStorage: true
        }
      });

      // Register the capable agent
      (dispatcher as unknown as DispatcherWithRegistry).registry.register(
        "agent-1",
        "client-1",
        "machine-1",
        socket,
        {
          maxConcurrentJobs: 1,
          supportedModels: ["opus"],
          hasLocalStorage: true
        }
      );

      // Dispatch a job
      const dispatchPromise = dispatcher.dispatch(
        {
          id: "job-1",
          type: "implementation",
          taskFolder: "task-1",
          subtaskFile: "001-implement-feature.md",
          status: "pending",
          priority: 10,
          createdAt: new Date()
        },
        "/worktrees/task-1",
        "/project/.devsfactory",
        { model: "opus" }
      );

      // Wait for dispatch to happen
      await new Promise((r) => setTimeout(r, 50));

      // Check the sent message
      const sentMessages = (socket as unknown as { _sentMessages: string[] })
        ._sentMessages;
      expect(sentMessages.length).toBeGreaterThan(0);

      const lastMessage = sentMessages[sentMessages.length - 1];
      const parsed = parseServerMessage(lastMessage);

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.message.type).toBe("job:assign");
        if (parsed.message.type === "job:assign") {
          expect(parsed.message.job.taskFolder).toBe("task-1");
          expect(parsed.message.paths.devsfactoryDir).toBe(
            "/project/.devsfactory"
          );
          expect(parsed.message.paths.worktreeCwd).toBe("/worktrees/task-1");
        }
      }

      // Complete the job to clean up
      dispatcher.handleMessage(
        socket,
        JSON.stringify({
          type: "job:completed",
          jobId: "job-1",
          exitCode: 0
        })
      );

      const result = await dispatchPromise;
      expect(result.success).toBe(true);
    });

    it("should reject agent without local storage capability", async () => {
      const socket = createMockSocket({
        authenticated: true,
        agentId: "agent-2",
        clientId: "client-2",
        machineId: "machine-2",
        capabilities: {
          maxConcurrentJobs: 1,
          supportedModels: ["opus"],
          hasLocalStorage: false
        }
      });

      // Register the agent without hasLocalStorage
      (dispatcher as unknown as DispatcherWithRegistry).registry.register(
        "agent-2",
        "client-2",
        "machine-2",
        socket,
        {
          maxConcurrentJobs: 1,
          supportedModels: ["opus"],
          hasLocalStorage: false
        }
      );

      // Dispatch a job - should fail because agent doesn't have local storage
      const dispatchPromise = dispatcher.dispatch(
        {
          id: "job-2",
          type: "implementation",
          taskFolder: "task-1",
          status: "pending",
          priority: 10,
          createdAt: new Date()
        },
        "/worktrees/task-1",
        "/project/.devsfactory"
      );

      // The job should be rejected
      await expect(dispatchPromise).rejects.toThrow(
        "Agent does not have required local storage capability"
      );
    });
  });

  describe("Status Update Messages", () => {
    it("should parse status:update message", () => {
      const statusUpdate = {
        type: "status:update",
        taskFolder: "task-1",
        subtaskFile: "001-implement-feature.md",
        status: "INPROGRESS",
        timestamp: Date.now()
      };

      const result = parseAgentMessage(JSON.stringify(statusUpdate));
      expect(result.success).toBe(true);

      if (result.success && result.message.type === "status:update") {
        expect(result.message.taskFolder).toBe("task-1");
        expect(result.message.subtaskFile).toBe("001-implement-feature.md");
        expect(result.message.status).toBe("INPROGRESS");
      }
    });

    it("should handle status:update in dispatcher", () => {
      const dispatcher = new AgentDispatcher({
        secret: "test-secret-at-least-16-chars",
        serverVersion: PROTOCOL_VERSION
      });
      dispatcher.start();

      const socket = createMockSocket({
        authenticated: true,
        agentId: "agent-1",
        clientId: "client-1",
        machineId: "machine-1"
      });

      (dispatcher as unknown as DispatcherWithRegistry).registry.register(
        "agent-1",
        "client-1",
        "machine-1",
        socket,
        {
          maxConcurrentJobs: 1,
          supportedModels: ["opus"],
          hasLocalStorage: true
        }
      );

      let receivedUpdate: unknown = null;
      dispatcher.on("statusUpdate", (update) => {
        receivedUpdate = update;
      });

      dispatcher.handleMessage(
        socket,
        JSON.stringify({
          type: "status:update",
          taskFolder: "task-1",
          subtaskFile: "001-test.md",
          status: "DONE",
          timestamp: Date.now()
        })
      );

      expect(receivedUpdate).not.toBeNull();
      expect((receivedUpdate as { taskFolder: string }).taskFolder).toBe(
        "task-1"
      );
      expect((receivedUpdate as { status: string }).status).toBe("DONE");

      dispatcher.stop();
    });

    it("should handle state:snapshot in dispatcher", () => {
      const dispatcher = new AgentDispatcher({
        secret: "test-secret-at-least-16-chars",
        serverVersion: PROTOCOL_VERSION
      });
      dispatcher.start();

      const socket = createMockSocket({
        authenticated: true,
        agentId: "agent-1",
        clientId: "client-1",
        machineId: "machine-1"
      });

      (dispatcher as unknown as DispatcherWithRegistry).registry.register(
        "agent-1",
        "client-1",
        "machine-1",
        socket,
        {
          maxConcurrentJobs: 1,
          supportedModels: ["opus"],
          hasLocalStorage: true
        }
      );

      let receivedSnapshot: unknown = null;
      dispatcher.on("stateSnapshot", (snapshot) => {
        receivedSnapshot = snapshot;
      });

      dispatcher.handleMessage(
        socket,
        JSON.stringify({
          type: "state:snapshot",
          projectName: "test-project",
          state: { tasks: [], plans: {}, subtasks: {} },
          timestamp: Date.now()
        })
      );

      expect(receivedSnapshot).not.toBeNull();
      dispatcher.stop();
    });

    it("should handle state:delta in dispatcher", () => {
      const dispatcher = new AgentDispatcher({
        secret: "test-secret-at-least-16-chars",
        serverVersion: PROTOCOL_VERSION
      });
      dispatcher.start();

      const socket = createMockSocket({
        authenticated: true,
        agentId: "agent-1",
        clientId: "client-1",
        machineId: "machine-1"
      });

      (dispatcher as unknown as DispatcherWithRegistry).registry.register(
        "agent-1",
        "client-1",
        "machine-1",
        socket,
        {
          maxConcurrentJobs: 1,
          supportedModels: ["opus"],
          hasLocalStorage: true
        }
      );

      let receivedDelta: unknown = null;
      dispatcher.on("stateDelta", (delta) => {
        receivedDelta = delta;
      });

      dispatcher.handleMessage(
        socket,
        JSON.stringify({
          type: "state:delta",
          projectName: "test-project",
          updates: [{ type: "task:delete", taskFolder: "task-1" }],
          timestamp: Date.now()
        })
      );

      expect(receivedDelta).not.toBeNull();
      dispatcher.stop();
    });
  });

  describe("Client Storage", () => {
    it("should read task data from SQLite", () => {
      const storage = new ClientStorage("test-project", db);

      const task = storage.getTask("task-1");
      expect(task).not.toBeNull();
      expect(task?.frontmatter.title).toBe("Test Task");
      expect(task?.frontmatter.status).toBe("INPROGRESS");
    });

    it("should read subtask data from SQLite", () => {
      const storage = new ClientStorage("test-project", db);

      const subtask = storage.getSubtask("task-1", "001-implement-feature.md");
      expect(subtask).not.toBeNull();
      expect(subtask?.frontmatter.title).toBe("Implement Feature");
      expect(subtask?.frontmatter.status).toBe("PENDING");
    });

    it("should list subtasks in order", () => {
      // Add more subtasks
      db.run(
        `INSERT INTO subtasks (
          project_name, task_folder, filename, number, slug, title, status,
          dependencies, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "test-project",
          "task-1",
          "002-second-subtask.md",
          2,
          "second-subtask",
          "Second Subtask",
          "PENDING",
          "[1]",
          "Second subtask"
        ]
      );

      const storage = new ClientStorage("test-project", db);
      const subtasks = storage.listSubtasks("task-1");

      expect(subtasks).toHaveLength(2);
      expect(subtasks[0]!.number).toBe(1);
      expect(subtasks[1]!.number).toBe(2);
    });

    it("should find ready subtasks based on dependencies", () => {
      // First subtask is done
      db.run(
        `UPDATE subtasks SET status = 'DONE'
         WHERE project_name = ? AND task_folder = ? AND filename = ?`,
        ["test-project", "task-1", "001-implement-feature.md"]
      );

      // Add dependent subtask
      db.run(
        `INSERT INTO subtasks (
          project_name, task_folder, filename, number, slug, title, status,
          dependencies, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "test-project",
          "task-1",
          "002-dependent.md",
          2,
          "dependent",
          "Dependent Subtask",
          "PENDING",
          "[1]",
          "Depends on first"
        ]
      );

      const storage = new ClientStorage("test-project", db);
      const ready = storage.getReadySubtasks("task-1");

      expect(ready).toHaveLength(1);
      expect(ready[0]!.filename).toBe("002-dependent.md");
    });
  });

  describe("Client Prompt Generator", () => {
    it("should generate implementation prompt with injected content", async () => {
      const storage = new SQLiteTaskStorage({
        projectName: "test-project",
        db
      });
      const generator = new ClientPromptGenerator(storage);

      const prompt = await generator.generate(
        "implementation",
        "task-1",
        "001-implement-feature.md"
      );

      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain("## Task");
      expect(prompt).toContain("Test Task");
      expect(prompt).toContain("## Subtask");
      expect(prompt).toContain("Implement Feature");
      expect(prompt).not.toContain("{{taskContent}}");
      expect(prompt).not.toContain("{{subtaskContent}}");
    });

    it("should generate review prompt with injected content", async () => {
      const storage = new SQLiteTaskStorage({
        projectName: "test-project",
        db
      });
      const generator = new ClientPromptGenerator(storage);

      const prompt = await generator.generate(
        "review",
        "task-1",
        "001-implement-feature.md"
      );

      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain("## Subtask");
      expect(prompt).toContain("Implement Feature");
      expect(prompt).not.toContain("{{subtaskContent}}");
      expect(prompt).not.toContain("{{reviewFilename}}");
    });

    it("should throw error for unknown job type", async () => {
      const storage = new SQLiteTaskStorage({
        projectName: "test-project",
        db
      });
      const generator = new ClientPromptGenerator(storage);

      await expect(
        generator.generate("unknown" as "implementation", "task-1")
      ).rejects.toThrow("Unknown job type");
    });
  });

  describe("End-to-End Protocol Flow", () => {
    it("should complete full job lifecycle", async () => {
      // 1. Setup dispatcher and capable agent
      const dispatcher = new AgentDispatcher({
        secret: "test-secret-at-least-16-chars",
        serverVersion: PROTOCOL_VERSION
      });
      dispatcher.start();

      const socket = createMockSocket({
        authenticated: true,
        agentId: "test-agent",
        clientId: "test-client",
        machineId: "test-machine",
        capabilities: {
          maxConcurrentJobs: 1,
          supportedModels: ["opus"],
          hasLocalStorage: true
        }
      });

      // 2. Register agent with capabilities
      (dispatcher as unknown as DispatcherWithRegistry).registry.register(
        "test-agent",
        "test-client",
        "test-machine",
        socket,
        {
          maxConcurrentJobs: 1,
          supportedModels: ["opus"],
          hasLocalStorage: true
        }
      );

      const events: string[] = [];
      dispatcher.on("jobDispatched", () => events.push("dispatched"));
      dispatcher.on("jobCompleted", () => events.push("completed"));
      dispatcher.on("statusUpdate", () => events.push("statusUpdate"));

      // 3. Dispatch job
      const jobPromise = dispatcher.dispatch(
        {
          id: "e2e-job",
          type: "implementation",
          taskFolder: "task-1",
          subtaskFile: "001-implement-feature.md",
          status: "pending",
          priority: 10,
          createdAt: new Date()
        },
        "/worktrees/task-1",
        "/project/.devsfactory"
      );

      await new Promise((r) => setTimeout(r, 50));

      // 4. Verify job:assign message was sent
      const sentMessages = (socket as unknown as { _sentMessages: string[] })
        ._sentMessages;
      const jobMessage = sentMessages.find((m) => m.includes("job:assign"));
      expect(jobMessage).toBeDefined();

      const parsed = parseServerMessage(jobMessage!);
      expect(parsed.success).toBe(true);
      if (parsed.success && parsed.message.type === "job:assign") {
        expect(parsed.message.paths.devsfactoryDir).toBe(
          "/project/.devsfactory"
        );
      }

      // 5. Simulate agent accepting the job
      dispatcher.handleMessage(
        socket,
        JSON.stringify({
          type: "job:accepted",
          jobId: "e2e-job"
        })
      );

      // 6. Simulate status update from agent
      dispatcher.handleMessage(
        socket,
        JSON.stringify({
          type: "status:update",
          taskFolder: "task-1",
          subtaskFile: "001-implement-feature.md",
          status: "INPROGRESS",
          timestamp: Date.now()
        })
      );

      // 7. Simulate job output
      dispatcher.handleMessage(
        socket,
        JSON.stringify({
          type: "job:output",
          jobId: "e2e-job",
          line: "Processing...",
          timestamp: Date.now()
        })
      );

      // 8. Complete the job
      dispatcher.handleMessage(
        socket,
        JSON.stringify({
          type: "job:completed",
          jobId: "e2e-job",
          exitCode: 0,
          usage: {
            inputTokens: 1000,
            outputTokens: 500,
            totalCostUsd: 0.05
          }
        })
      );

      const result = await jobPromise;

      // 9. Verify events and result
      expect(events).toContain("dispatched");
      expect(events).toContain("statusUpdate");
      expect(events).toContain("completed");
      expect(result.success).toBe(true);

      dispatcher.stop();
    });
  });
});
