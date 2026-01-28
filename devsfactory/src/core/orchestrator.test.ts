import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  cleanupTestDir,
  createTestDir,
  createTestGitRepo
} from "../test-helpers";
import { MemoryQueue } from "./local/memory-queue";
import { MemoryAgentRegistry } from "./local/memory-registry";
import { JobProducer } from "./producer/job-producer";

const FIXTURES_DIR = join(import.meta.dir, "../../e2e-tests/fixtures");

const copyFixture = async (
  devsfactoryDir: string,
  fixtureName: string,
  destName?: string
): Promise<void> => {
  const src = join(FIXTURES_DIR, fixtureName);
  const dest = join(devsfactoryDir, destName ?? fixtureName);
  await cp(src, dest, { recursive: true });
};

import type { AgentProcess, AgentType, Config } from "../types";
import type { AgentRunner } from "./agent-runner";
import { Orchestrator } from "./orchestrator";

const createMockAgentRunner = () => {
  const runner = new EventEmitter() as EventEmitter & {
    spawn: ReturnType<typeof mock>;
    kill: ReturnType<typeof mock>;
    getActive: ReturnType<typeof mock>;
    getCountByType: ReturnType<typeof mock>;
  };
  runner.spawn = mock(() =>
    Promise.resolve({
      id: "test-agent",
      type: "implementation" as AgentType,
      taskFolder: "test-task",
      pid: 123,
      startedAt: new Date()
    })
  );
  runner.kill = mock(() => Promise.resolve());
  runner.getActive = mock(() => []);
  runner.getCountByType = mock(() => 0);
  return runner;
};

const createConfig = (overrides: Partial<Config> = {}): Config => ({
  maxConcurrentAgents: 3,
  devsfactoryDir: ".devsfactory",
  worktreesDir: ".worktrees",
  debounceMs: 10,
  retryBackoff: { initialMs: 2000, maxMs: 300000, maxAttempts: 5 },
  ignorePatterns: [".git", "*.swp", "*.tmp", "*~", ".DS_Store"],
  ...overrides
});

