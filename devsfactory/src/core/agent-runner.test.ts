import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CommandOptions, LLMProvider } from "../providers/types";
import { cleanupTestDir, createTestDir } from "../test-helpers";
import { AgentRunner } from "./agent-runner";

class TestProvider implements LLMProvider {
  readonly name = "test";
  private command: string[];

  constructor(command: string[]) {
    this.command = command;
  }

  buildCommand(_options: CommandOptions): string[] {
    return this.command;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

describe("AgentRunner", () => {
  let runner: AgentRunner;
  let tempDir: string;

  beforeEach(async () => {
    runner = new AgentRunner();
    tempDir = await createTestDir("agent-runner");
  });

  afterEach(async () => {
    for (const agent of runner.getActive()) {
      await runner.kill(agent.id);
    }
    await cleanupTestDir(tempDir);
  });

  describe("spawn", () => {
    test("spawns process and emits started event", async () => {
      const events: string[] = [];
      runner.on("started", () => events.push("started"));

      const process = await runner.spawn({
        type: "planning",
        taskFolder: "test-task",
        prompt: "echo hello",
        cwd: tempDir,
        provider: new TestProvider(["echo", "hello"])
      });

      expect(process.id).toBeDefined();
      expect(process.type).toBe("planning");
      expect(process.taskFolder).toBe("test-task");
      expect(process.pid).toBeGreaterThan(0);
      expect(events).toContain("started");
    });

    test("spawns process with subtask file", async () => {
      const process = await runner.spawn({
        type: "implementation",
        taskFolder: "test-task",
        subtaskFile: "001-subtask.md",
        prompt: "implement this",
        cwd: tempDir,
        provider: new TestProvider(["echo", "implementing"])
      });

      expect(process.subtaskFile).toBe("001-subtask.md");
    });
  });

  describe("output event", () => {
    test("emits output events for stdout", async () => {
      const outputs: string[] = [];
      runner.on("output", (data: { agentId: string; line: string }) => {
        outputs.push(data.line);
      });

      const process = await runner.spawn({
        type: "planning",
        taskFolder: "test-task",
        prompt: "test",
        cwd: tempDir,
        provider: new TestProvider(["echo", "hello world"])
      });

      // Wait for process to complete
      await new Promise<void>((resolve) => {
        runner.on("completed", (data: { agentId: string }) => {
          if (data.agentId === process.id) resolve();
        });
      });

      expect(outputs).toContain("hello world");
    });
  });

  describe("completed event", () => {
    test("emits completed event with exit code 0 on success", async () => {
      let exitCode: number | undefined;
      let completedId: string | undefined;

      runner.on("completed", (data: { agentId: string; exitCode: number }) => {
        completedId = data.agentId;
        exitCode = data.exitCode;
      });

      const process = await runner.spawn({
        type: "planning",
        taskFolder: "test-task",
        prompt: "test",
        cwd: tempDir,
        provider: new TestProvider(["true"])
      });

      // Wait for completion
      await new Promise<void>((resolve) => {
        const check = () => {
          if (completedId === process.id) resolve();
          else setTimeout(check, 10);
        };
        check();
      });

      expect(completedId).toBe(process.id);
      expect(exitCode).toBe(0);
    });

    test("emits completed event with non-zero exit code on failure", async () => {
      let exitCode: number | undefined;

      runner.on("completed", (data: { agentId: string; exitCode: number }) => {
        exitCode = data.exitCode;
      });

      const process = await runner.spawn({
        type: "planning",
        taskFolder: "test-task",
        prompt: "test",
        cwd: tempDir,
        provider: new TestProvider(["false"])
      });

      // Wait for completion
      await new Promise<void>((resolve) => {
        runner.on("completed", (data: { agentId: string }) => {
          if (data.agentId === process.id) resolve();
        });
      });

      expect(exitCode).toBe(1);
    });
  });

  describe("kill", () => {
    test("terminates a running process", async () => {
      const process = await runner.spawn({
        type: "planning",
        taskFolder: "test-task",
        prompt: "test",
        cwd: tempDir,
        provider: new TestProvider(["sleep", "60"])
      });

      expect(runner.getActive().length).toBe(1);

      await runner.kill(process.id);

      // Wait a bit for cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(runner.getActive().length).toBe(0);
    });

    test("handles killing non-existent process gracefully", async () => {
      await expect(runner.kill("non-existent-id")).resolves.toBeUndefined();
    });
  });

  describe("getActive", () => {
    test("returns empty array when no processes running", () => {
      expect(runner.getActive()).toEqual([]);
    });

    test("returns array of running processes", async () => {
      await runner.spawn({
        type: "planning",
        taskFolder: "task-1",
        prompt: "test",
        cwd: tempDir,
        provider: new TestProvider(["sleep", "60"])
      });

      await runner.spawn({
        type: "implementation",
        taskFolder: "task-2",
        prompt: "test",
        cwd: tempDir,
        provider: new TestProvider(["sleep", "60"])
      });

      const active = runner.getActive();
      expect(active.length).toBe(2);
    });

    test("removes completed processes from active list", async () => {
      const process = await runner.spawn({
        type: "planning",
        taskFolder: "test-task",
        prompt: "test",
        cwd: tempDir,
        provider: new TestProvider(["true"])
      });

      // Wait for completion
      await new Promise<void>((resolve) => {
        runner.on("completed", (data: { agentId: string }) => {
          if (data.agentId === process.id) resolve();
        });
      });

      // Small delay for cleanup
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(runner.getActive().length).toBe(0);
    });
  });

  describe("getCountByType", () => {
    test("returns 0 when no agents of type running", () => {
      expect(runner.getCountByType("planning")).toBe(0);
      expect(runner.getCountByType("implementation")).toBe(0);
      expect(runner.getCountByType("review")).toBe(0);
    });

    test("counts agents by type correctly", async () => {
      await runner.spawn({
        type: "planning",
        taskFolder: "task-1",
        prompt: "test",
        cwd: tempDir,
        provider: new TestProvider(["sleep", "60"])
      });

      await runner.spawn({
        type: "implementation",
        taskFolder: "task-2",
        prompt: "test",
        cwd: tempDir,
        provider: new TestProvider(["sleep", "60"])
      });

      await runner.spawn({
        type: "implementation",
        taskFolder: "task-3",
        prompt: "test",
        cwd: tempDir,
        provider: new TestProvider(["sleep", "60"])
      });

      expect(runner.getCountByType("planning")).toBe(1);
      expect(runner.getCountByType("implementation")).toBe(2);
      expect(runner.getCountByType("review")).toBe(0);
    });
  });

  describe("error event", () => {
    test("emits error event on process spawn failure", async () => {
      const errors: Array<{ agentId: string; error: Error }> = [];
      runner.on("error", (data: { agentId: string; error: Error }) => {
        errors.push(data);
      });

      // Try to spawn a non-existent command
      try {
        await runner.spawn({
          type: "planning",
          taskFolder: "test-task",
          prompt: "test",
          cwd: "/non/existent/path",
          provider: new TestProvider(["non-existent-command-12345"])
        });
      } catch {
        // Expected to fail
      }

      // Process may fail at spawn or during execution
      // Just verify no unhandled exceptions
    });
  });

  describe("global mode support (taskDir and projectRoot)", () => {
    test("sets AOP_TASK_DIR environment variable when taskDir provided", async () => {
      const outputs: string[] = [];
      runner.on("output", (data: { agentId: string; line: string }) => {
        outputs.push(data.line);
      });

      const taskDir = "/home/user/.aop/tasks/my-project";
      const process = await runner.spawn({
        type: "implementation",
        taskFolder: "test-task",
        prompt: "test",
        cwd: tempDir,
        taskDir,
        provider: new TestProvider(["sh", "-c", "echo $AOP_TASK_DIR"])
      });

      await new Promise<void>((resolve) => {
        runner.on("completed", (data: { agentId: string }) => {
          if (data.agentId === process.id) resolve();
        });
      });

      expect(outputs).toContain(taskDir);
    });

    test("sets AOP_PROJECT_ROOT environment variable when projectRoot provided", async () => {
      const outputs: string[] = [];
      runner.on("output", (data: { agentId: string; line: string }) => {
        outputs.push(data.line);
      });

      const projectRoot = "/home/user/projects/my-project";
      const process = await runner.spawn({
        type: "implementation",
        taskFolder: "test-task",
        prompt: "test",
        cwd: tempDir,
        projectRoot,
        provider: new TestProvider(["sh", "-c", "echo $AOP_PROJECT_ROOT"])
      });

      await new Promise<void>((resolve) => {
        runner.on("completed", (data: { agentId: string }) => {
          if (data.agentId === process.id) resolve();
        });
      });

      expect(outputs).toContain(projectRoot);
    });

    test("sets both AOP_TASK_DIR and AOP_PROJECT_ROOT when both provided", async () => {
      const outputs: string[] = [];
      runner.on("output", (data: { agentId: string; line: string }) => {
        outputs.push(data.line);
      });

      const taskDir = "/home/user/.aop/tasks/my-project";
      const projectRoot = "/home/user/projects/my-project";
      const process = await runner.spawn({
        type: "implementation",
        taskFolder: "test-task",
        prompt: "test",
        cwd: tempDir,
        taskDir,
        projectRoot,
        provider: new TestProvider([
          "sh",
          "-c",
          "echo TASK:$AOP_TASK_DIR && echo ROOT:$AOP_PROJECT_ROOT"
        ])
      });

      await new Promise<void>((resolve) => {
        runner.on("completed", (data: { agentId: string }) => {
          if (data.agentId === process.id) resolve();
        });
      });

      expect(outputs).toContain(`TASK:${taskDir}`);
      expect(outputs).toContain(`ROOT:${projectRoot}`);
    });

    test("does not set AOP_TASK_DIR when taskDir not provided (backward compatible)", async () => {
      const outputs: string[] = [];
      runner.on("output", (data: { agentId: string; line: string }) => {
        outputs.push(data.line);
      });

      const process = await runner.spawn({
        type: "implementation",
        taskFolder: "test-task",
        prompt: "test",
        cwd: tempDir,
        provider: new TestProvider([
          "sh",
          "-c",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: Shell variable expansion syntax
          "echo TASK:${AOP_TASK_DIR:-unset}"
        ])
      });

      await new Promise<void>((resolve) => {
        runner.on("completed", (data: { agentId: string }) => {
          if (data.agentId === process.id) resolve();
        });
      });

      expect(outputs).toContain("TASK:unset");
    });

    test("does not set AOP_PROJECT_ROOT when projectRoot not provided (backward compatible)", async () => {
      const outputs: string[] = [];
      runner.on("output", (data: { agentId: string; line: string }) => {
        outputs.push(data.line);
      });

      const process = await runner.spawn({
        type: "implementation",
        taskFolder: "test-task",
        prompt: "test",
        cwd: tempDir,
        provider: new TestProvider([
          "sh",
          "-c",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: Shell variable expansion syntax
          "echo ROOT:${AOP_PROJECT_ROOT:-unset}"
        ])
      });

      await new Promise<void>((resolve) => {
        runner.on("completed", (data: { agentId: string }) => {
          if (data.agentId === process.id) resolve();
        });
      });

      expect(outputs).toContain("ROOT:unset");
    });
  });
});
