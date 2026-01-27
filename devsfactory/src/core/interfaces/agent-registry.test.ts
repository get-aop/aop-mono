import { describe, expect, test } from "bun:test";
import type { AgentRegistry, RunningAgent } from "./agent-registry";

const createMockAgent = (
  overrides: Partial<RunningAgent> = {}
): RunningAgent => ({
  jobId: `job-${Math.random().toString(36).slice(2)}`,
  type: "implementation",
  taskFolder: "test-task",
  pid: Math.floor(Math.random() * 10000),
  startedAt: new Date(),
  ...overrides
});

describe("RunningAgent", () => {
  test("has required fields for tracking agents", () => {
    const agent: RunningAgent = {
      jobId: "job-123",
      type: "implementation",
      taskFolder: "my-task",
      pid: 12345,
      startedAt: new Date()
    };

    expect(agent.jobId).toBe("job-123");
    expect(agent.type).toBe("implementation");
    expect(agent.taskFolder).toBe("my-task");
    expect(agent.pid).toBe(12345);
    expect(agent.startedAt).toBeInstanceOf(Date);
  });

  test("can include optional subtaskFile", () => {
    const agent: RunningAgent = {
      jobId: "job-456",
      type: "review",
      taskFolder: "my-task",
      subtaskFile: "001-first.md",
      pid: 67890,
      startedAt: new Date()
    };

    expect(agent.subtaskFile).toBe("001-first.md");
  });
});

describe("AgentRegistry interface", () => {
  test("interface has all required methods", () => {
    const registry: AgentRegistry = {
      register: async () => {},
      unregister: async () => {},
      get: async () => undefined,
      getByTask: async () => [],
      getBySubtask: async () => undefined,
      getAll: async () => [],
      count: async () => 0
    };

    expect(typeof registry.register).toBe("function");
    expect(typeof registry.unregister).toBe("function");
    expect(typeof registry.get).toBe("function");
    expect(typeof registry.getByTask).toBe("function");
    expect(typeof registry.getBySubtask).toBe("function");
    expect(typeof registry.getAll).toBe("function");
    expect(typeof registry.count).toBe("function");
  });

  test("register accepts a RunningAgent", async () => {
    let registeredAgent: RunningAgent | undefined;
    const registry: AgentRegistry = {
      register: async (agent) => {
        registeredAgent = agent;
      },
      unregister: async () => {},
      get: async () => undefined,
      getByTask: async () => [],
      getBySubtask: async () => undefined,
      getAll: async () => [],
      count: async () => 0
    };

    const agent = createMockAgent();
    await registry.register(agent);
    expect(registeredAgent).toEqual(agent);
  });

  test("unregister accepts jobId", async () => {
    let unregisteredId: string | undefined;
    const registry: AgentRegistry = {
      register: async () => {},
      unregister: async (jobId) => {
        unregisteredId = jobId;
      },
      get: async () => undefined,
      getByTask: async () => [],
      getBySubtask: async () => undefined,
      getAll: async () => [],
      count: async () => 0
    };

    await registry.unregister("job-xyz");
    expect(unregisteredId).toBe("job-xyz");
  });

  test("get returns RunningAgent by jobId or undefined", async () => {
    const agent = createMockAgent({ jobId: "job-abc" });
    const registry: AgentRegistry = {
      register: async () => {},
      unregister: async () => {},
      get: async (jobId) => (jobId === "job-abc" ? agent : undefined),
      getByTask: async () => [],
      getBySubtask: async () => undefined,
      getAll: async () => [],
      count: async () => 0
    };

    const found = await registry.get("job-abc");
    expect(found).toEqual(agent);

    const notFound = await registry.get("job-missing");
    expect(notFound).toBeUndefined();
  });

  test("getByTask returns all agents for a taskFolder", async () => {
    const agent1 = createMockAgent({ taskFolder: "task-a", jobId: "j1" });
    const agent2 = createMockAgent({ taskFolder: "task-a", jobId: "j2" });
    const agents = [agent1, agent2];

    const registry: AgentRegistry = {
      register: async () => {},
      unregister: async () => {},
      get: async () => undefined,
      getByTask: async (taskFolder) =>
        agents.filter((a) => a.taskFolder === taskFolder),
      getBySubtask: async () => undefined,
      getAll: async () => [],
      count: async () => 0
    };

    const result = await registry.getByTask("task-a");
    expect(result).toHaveLength(2);
  });

  test("getBySubtask returns agent for specific subtask", async () => {
    const agent = createMockAgent({
      taskFolder: "task-b",
      subtaskFile: "002-sub.md"
    });
    const registry: AgentRegistry = {
      register: async () => {},
      unregister: async () => {},
      get: async () => undefined,
      getByTask: async () => [],
      getBySubtask: async (taskFolder, subtaskFile) =>
        taskFolder === "task-b" && subtaskFile === "002-sub.md"
          ? agent
          : undefined,
      getAll: async () => [],
      count: async () => 0
    };

    const found = await registry.getBySubtask("task-b", "002-sub.md");
    expect(found).toEqual(agent);

    const notFound = await registry.getBySubtask("task-b", "003-other.md");
    expect(notFound).toBeUndefined();
  });

  test("getAll returns all running agents", async () => {
    const agents = [
      createMockAgent({ jobId: "j1" }),
      createMockAgent({ jobId: "j2" }),
      createMockAgent({ jobId: "j3" })
    ];
    const registry: AgentRegistry = {
      register: async () => {},
      unregister: async () => {},
      get: async () => undefined,
      getByTask: async () => [],
      getBySubtask: async () => undefined,
      getAll: async () => agents,
      count: async () => agents.length
    };

    const result = await registry.getAll();
    expect(result).toHaveLength(3);
  });

  test("count returns number of running agents", async () => {
    const registry: AgentRegistry = {
      register: async () => {},
      unregister: async () => {},
      get: async () => undefined,
      getByTask: async () => [],
      getBySubtask: async () => undefined,
      getAll: async () => [],
      count: async () => 5
    };

    const result = await registry.count();
    expect(result).toBe(5);
  });
});