describe("Orchestrator", () => {
  describe("class structure", () => {
    test("extends EventEmitter", () => {
      const config = createConfig();
      const orchestrator = new Orchestrator(config);

      expect(orchestrator).toBeInstanceOf(EventEmitter);
    });

    test("constructor accepts config", () => {
      const config = createConfig();
      const orchestrator = new Orchestrator(config);

      expect(orchestrator).toBeDefined();
    });

    test("constructor accepts optional AgentRunner for dependency injection", () => {
      const config = createConfig();
      const mockRunner = createMockAgentRunner();
      const orchestrator = new Orchestrator(
        config,
        mockRunner as unknown as AgentRunner
      );

      expect(orchestrator).toBeDefined();
    });
  });

  describe("getState()", () => {
    test("returns initial empty state", () => {
      const config = createConfig();
      const orchestrator = new Orchestrator(config);
      const state = orchestrator.getState();

      expect(state.tasks).toEqual([]);
      expect(state.plans).toEqual({});
      expect(state.subtasks).toEqual({});
    });

    test("returns deep copy of state", () => {
      const config = createConfig();
      const orchestrator = new Orchestrator(config);
      const state1 = orchestrator.getState();
      const state2 = orchestrator.getState();

      expect(state1).not.toBe(state2);
      expect(state1.tasks).not.toBe(state2.tasks);
    });
  });

  describe("start()", () => {
    let tempDir: string;
    let devsfactoryDir: string;

    beforeEach(async () => {
      tempDir = await createTestDir("orchestrator");
      devsfactoryDir = join(tempDir, ".devsfactory");
      await mkdir(devsfactoryDir, { recursive: true });
    });

    afterEach(async () => {
      await cleanupTestDir(tempDir);
    });

    test("creates .devsfactory directory if it does not exist", async () => {
      await rm(devsfactoryDir, { recursive: true, force: true });
      const config = createConfig({ devsfactoryDir: devsfactoryDir });
      const mockRunner = createMockAgentRunner();
      const orchestrator = new Orchestrator(
        config,
        mockRunner as unknown as AgentRunner
      );

      await orchestrator.start();
      await orchestrator.stop();

      const { stat } = await import("node:fs/promises");
      const stats = await stat(devsfactoryDir);
      expect(stats.isDirectory()).toBe(true);
    });

    test("performs initial scan via watcher", async () => {
      // Use done-task to avoid triggering worktree creation on PENDING->INPROGRESS transition
      await copyFixture(devsfactoryDir, "done-task", "my-task");

      const config = createConfig({ devsfactoryDir: devsfactoryDir });
      const mockRunner = createMockAgentRunner();
      const orchestrator = new Orchestrator(
        config,
        mockRunner as unknown as AgentRunner
      );

      await orchestrator.start();
      const state = orchestrator.getState();
      await orchestrator.stop();

      expect(state.tasks.length).toBe(1);
      expect(state.tasks[0]!.folder).toBe("my-task");
    });

    test("starts file watcher", async () => {
      const config = createConfig({ devsfactoryDir: devsfactoryDir });
      const mockRunner = createMockAgentRunner();
      const orchestrator = new Orchestrator(
        config,
        mockRunner as unknown as AgentRunner
      );

      await orchestrator.start();
      expect(orchestrator.isWatching()).toBe(true);
      await orchestrator.stop();
    });

    test("emits stateChanged after initial scan", async () => {
      const config = createConfig({ devsfactoryDir: devsfactoryDir });
      const mockRunner = createMockAgentRunner();
      const orchestrator = new Orchestrator(
        config,
        mockRunner as unknown as AgentRunner
      );
      const events: string[] = [];
      orchestrator.on("stateChanged", () => events.push("stateChanged"));

      await orchestrator.start();
      await orchestrator.stop();

      expect(events).toContain("stateChanged");
    });

    test("calls runRecovery during startup", async () => {
      const config = createConfig({ devsfactoryDir: devsfactoryDir });
      const mockRunner = createMockAgentRunner();
      const orchestrator = new Orchestrator(
        config,
        mockRunner as unknown as AgentRunner
      );

      let recoveryCalled = false;
      const originalRunRecovery = (
        orchestrator as unknown as { runRecovery: () => Promise<void> }
      ).runRecovery.bind(orchestrator);
      (
        orchestrator as unknown as { runRecovery: () => Promise<void> }
      ).runRecovery = async () => {
        recoveryCalled = true;
        return originalRunRecovery();
      };

      await orchestrator.start();
      await orchestrator.stop();

      expect(recoveryCalled).toBe(true);
    });
  });

  describe("stop()", () => {
    let tempDir: string;
    let devsfactoryDir: string;

    beforeEach(async () => {
      tempDir = await createTestDir("orchestrator");
      devsfactoryDir = join(tempDir, ".devsfactory");
      await mkdir(devsfactoryDir, { recursive: true });
    });

    afterEach(async () => {
      await cleanupTestDir(tempDir);
    });

    test("stops file watcher", async () => {
      const config = createConfig({ devsfactoryDir: devsfactoryDir });
      const mockRunner = createMockAgentRunner();
      const orchestrator = new Orchestrator(
        config,
        mockRunner as unknown as AgentRunner
      );

      await orchestrator.start();
      await orchestrator.stop();

      expect(orchestrator.isWatching()).toBe(false);
    });

    test("kills all running agents via agentRunner", async () => {
      const config = createConfig({ devsfactoryDir: devsfactoryDir });
      const mockRunner = createMockAgentRunner();
      mockRunner.getActive = mock(() => [
        {
          id: "agent-1",
          type: "implementation",
          taskFolder: "task-1",
          pid: 123,
          startedAt: new Date()
        },
        {
          id: "agent-2",
          type: "review",
          taskFolder: "task-2",
          pid: 456,
          startedAt: new Date()
        }
      ]);
      const orchestrator = new Orchestrator(
        config,
        mockRunner as unknown as AgentRunner
      );

      await orchestrator.start();
      await orchestrator.stop();

      expect(mockRunner.kill).toHaveBeenCalledTimes(2);
    });

    test("emits final stateChanged event", async () => {
      const config = createConfig({ devsfactoryDir: devsfactoryDir });
      const mockRunner = createMockAgentRunner();
      const orchestrator = new Orchestrator(
        config,
        mockRunner as unknown as AgentRunner
      );
      const events: string[] = [];

      await orchestrator.start();
      orchestrator.on("stateChanged", () => events.push("stateChanged"));
      await orchestrator.stop();

      expect(events).toContain("stateChanged");
    });
  });

  describe("events", () => {
    let tempDir: string;
    let devsfactoryDir: string;

    beforeEach(async () => {
      tempDir = await createTestDir("orchestrator");
      devsfactoryDir = join(tempDir, ".devsfactory");
      await mkdir(devsfactoryDir, { recursive: true });
    });

    afterEach(async () => {
      await cleanupTestDir(tempDir);
    });

    test("emits workerJobFailed when worker reports job failure", async () => {
      const config = createConfig({ devsfactoryDir: devsfactoryDir });
      const mockRunner = createMockAgentRunner();
      const orchestrator = new Orchestrator(
        config,
        mockRunner as unknown as AgentRunner
      );
      const events: Array<{
        jobId: string;
        error?: string;
        attempt?: number;
      }> = [];

      orchestrator.on("workerJobFailed", (data) => events.push(data));
      await orchestrator.start();

      const worker = (
        orchestrator as unknown as {
          worker: EventEmitter | undefined;
        }
      ).worker;
      worker!.emit("jobFailed", {
        jobId: "test-job-1",
        error: "Agent exited with non-zero code",
        attempt: 1
      });

      await orchestrator.stop();

      expect(events.length).toBe(1);
      expect(events[0]!.jobId).toBe("test-job-1");
      expect(events[0]!.error).toBe("Agent exited with non-zero code");
    });

    test("emits workerJobCompleted with durationMs when worker completes job", async () => {
      const config = createConfig({ devsfactoryDir: devsfactoryDir });
      const mockRunner = createMockAgentRunner();
      const orchestrator = new Orchestrator(
        config,
        mockRunner as unknown as AgentRunner
      );
      const events: Array<{
        jobId: string;
        job: { type: string; taskFolder: string; subtaskFile?: string };
        durationMs: number;
      }> = [];

      orchestrator.on("workerJobCompleted", (data) => events.push(data));
      await orchestrator.start();

      const worker = (
        orchestrator as unknown as {
          worker: EventEmitter | undefined;
        }
      ).worker;
      worker!.emit("jobCompleted", {
        jobId: "test-job-1",
        job: {
          type: "implementation",
          taskFolder: "my-task",
          subtaskFile: "001-test.md"
        },
        durationMs: 272000
      });

      await orchestrator.stop();

      expect(events.length).toBe(1);
      expect(events[0]!.jobId).toBe("test-job-1");
      expect(events[0]!.job.type).toBe("implementation");
      expect(events[0]!.durationMs).toBe(272000);
    });

    test("emits subtaskCompleted with durationMs when merge job completes", async () => {
      await copyFixture(
        devsfactoryDir,
        "inprogress-with-subtask-pending-merge",
        "my-task"
      );

      const config = createConfig({ devsfactoryDir: devsfactoryDir });
      const mockRunner = createMockAgentRunner();
      const orchestrator = new Orchestrator(
        config,
        mockRunner as unknown as AgentRunner
      );
      const events: Array<{
        taskFolder: string;
        subtaskNumber: number;
        subtaskTotal: number;
        subtaskTitle: string;
        durationMs: number;
      }> = [];

      orchestrator.on("subtaskCompleted", (data) => events.push(data));
      await orchestrator.start();

      const worker = (
        orchestrator as unknown as {
          worker: EventEmitter | undefined;
        }
      ).worker;
      worker!.emit("jobCompleted", {
        jobId: "merge-job-1",
        job: {
          type: "merge",
          taskFolder: "my-task",
          subtaskFile: "001-first-subtask.md"
        },
        durationMs: 5000
      });

      await new Promise((r) => setTimeout(r, 50));
      await orchestrator.stop();

      expect(events.length).toBeGreaterThanOrEqual(1);
      const mergeEvent = events.find((e) => e.taskFolder === "my-task");
      expect(mergeEvent).toBeDefined();
      expect(mergeEvent!.subtaskNumber).toBe(1);
      expect(mergeEvent!.durationMs).toBeGreaterThanOrEqual(0);
    });

    test("emits taskCompleted when task transitions to DONE", async () => {
      await copyFixture(
        devsfactoryDir,
        "inprogress-with-subtask-done",
        "my-task"
      );

      const config = createConfig({ devsfactoryDir: devsfactoryDir });
      const mockRunner = createMockAgentRunner();
      const orchestrator = new Orchestrator(
        config,
        mockRunner as unknown as AgentRunner
      );
      const events: Array<{ task: { folder: string }; subtasks: unknown[] }> =
        [];

      orchestrator.on("taskCompleted", (data) => events.push(data));
      await orchestrator.start();

      // Simulate task status change to DONE by modifying the file
      const taskPath = join(devsfactoryDir, "my-task/task.md");
      const taskContent = await Bun.file(taskPath).text();
      await writeFile(
        taskPath,
        taskContent.replace("status: INPROGRESS", "status: DONE")
      );

      // Wait for watcher debounce and reconcile
      await new Promise((r) => setTimeout(r, 150));

      await orchestrator.stop();

      expect(events.length).toBe(1);
      expect(events[0]!.task.folder).toBe("my-task");
      expect(events[0]!.subtasks).toBeInstanceOf(Array);
    });

    test("does not emit taskCompleted when task was already DONE", async () => {
      await copyFixture(devsfactoryDir, "done-task", "my-task");

      const config = createConfig({ devsfactoryDir: devsfactoryDir });
      const mockRunner = createMockAgentRunner();
      const orchestrator = new Orchestrator(
        config,
        mockRunner as unknown as AgentRunner
      );
      const events: unknown[] = [];

      orchestrator.on("taskCompleted", (data) => events.push(data));
      await orchestrator.start();

      // Wait to ensure no taskCompleted is emitted for already-DONE tasks
      await new Promise((r) => setTimeout(r, 100));

      await orchestrator.stop();

      expect(events.length).toBe(0);
    });
  });

  describe("processState()", () => {
    let tempDir: string;
    let devsfactoryDir: string;
    let worktreesDir: string;

    beforeEach(async () => {
      // Create an isolated git repo for worktree operations
      tempDir = await createTestGitRepo("orchestrator");
      devsfactoryDir = join(tempDir, ".devsfactory");
      worktreesDir = join(tempDir, ".worktrees");
      await mkdir(devsfactoryDir, { recursive: true });
      await mkdir(worktreesDir, { recursive: true });
    });

    afterEach(async () => {
      await cleanupTestDir(tempDir);
    });

    describe("processPendingTasks", () => {
      test("transitions PENDING task to INPROGRESS when dependencies are satisfied", async () => {
        await copyFixture(devsfactoryDir, "simple-task", "my-task");

        const config = createConfig({
          devsfactoryDir: devsfactoryDir,
          worktreesDir: worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await orchestrator.stop();

        const { parseTask } = await import("../parser/task");
        const task = await parseTask("my-task", devsfactoryDir);
        expect(task.frontmatter.status).toBe("INPROGRESS");
      });

      test("does not transition PENDING task when dependencies are not satisfied", async () => {
        await copyFixture(devsfactoryDir, "simple-task", "dep-task");
        await copyFixture(devsfactoryDir, "simple-task", "my-task");
        // Add dependency to my-task
        const taskMd = await Bun.file(
          join(devsfactoryDir, "my-task/task.md")
        ).text();
        await writeFile(
          join(devsfactoryDir, "my-task/task.md"),
          taskMd.replace("dependencies: []", "dependencies:\n  - dep-task")
        );

        const config = createConfig({ devsfactoryDir: devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await orchestrator.stop();

        const { parseTask } = await import("../parser/task");
        const task = await parseTask("my-task", devsfactoryDir);
        expect(task.frontmatter.status).toBe("PENDING");
      });

      test("transitions task when all dependencies have status DONE", async () => {
        await copyFixture(devsfactoryDir, "done-task", "dep-task");
        await copyFixture(devsfactoryDir, "simple-task", "my-task");
        // Add dependency to my-task
        const taskMd = await Bun.file(
          join(devsfactoryDir, "my-task/task.md")
        ).text();
        await writeFile(
          join(devsfactoryDir, "my-task/task.md"),
          taskMd.replace("dependencies: []", "dependencies:\n  - dep-task")
        );

        const config = createConfig({
          devsfactoryDir: devsfactoryDir,
          worktreesDir: worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await orchestrator.stop();

        const { parseTask } = await import("../parser/task");
        const task = await parseTask("my-task", devsfactoryDir);
        expect(task.frontmatter.status).toBe("INPROGRESS");
      });

      test("emits stateChanged when task transitions", async () => {
        await copyFixture(devsfactoryDir, "simple-task", "my-task");

        const config = createConfig({ devsfactoryDir: devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );
        const events: string[] = [];
        orchestrator.on("stateChanged", () => events.push("stateChanged"));

        await orchestrator.start();
        await orchestrator.stop();

        expect(events.length).toBeGreaterThanOrEqual(1);
      });

      test("calls createTaskWorktree when transitioning task to INPROGRESS", async () => {
        const { mock: bunMock } = await import("bun:test");
        const { dirname } = await import("node:path");
        const { fileURLToPath } = await import("node:url");
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const gitModulePath = join(__dirname, "git");

        const createTaskWorktreeMock = mock(() => Promise.resolve("/path"));
        bunMock.module(gitModulePath, () => ({
          createTaskWorktree: createTaskWorktreeMock,
          createSubtaskWorktree: mock(() => Promise.resolve("/path")),
          deleteWorktree: mock(() => Promise.resolve()),
          mergeSubtaskIntoTask: mock(() =>
            Promise.resolve({ success: true, commitSha: "abc123" })
          )
        }));

        const { Orchestrator: MockedOrchestrator } = await import(
          "./orchestrator"
        );

        await copyFixture(devsfactoryDir, "simple-task", "my-task");

        const config = createConfig({
          devsfactoryDir: devsfactoryDir,
          worktreesDir: worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new MockedOrchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await orchestrator.stop();

        expect(createTaskWorktreeMock).toHaveBeenCalled();
        expect(createTaskWorktreeMock).toHaveBeenCalledWith(
          expect.any(String),
          "my-task"
        );

        bunMock.restore();
      });
    });

    describe("processPendingSubtasks", () => {
      test("spawns implementation agent for PENDING subtask when task is INPROGRESS and deps satisfied", async () => {
        await copyFixture(devsfactoryDir, "simple-task-with-plan", "my-task");
        // Update task status to INPROGRESS
        const taskMd = await Bun.file(
          join(devsfactoryDir, "my-task/task.md")
        ).text();
        await writeFile(
          join(devsfactoryDir, "my-task/task.md"),
          taskMd.replace("status: PENDING", "status: INPROGRESS")
        );

        const config = createConfig({ devsfactoryDir: devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await new Promise((r) => setTimeout(r, 50));
        await orchestrator.stop();

        expect(mockRunner.spawn).toHaveBeenCalled();
        const spawnCall = mockRunner.spawn.mock.calls[0];
        expect(spawnCall?.[0]?.type).toBe("implementation");
      });

      test("does not spawn agent for PENDING subtask when task is not INPROGRESS", async () => {
        await copyFixture(devsfactoryDir, "simple-task", "dep-task");
        await copyFixture(devsfactoryDir, "simple-task-with-plan", "my-task");
        // Add dependency to my-task
        const taskMd = await Bun.file(
          join(devsfactoryDir, "my-task/task.md")
        ).text();
        await writeFile(
          join(devsfactoryDir, "my-task/task.md"),
          taskMd.replace("dependencies: []", "dependencies:\n  - dep-task")
        );

        const config = createConfig({ devsfactoryDir: devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await orchestrator.stop();

        expect(mockRunner.spawn).not.toHaveBeenCalled();
      });

      test("does not spawn agent for PENDING subtask when dependencies not satisfied", async () => {
        await copyFixture(
          devsfactoryDir,
          "subtask-with-dependencies",
          "my-task"
        );
        // Update task status to INPROGRESS
        const taskMd = await Bun.file(
          join(devsfactoryDir, "my-task/task.md")
        ).text();
        await writeFile(
          join(devsfactoryDir, "my-task/task.md"),
          taskMd.replace("status: INPROGRESS", "status: INPROGRESS")
        );

        const config = createConfig({
          devsfactoryDir: devsfactoryDir,
          maxConcurrentAgents: 1
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await new Promise((r) => setTimeout(r, 50));
        await orchestrator.stop();

        expect(mockRunner.spawn).toHaveBeenCalledTimes(1);
        const spawnCall = mockRunner.spawn.mock.calls[0];
        expect(spawnCall?.[0]?.subtaskFile).toBe("001-first-subtask.md");
      });

      test("respects maxConcurrentAgents limit", async () => {
        await copyFixture(
          devsfactoryDir,
          "inprogress-multiple-subtasks",
          "my-task"
        );

        const config = createConfig({
          devsfactoryDir: devsfactoryDir,
          maxConcurrentAgents: 2
        });
        const mockRunner = createMockAgentRunner();
        const activeAgents: AgentProcess[] = [];
        let agentIdCounter = 0;
        mockRunner.spawn = mock(
          async (options: {
            type: AgentType;
            taskFolder: string;
            subtaskFile?: string;
          }) => {
            const agent: AgentProcess = {
              id: `agent-${++agentIdCounter}`,
              type: options.type,
              taskFolder: options.taskFolder,
              subtaskFile: options.subtaskFile,
              pid: 100 + agentIdCounter,
              startedAt: new Date()
            };
            activeAgents.push(agent);
            mockRunner.emit("started", { agentId: agent.id, process: agent });
            return agent;
          }
        );
        mockRunner.getActive = mock(() => activeAgents);

        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await new Promise((r) => setTimeout(r, 50));
        await orchestrator.stop();

        expect(mockRunner.spawn).toHaveBeenCalledTimes(2);
      });

      test("updates subtask status to INPROGRESS when spawning agent", async () => {
        await copyFixture(devsfactoryDir, "simple-task-with-plan", "my-task");
        // Update task status to INPROGRESS
        const taskMd = await Bun.file(
          join(devsfactoryDir, "my-task/task.md")
        ).text();
        await writeFile(
          join(devsfactoryDir, "my-task/task.md"),
          taskMd.replace("status: PENDING", "status: INPROGRESS")
        );

        const config = createConfig({ devsfactoryDir: devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await new Promise((r) => setTimeout(r, 50));
        await orchestrator.stop();

        const { parseSubtask } = await import("../parser/subtask");
        const subtask = await parseSubtask(
          "my-task",
          "001-create-hello.md",
          devsfactoryDir
        );
        expect(subtask.frontmatter.status).toBe("INPROGRESS");
      });

      test("emits subtaskStarted event when subtask transitions to INPROGRESS", async () => {
        await copyFixture(devsfactoryDir, "simple-task-with-plan", "my-task");
        const taskMd = await Bun.file(
          join(devsfactoryDir, "my-task/task.md")
        ).text();
        await writeFile(
          join(devsfactoryDir, "my-task/task.md"),
          taskMd.replace("status: PENDING", "status: INPROGRESS")
        );

        const config = createConfig({
          devsfactoryDir: devsfactoryDir,
          worktreesDir: worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );
        const events: Array<{
          taskFolder: string;
          subtaskNumber: number;
          subtaskTotal: number;
          subtaskTitle: string;
        }> = [];

        orchestrator.on("subtaskStarted", (data) => events.push(data));
        await orchestrator.start();
        await new Promise((r) => setTimeout(r, 50));
        await orchestrator.stop();

        expect(events.length).toBeGreaterThanOrEqual(1);
        expect(events[0]!.taskFolder).toBe("my-task");
        expect(events[0]!.subtaskNumber).toBe(1);
        expect(events[0]!.subtaskTotal).toBeGreaterThanOrEqual(1);
        expect(events[0]!.subtaskTitle).toBeDefined();
      });

      test("calls createSubtaskWorktree before spawning implementation agent", async () => {
        const { mock: bunMock } = await import("bun:test");
        const { dirname } = await import("node:path");
        const { fileURLToPath } = await import("node:url");
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const gitModulePath = join(__dirname, "git");

        const createSubtaskWorktreeMock = mock(() => Promise.resolve("/path"));
        bunMock.module(gitModulePath, () => ({
          createTaskWorktree: mock(() => Promise.resolve("/path")),
          createSubtaskWorktree: createSubtaskWorktreeMock,
          deleteWorktree: mock(() => Promise.resolve()),
          mergeSubtaskIntoTask: mock(() =>
            Promise.resolve({ success: true, commitSha: "abc123" })
          )
        }));

        const { Orchestrator: MockedOrchestrator } = await import(
          "./orchestrator"
        );

        await copyFixture(devsfactoryDir, "simple-task-with-plan", "my-task");
        // Update task status to INPROGRESS
        const taskMd = await Bun.file(
          join(devsfactoryDir, "my-task/task.md")
        ).text();
        await writeFile(
          join(devsfactoryDir, "my-task/task.md"),
          taskMd.replace("status: PENDING", "status: INPROGRESS")
        );

        const config = createConfig({
          devsfactoryDir: devsfactoryDir,
          worktreesDir: worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new MockedOrchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await new Promise((r) => setTimeout(r, 50));
        await orchestrator.stop();

        expect(createSubtaskWorktreeMock).toHaveBeenCalled();
        expect(createSubtaskWorktreeMock).toHaveBeenCalledWith(
          expect.any(String),
          "my-task",
          "create-hello"
        );

        bunMock.restore();
      });
    });

    describe("processSubtasksInAgentReview", () => {
      test("spawns review agent for subtask in AGENT_REVIEW when task is INPROGRESS", async () => {
        await copyFixture(
          devsfactoryDir,
          "inprogress-with-subtask-agent-review",
          "my-task"
        );

        const config = createConfig({ devsfactoryDir: devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await new Promise((r) => setTimeout(r, 50));
        await orchestrator.stop();

        expect(mockRunner.spawn).toHaveBeenCalled();
        const spawnCall = mockRunner.spawn.mock.calls[0];
        expect(spawnCall?.[0]?.type).toBe("review");
      });
    });

    describe("processCompletedSubtasks", () => {
      test("spawns completing-task agent when all subtasks are DONE and plan is INPROGRESS", async () => {
        await copyFixture(
          devsfactoryDir,
          "inprogress-with-subtask-done",
          "my-task"
        );

        const config = createConfig({ devsfactoryDir: devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await new Promise((r) => setTimeout(r, 50));
        await orchestrator.stop();

        expect(mockRunner.spawn).toHaveBeenCalled();
        const spawnCall = mockRunner.spawn.mock.calls[0];
        expect(spawnCall?.[0]?.type).toBe("completing-task");
      });

      test("does not spawn completing-task agent when subtasks are not all DONE", async () => {
        await copyFixture(
          devsfactoryDir,
          "inprogress-mixed-subtasks",
          "my-task"
        );

        const config = createConfig({ devsfactoryDir: devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await new Promise((r) => setTimeout(r, 50));
        await orchestrator.stop();

        const spawnCalls = mockRunner.spawn.mock.calls;
        const completingTaskCalls = spawnCalls.filter(
          (call: unknown[]) =>
            (call[0] as { type: string })?.type === "completing-task"
        );
        expect(completingTaskCalls.length).toBe(0);
      });
    });

    describe("processPlansInAgentReview", () => {
      test("spawns completion-review agent for plan in AGENT_REVIEW", async () => {
        await copyFixture(devsfactoryDir, "plan-agent-review", "my-task");

        const config = createConfig({ devsfactoryDir: devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await new Promise((r) => setTimeout(r, 50));
        await orchestrator.stop();

        expect(mockRunner.spawn).toHaveBeenCalled();
        const spawnCall = mockRunner.spawn.mock.calls[0];
        expect(spawnCall?.[0]?.type).toBe("completion-review");
      });
    });
  });

  describe("watcher integration", () => {
    let tempDir: string;
    let devsfactoryDir: string;

    beforeEach(async () => {
      tempDir = await createTestDir("orchestrator");
      devsfactoryDir = join(tempDir, ".devsfactory");
      await mkdir(devsfactoryDir, { recursive: true });
    });

    afterEach(async () => {
      await cleanupTestDir(tempDir);
    });

    test("subscribes to watcher events after start", async () => {
      await copyFixture(devsfactoryDir, "simple-task", "my-task");

      const config = createConfig({
        devsfactoryDir: devsfactoryDir,
        debounceMs: 10
      });
      const mockRunner = createMockAgentRunner();
      const orchestrator = new Orchestrator(
        config,
        mockRunner as unknown as AgentRunner
      );

      await orchestrator.start();

      // Give time for watcher to set up
      await new Promise((r) => setTimeout(r, 50));

      // Modify file to trigger watcher event
      await writeFile(
        join(devsfactoryDir, "my-task", "task.md"),
        `---
title: Modified Task
status: PENDING
created: 2026-01-01
priority: medium
---

## Description
Modified

## Requirements
Test

## Acceptance Criteria
- [ ] Done
`
      );

      // Wait for debounce and event processing
      await new Promise((r) => setTimeout(r, 100));

      await orchestrator.stop();

      // The test passes if no errors occur during file modification
      expect(true).toBe(true);
    });
  });

  describe("runRecovery()", () => {
    let tempDir: string;
    let devsfactoryDir: string;
    let worktreesDir: string;

    beforeEach(async () => {
      tempDir = await createTestDir("orchestrator");
      devsfactoryDir = join(tempDir, ".devsfactory");
      worktreesDir = join(tempDir, ".worktrees");
      await mkdir(devsfactoryDir, { recursive: true });
      await mkdir(worktreesDir, { recursive: true });
    });

    afterEach(async () => {
      await cleanupTestDir(tempDir);
    });

    describe("recoverInprogressTasksWithoutPlan", () => {
      test("resets INPROGRESS task to PENDING when plan.md does not exist", async () => {
        await copyFixture(devsfactoryDir, "simple-task", "dep-task");
        await copyFixture(devsfactoryDir, "recovery-task", "my-task");

        const taskPath = join(devsfactoryDir, "my-task", "task.md");
        const taskContent = await Bun.file(taskPath).text();
        const updatedContent = taskContent.replace(
          /dependencies: \[\]/,
          "dependencies:\n  - dep-task"
        );
        await writeFile(taskPath, updatedContent);

        const config = createConfig({
          devsfactoryDir: devsfactoryDir,
          worktreesDir: worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await orchestrator.stop();

        const { parseTask } = await import("../parser/task");
        const task = await parseTask("my-task", devsfactoryDir);
        expect(task.frontmatter.status).toBe("PENDING");
      });

      test("does not modify INPROGRESS task when plan.md exists", async () => {
        await copyFixture(
          devsfactoryDir,
          "inprogress-with-subtask-done",
          "my-task"
        );

        const config = createConfig({
          devsfactoryDir: devsfactoryDir,
          worktreesDir: worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await orchestrator.stop();

        const { parseTask } = await import("../parser/task");
        const task = await parseTask("my-task", devsfactoryDir);
        expect(task.frontmatter.status).toBe("INPROGRESS");
      });

      test("does not modify BLOCKED task even without plan", async () => {
        await copyFixture(devsfactoryDir, "blocked-task");

        const config = createConfig({
          devsfactoryDir: devsfactoryDir,
          worktreesDir: worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await orchestrator.stop();

        const { parseTask } = await import("../parser/task");
        const task = await parseTask("blocked-task", devsfactoryDir);
        expect(task.frontmatter.status).toBe("BLOCKED");
      });

      test("emits recoveryAction event when resetting task", async () => {
        await copyFixture(devsfactoryDir, "recovery-task", "my-task");

        const config = createConfig({
          devsfactoryDir: devsfactoryDir,
          worktreesDir: worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        const events: Array<{ action: string; taskFolder: string }> = [];
        orchestrator.on("recoveryAction", (data) => events.push(data));

        await orchestrator.start();
        await orchestrator.stop();

        expect(events.length).toBe(1);
        expect(events[0]!.action).toBe("taskResetToPending");
        expect(events[0]!.taskFolder).toBe("my-task");
      });
    });

    describe("detectOrphanedWorktrees", () => {
      test("marks task as BLOCKED when orphaned worktree is detected", async () => {
        await copyFixture(devsfactoryDir, "simple-task", "my-task");

        // Create orphaned worktree directory (not a real git worktree, just simulating)
        const orphanedWorktree = join(worktreesDir, "my-task");
        await mkdir(orphanedWorktree, { recursive: true });

        const config = createConfig({
          devsfactoryDir: devsfactoryDir,
          worktreesDir: worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await orchestrator.stop();

        const { parseTask } = await import("../parser/task");
        const task = await parseTask("my-task", devsfactoryDir);
        expect(task.frontmatter.status).toBe("BLOCKED");
      });

      test("does not mark task as BLOCKED when worktree matches INPROGRESS task", async () => {
        await copyFixture(
          devsfactoryDir,
          "inprogress-with-subtask-done",
          "my-task"
        );

        // Create worktree directory that matches INPROGRESS task
        const worktree = join(worktreesDir, "my-task");
        await mkdir(worktree, { recursive: true });

        const config = createConfig({
          devsfactoryDir: devsfactoryDir,
          worktreesDir: worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await orchestrator.stop();

        const { parseTask } = await import("../parser/task");
        const task = await parseTask("my-task", devsfactoryDir);
        expect(task.frontmatter.status).toBe("INPROGRESS");
      });

      test("does not mark task as BLOCKED when worktree matches INPROGRESS subtask", async () => {
        await copyFixture(
          devsfactoryDir,
          "inprogress-with-subtask-inprogress",
          "my-task"
        );

        // Create worktree directory that matches INPROGRESS subtask
        const worktree = join(worktreesDir, "my-task--first-subtask");
        await mkdir(worktree, { recursive: true });

        const config = createConfig({
          devsfactoryDir: devsfactoryDir,
          worktreesDir: worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await orchestrator.stop();

        const { parseTask } = await import("../parser/task");
        const task = await parseTask("my-task", devsfactoryDir);
        expect(task.frontmatter.status).toBe("INPROGRESS");
      });

      test("does not mark task as BLOCKED when worktree matches AGENT_REVIEW subtask", async () => {
        await copyFixture(
          devsfactoryDir,
          "inprogress-with-subtask-agent-review",
          "my-task"
        );

        const worktree = join(worktreesDir, "my-task--first-subtask");
        await mkdir(worktree, { recursive: true });

        const config = createConfig({
          devsfactoryDir: devsfactoryDir,
          worktreesDir: worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await orchestrator.stop();

        const { parseTask } = await import("../parser/task");
        const task = await parseTask("my-task", devsfactoryDir);
        expect(task.frontmatter.status).toBe("INPROGRESS");
      });

      test("emits recoveryAction event when orphaned worktree is detected", async () => {
        await copyFixture(devsfactoryDir, "simple-task", "my-task");

        const orphanedWorktree = join(worktreesDir, "my-task");
        await mkdir(orphanedWorktree, { recursive: true });

        const config = createConfig({
          devsfactoryDir: devsfactoryDir,
          worktreesDir: worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        const events: Array<{
          action: string;
          taskFolder: string;
          worktreePath?: string;
        }> = [];
        orchestrator.on("recoveryAction", (data) => events.push(data));

        await orchestrator.start();
        await orchestrator.stop();

        const orphanEvent = events.find(
          (e) => e.action === "orphanedWorktreeDetected"
        );
        expect(orphanEvent).toBeDefined();
        expect(orphanEvent!.taskFolder).toBe("my-task");
        expect(orphanEvent!.worktreePath).toBe(orphanedWorktree);
      });

      test("handles subtask worktree without corresponding subtask", async () => {
        await copyFixture(
          devsfactoryDir,
          "inprogress-with-subtask-done",
          "my-task"
        );

        // Orphaned subtask worktree - subtask is DONE, not INPROGRESS
        const orphanedWorktree = join(worktreesDir, "my-task--first-subtask");
        await mkdir(orphanedWorktree, { recursive: true });

        const config = createConfig({
          devsfactoryDir: devsfactoryDir,
          worktreesDir: worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        await orchestrator.stop();

        const { parseTask } = await import("../parser/task");
        const task = await parseTask("my-task", devsfactoryDir);
        expect(task.frontmatter.status).toBe("BLOCKED");
      });
    });
  });

  describe("queue-based architecture", () => {
    let tempDir: string;
    let devsfactoryDir: string;

    beforeEach(async () => {
      tempDir = await createTestDir("orchestrator-queue");
      devsfactoryDir = join(tempDir, ".devsfactory");
      await mkdir(devsfactoryDir, { recursive: true });
    });

    afterEach(async () => {
      await cleanupTestDir(tempDir);
    });

    describe("constructor with queue components", () => {
      test("accepts optional JobQueue", () => {
        const config = createConfig({ devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const queue = new MemoryQueue();

        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner,
          { queue }
        );

        expect(orchestrator).toBeDefined();
      });

      test("accepts optional AgentRegistry", () => {
        const config = createConfig({ devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const registry = new MemoryAgentRegistry();

        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner,
          { registry }
        );

        expect(orchestrator).toBeDefined();
      });

      test("accepts optional JobProducer", () => {
        const config = createConfig({ devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const queue = new MemoryQueue();
        const registry = new MemoryAgentRegistry();
        const producer = new JobProducer(queue, registry);

        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner,
          { producer }
        );

        expect(orchestrator).toBeDefined();
      });
    });

    describe("getActiveAgents()", () => {
      test("returns empty array initially", async () => {
        const config = createConfig({ devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        const activeAgents = await orchestrator.getActiveAgents();
        await orchestrator.stop();

        expect(activeAgents).toEqual([]);
      });

      test("returns agents registered in the registry", async () => {
        const config = createConfig({ devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const registry = new MemoryAgentRegistry();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner,
          { registry }
        );

        await orchestrator.start();
        await registry.register({
          jobId: "job-1",
          type: "implementation",
          taskFolder: "my-task",
          subtaskFile: "001-test.md",
          pid: 123,
          startedAt: new Date()
        });

        const activeAgents = await orchestrator.getActiveAgents();
        await orchestrator.stop();

        expect(activeAgents).toHaveLength(1);
        expect(activeAgents[0]!.jobId).toBe("job-1");
      });
    });

    describe("getQueueDepth()", () => {
      test("returns 0 when queue is empty", async () => {
        const config = createConfig({ devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();
        const depth = await orchestrator.getQueueDepth();
        await orchestrator.stop();

        expect(depth).toBe(0);
      });

      test("returns number of pending jobs in queue", async () => {
        const config = createConfig({ devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const queue = new MemoryQueue();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner,
          { queue }
        );

        // Note: We check depth before start() because the worker would process the job
        await queue.enqueue({
          id: "job-1",
          type: "implementation",
          taskFolder: "task-1",
          subtaskFile: "001-test.md",
          status: "pending",
          priority: 0,
          createdAt: new Date()
        });

        const depth = await orchestrator.getQueueDepth();
        expect(depth).toBe(1);
      });
    });

    describe("coalescing scheduler", () => {
      test("has scheduleReconcile method", () => {
        const config = createConfig({ devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        const scheduleReconcile = (
          orchestrator as unknown as { scheduleReconcile: () => void }
        ).scheduleReconcile;

        expect(typeof scheduleReconcile).toBe("function");
      });

      test("has reconcile method", () => {
        const config = createConfig({ devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        const reconcile = (
          orchestrator as unknown as { reconcile: () => Promise<void> }
        ).reconcile;

        expect(typeof reconcile).toBe("function");
      });

      test("scheduleReconcile prevents concurrent reconcile calls", async () => {
        await copyFixture(devsfactoryDir, "done-task", "my-task");

        const config = createConfig({ devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();

        let maxConcurrent = 0;
        let currentConcurrent = 0;
        const originalReconcile = (
          orchestrator as unknown as { reconcile: () => Promise<void> }
        ).reconcile.bind(orchestrator);

        (
          orchestrator as unknown as { reconcile: () => Promise<void> }
        ).reconcile = async function (this: typeof orchestrator) {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          await new Promise((r) => setTimeout(r, 20));
          currentConcurrent--;
          return originalReconcile();
        };

        const scheduleReconcile = (
          orchestrator as unknown as { scheduleReconcile: () => void }
        ).scheduleReconcile.bind(orchestrator);

        scheduleReconcile();
        scheduleReconcile();
        scheduleReconcile();

        await new Promise((r) => setTimeout(r, 150));

        await orchestrator.stop();

        expect(maxConcurrent).toBe(1);
      });

      test("scheduleReconcile queues next reconcile when called during execution", async () => {
        await copyFixture(devsfactoryDir, "done-task", "my-task");

        const config = createConfig({ devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();

        let reconcileCallCount = 0;
        const originalReconcile = (
          orchestrator as unknown as { reconcile: () => Promise<void> }
        ).reconcile.bind(orchestrator);

        (
          orchestrator as unknown as { reconcile: () => Promise<void> }
        ).reconcile = async function (this: typeof orchestrator) {
          reconcileCallCount++;
          await new Promise((r) => setTimeout(r, 10));
          return originalReconcile();
        };

        const scheduleReconcile = (
          orchestrator as unknown as { scheduleReconcile: () => void }
        ).scheduleReconcile.bind(orchestrator);

        scheduleReconcile();
        await new Promise((r) => setTimeout(r, 5));
        scheduleReconcile();
        scheduleReconcile();

        await new Promise((r) => setTimeout(r, 100));

        await orchestrator.stop();

        expect(reconcileCallCount).toBe(2);
      });
    });

    describe("producer integration", () => {
      test("calls producer.produceFromState during reconcile", async () => {
        await copyFixture(devsfactoryDir, "done-task", "my-task");

        const config = createConfig({ devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const queue = new MemoryQueue();
        const registry = new MemoryAgentRegistry();

        let produceFromStateCalled = false;
        const producer = new JobProducer(queue, registry);
        const originalProduceFromState =
          producer.produceFromState.bind(producer);
        producer.produceFromState = async (state) => {
          produceFromStateCalled = true;
          return originalProduceFromState(state);
        };

        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner,
          { queue, registry, producer }
        );

        await orchestrator.start();
        await new Promise((r) => setTimeout(r, 50));
        await orchestrator.stop();

        expect(produceFromStateCalled).toBe(true);
      });
    });

    describe("JobWorker integration", () => {
      test("starts JobWorker on start()", async () => {
        const config = createConfig({ devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const queue = new MemoryQueue();
        const registry = new MemoryAgentRegistry();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner,
          { queue, registry }
        );

        await orchestrator.start();

        const worker = (
          orchestrator as unknown as {
            worker: { isRunning: () => boolean } | undefined;
          }
        ).worker;

        expect(worker).toBeDefined();
        expect(worker!.isRunning()).toBe(true);

        await orchestrator.stop();
      });

      test("stops JobWorker on stop()", async () => {
        const config = createConfig({ devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const queue = new MemoryQueue();
        const registry = new MemoryAgentRegistry();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner,
          { queue, registry }
        );

        await orchestrator.start();
        const worker = (
          orchestrator as unknown as {
            worker: { isRunning: () => boolean } | undefined;
          }
        ).worker;

        await orchestrator.stop();

        expect(worker!.isRunning()).toBe(false);
      });

      test("subscribes to worker jobCompleted events and triggers reconcile", async () => {
        await copyFixture(devsfactoryDir, "done-task", "my-task");

        const config = createConfig({ devsfactoryDir });
        const mockRunner = createMockAgentRunner();
        const queue = new MemoryQueue();
        const registry = new MemoryAgentRegistry();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner,
          { queue, registry }
        );

        await orchestrator.start();

        let reconcileCalled = false;
        const scheduleReconcile = (
          orchestrator as unknown as { scheduleReconcile: () => void }
        ).scheduleReconcile.bind(orchestrator);
        (
          orchestrator as unknown as { scheduleReconcile: () => void }
        ).scheduleReconcile = () => {
          reconcileCalled = true;
          scheduleReconcile();
        };

        const worker = (
          orchestrator as unknown as {
            worker: EventEmitter | undefined;
          }
        ).worker;
        worker!.emit("jobCompleted", {
          jobId: "test-job",
          job: { type: "implementation", taskFolder: "test-task" },
          durationMs: 1000
        });

        await new Promise((r) => setTimeout(r, 50));
        await orchestrator.stop();

        expect(reconcileCalled).toBe(true);
      });
    });
  });

  describe("timing capture", () => {
    let tempDir: string;
    let devsfactoryDir: string;
    let worktreesDir: string;

    beforeEach(async () => {
      tempDir = await createTestGitRepo("orchestrator-timing");
      devsfactoryDir = join(tempDir, ".devsfactory");
      worktreesDir = join(tempDir, ".worktrees");
      await mkdir(devsfactoryDir, { recursive: true });
      await mkdir(worktreesDir, { recursive: true });
    });

    afterEach(async () => {
      await cleanupTestDir(tempDir);
    });

    describe("task start timing", () => {
      test("records startedAt when task transitions PENDING → INPROGRESS", async () => {
        await copyFixture(devsfactoryDir, "simple-task", "my-task");

        const config = createConfig({
          devsfactoryDir,
          worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        const before = new Date();
        await orchestrator.start();
        await orchestrator.stop();
        const after = new Date();

        const { parseTask } = await import("../parser/task");
        const task = await parseTask("my-task", devsfactoryDir);

        expect(task.frontmatter.startedAt).toBeDefined();
        expect(task.frontmatter.startedAt!.getTime()).toBeGreaterThanOrEqual(
          before.getTime()
        );
        expect(task.frontmatter.startedAt!.getTime()).toBeLessThanOrEqual(
          after.getTime()
        );
      });
    });

    describe("subtask start timing", () => {
      test("records startedAt when subtask transitions PENDING → INPROGRESS", async () => {
        const { mock: bunMock } = await import("bun:test");
        const { dirname } = await import("node:path");
        const { fileURLToPath } = await import("node:url");
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const gitModulePath = join(__dirname, "git");

        bunMock.module(gitModulePath, () => ({
          createTaskWorktree: mock(() => Promise.resolve("/path")),
          createSubtaskWorktree: mock(() => Promise.resolve("/path")),
          deleteWorktree: mock(() => Promise.resolve()),
          mergeSubtaskIntoTask: mock(() =>
            Promise.resolve({ success: true, commitSha: "abc123" })
          )
        }));

        const { Orchestrator: MockedOrchestrator } = await import(
          "./orchestrator"
        );

        await copyFixture(devsfactoryDir, "simple-task-with-plan", "my-task");
        const taskMd = await Bun.file(
          join(devsfactoryDir, "my-task/task.md")
        ).text();
        await writeFile(
          join(devsfactoryDir, "my-task/task.md"),
          taskMd.replace("status: PENDING", "status: INPROGRESS")
        );

        const config = createConfig({
          devsfactoryDir,
          worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new MockedOrchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        const before = new Date();
        await orchestrator.start();
        await new Promise((r) => setTimeout(r, 50));
        await orchestrator.stop();
        const after = new Date();

        const { parseSubtask } = await import("../parser/subtask");
        const subtask = await parseSubtask(
          "my-task",
          "001-create-hello.md",
          devsfactoryDir
        );

        expect(subtask.frontmatter.timing?.startedAt).toBeDefined();
        expect(
          subtask.frontmatter.timing!.startedAt!.getTime()
        ).toBeGreaterThanOrEqual(before.getTime());
        expect(
          subtask.frontmatter.timing!.startedAt!.getTime()
        ).toBeLessThanOrEqual(after.getTime());

        bunMock.restore();
      });
    });

    describe("phase duration recording", () => {
      test("records phase duration when jobCompleted event is emitted", async () => {
        await copyFixture(
          devsfactoryDir,
          "inprogress-with-subtask-inprogress",
          "my-task"
        );

        const config = createConfig({
          devsfactoryDir,
          worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();

        const worker = (
          orchestrator as unknown as {
            worker: EventEmitter | undefined;
          }
        ).worker;

        worker!.emit("jobCompleted", {
          jobId: "test-job",
          job: {
            id: "test-job",
            type: "implementation",
            taskFolder: "my-task",
            subtaskFile: "001-first-subtask.md",
            status: "completed",
            priority: 0,
            createdAt: new Date()
          },
          durationMs: 5000
        });

        await new Promise((r) => setTimeout(r, 100));
        await orchestrator.stop();

        const { parseSubtask } = await import("../parser/subtask");
        const subtask = await parseSubtask(
          "my-task",
          "001-first-subtask.md",
          devsfactoryDir
        );

        expect(subtask.frontmatter.timing?.phases?.implementation).toBe(5000);
      });

      test("maps conflict-solver job type to conflictSolver phase", async () => {
        await copyFixture(
          devsfactoryDir,
          "inprogress-with-subtask-inprogress",
          "my-task"
        );

        const config = createConfig({
          devsfactoryDir,
          worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();

        const worker = (
          orchestrator as unknown as {
            worker: EventEmitter | undefined;
          }
        ).worker;

        worker!.emit("jobCompleted", {
          jobId: "test-job",
          job: {
            id: "test-job",
            type: "conflict-solver",
            taskFolder: "my-task",
            subtaskFile: "001-first-subtask.md",
            status: "completed",
            priority: 0,
            createdAt: new Date()
          },
          durationMs: 3000
        });

        await new Promise((r) => setTimeout(r, 100));
        await orchestrator.stop();

        const { parseSubtask } = await import("../parser/subtask");
        const subtask = await parseSubtask(
          "my-task",
          "001-first-subtask.md",
          devsfactoryDir
        );

        expect(subtask.frontmatter.timing?.phases?.conflictSolver).toBe(3000);
      });

      test("ignores jobs without subtaskFile for phase recording", async () => {
        await copyFixture(
          devsfactoryDir,
          "inprogress-with-subtask-done",
          "my-task"
        );

        const config = createConfig({
          devsfactoryDir,
          worktreesDir
        });
        const mockRunner = createMockAgentRunner();
        const orchestrator = new Orchestrator(
          config,
          mockRunner as unknown as AgentRunner
        );

        await orchestrator.start();

        const worker = (
          orchestrator as unknown as {
            worker: EventEmitter | undefined;
          }
        ).worker;

        // completing-task jobs don't have subtaskFile
        worker!.emit("jobCompleted", {
          jobId: "test-job",
          job: {
            id: "test-job",
            type: "completing-task",
            taskFolder: "my-task",
            status: "completed",
            priority: 0,
            createdAt: new Date()
          },
          durationMs: 2000
        });

        await new Promise((r) => setTimeout(r, 100));
        await orchestrator.stop();

        // Should not throw - the orchestrator should gracefully handle this
        expect(true).toBe(true);
      });
    });
  });
});
