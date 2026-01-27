import { beforeEach, describe, expect, test } from "bun:test";
import type { RunningAgent } from "../interfaces/agent-registry";
import { MemoryAgentRegistry } from "./memory-registry";

const createAgent = (overrides: Partial<RunningAgent> = {}): RunningAgent => ({
  jobId: `job-${Math.random().toString(36).slice(2)}`,
  type: "implementation",
  taskFolder: "test-task",
  pid: Math.floor(Math.random() * 10000),
  startedAt: new Date(),
  ...overrides
});

describe("MemoryAgentRegistry", () => {
  let registry: MemoryAgentRegistry;

  beforeEach(() => {
    registry = new MemoryAgentRegistry();
  });

  describe("register/unregister", () => {
    test("register adds agent to registry", async () => {
      const agent = createAgent({ jobId: "job-123" });
      await registry.register(agent);

      const found = await registry.get("job-123");
      expect(found).toEqual(agent);
    });

    test("unregister removes agent from registry", async () => {
      const agent = createAgent({ jobId: "job-456" });
      await registry.register(agent);
      await registry.unregister("job-456");

      const found = await registry.get("job-456");
      expect(found).toBeUndefined();
    });

    test("unregister does nothing for non-existent agent", async () => {
      await registry.unregister("nonexistent");
      expect(await registry.count()).toBe(0);
    });
  });

  describe("get", () => {
    test("returns agent by jobId", async () => {
      const agent = createAgent({ jobId: "job-abc" });
      await registry.register(agent);

      const found = await registry.get("job-abc");
      expect(found?.jobId).toBe("job-abc");
    });

    test("returns undefined for non-existent jobId", async () => {
      const found = await registry.get("nonexistent");
      expect(found).toBeUndefined();
    });
  });

  describe("getByTask", () => {
    test("returns all agents for a taskFolder", async () => {
      const agent1 = createAgent({ jobId: "j1", taskFolder: "task-a" });
      const agent2 = createAgent({
        jobId: "j2",
        taskFolder: "task-a",
        subtaskFile: "001.md"
      });
      const agent3 = createAgent({ jobId: "j3", taskFolder: "task-b" });

      await registry.register(agent1);
      await registry.register(agent2);
      await registry.register(agent3);

      const result = await registry.getByTask("task-a");
      expect(result).toHaveLength(2);
      expect(result.map((a) => a.jobId).sort()).toEqual(["j1", "j2"]);
    });

    test("returns empty array for non-existent taskFolder", async () => {
      const result = await registry.getByTask("nonexistent");
      expect(result).toEqual([]);
    });
  });

  describe("getBySubtask", () => {
    test("returns agent for specific subtask", async () => {
      const agent = createAgent({
        jobId: "j1",
        taskFolder: "task-x",
        subtaskFile: "002-sub.md"
      });
      await registry.register(agent);

      const found = await registry.getBySubtask("task-x", "002-sub.md");
      expect(found?.jobId).toBe("j1");
    });

    test("returns undefined if subtask not found", async () => {
      const agent = createAgent({
        taskFolder: "task-y",
        subtaskFile: "001.md"
      });
      await registry.register(agent);

      const found = await registry.getBySubtask("task-y", "002.md");
      expect(found).toBeUndefined();
    });

    test("returns undefined if taskFolder matches but no subtask", async () => {
      const agent = createAgent({ taskFolder: "task-z" });
      await registry.register(agent);

      const found = await registry.getBySubtask("task-z", "001.md");
      expect(found).toBeUndefined();
    });
  });

  describe("getAll", () => {
    test("returns all registered agents", async () => {
      await registry.register(createAgent({ jobId: "j1" }));
      await registry.register(createAgent({ jobId: "j2" }));
      await registry.register(createAgent({ jobId: "j3" }));

      const all = await registry.getAll();
      expect(all).toHaveLength(3);
    });

    test("returns empty array when no agents", async () => {
      const all = await registry.getAll();
      expect(all).toEqual([]);
    });
  });

  describe("count", () => {
    test("returns number of registered agents", async () => {
      await registry.register(createAgent({ jobId: "j1" }));
      await registry.register(createAgent({ jobId: "j2" }));

      expect(await registry.count()).toBe(2);
    });

    test("returns 0 when empty", async () => {
      expect(await registry.count()).toBe(0);
    });
  });

  describe("events", () => {
    test("emits agentRegistered on register", async () => {
      const events: RunningAgent[] = [];
      registry.on("agentRegistered", (agent) => events.push(agent));

      const agent = createAgent();
      await registry.register(agent);

      expect(events).toHaveLength(1);
      expect(events[0]!.jobId).toBe(agent.jobId);
    });

    test("emits agentUnregistered on unregister", async () => {
      const events: RunningAgent[] = [];
      registry.on("agentUnregistered", (agent) => events.push(agent));

      const agent = createAgent({ jobId: "j1" });
      await registry.register(agent);
      await registry.unregister("j1");

      expect(events).toHaveLength(1);
      expect(events[0]!.jobId).toBe("j1");
    });

    test("does not emit agentUnregistered for non-existent agent", async () => {
      const events: RunningAgent[] = [];
      registry.on("agentUnregistered", (agent) => events.push(agent));

      await registry.unregister("nonexistent");

      expect(events).toHaveLength(0);
    });
  });
});
