import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { AgentRunner } from "../src/core/agent-runner";

const LOGS_DIR = join(import.meta.dir, "..", ".logs");
const TIMEOUT = 60_000;

describe("AgentRunner E2E Tests", () => {
  let runner: AgentRunner;
  let tempDir: string;

  beforeEach(async () => {
    runner = new AgentRunner();
    tempDir = await Bun.$`mktemp -d`.text();
    tempDir = tempDir.trim();
    await mkdir(LOGS_DIR, { recursive: true });
  });

  afterEach(async () => {
    for (const agent of runner.getActive()) {
      await runner.kill(agent.id);
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  describe.skipIf(!!process.env.CI)("Claude Code Integration", () => {
    test(
      "runs claude code agent with hello world prompt",
      async () => {
        const outputs: string[] = [];
        runner.on("output", (data: { agentId: string; line: string }) => {
          outputs.push(data.line);
        });

        const process = await runner.spawn({
          type: "implementation",
          taskFolder: "e2e-test",
          prompt: "Say hello world",
          cwd: tempDir,
          command: [
            "claude",
            "--print",
            "--dangerously-skip-permissions",
            "Tell me a short story about a cat which has the words hello and world in it"
          ],
          logsDir: LOGS_DIR
        });

        expect(process.id).toMatch(/^agent-[A-Za-z0-9]{27}$/);
        expect(process.type).toBe("implementation");
        expect(process.taskFolder).toBe("e2e-test");
        expect(process.pid).toBeGreaterThan(0);

        const exitCode = await new Promise<number>((resolve) => {
          runner.on(
            "completed",
            (data: { agentId: string; exitCode: number }) => {
              if (data.agentId === process.id) {
                resolve(data.exitCode);
              }
            }
          );
        });

        expect(exitCode).toBe(0);

        const allOutput = outputs.join("\n").toLowerCase();
        expect(allOutput).toContain("hello");
        expect(allOutput).toContain("world");

        const logFiles = await readdir(LOGS_DIR);
        const logFile = logFiles.find((f) => f.startsWith(process.id));
        expect(logFile).toBeDefined();

        if (logFile) {
          const logContent = await readFile(join(LOGS_DIR, logFile), "utf-8");
          expect(logContent.toLowerCase()).toContain("hello");
          expect(logContent.toLowerCase()).toContain("world");
        }
      },
      TIMEOUT
    );

    test("generates unique KSUID-based agent IDs", async () => {
      const ids: string[] = [];

      for (let i = 0; i < 3; i++) {
        const process = await runner.spawn({
          type: "planning",
          taskFolder: `test-task-${i}`,
          prompt: "test",
          cwd: tempDir,
          command: ["echo", "test"]
        });
        ids.push(process.id);
      }

      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);

      for (const id of ids) {
        expect(id).toMatch(/^agent-[A-Za-z0-9]{27}$/);
      }
    });

    test("logs output to .logs directory in real-time", async () => {
      const process = await runner.spawn({
        type: "implementation",
        taskFolder: "log-test",
        prompt: "test logging",
        cwd: tempDir,
        command: [
          "bash",
          "-c",
          "echo 'line1'; sleep 0.1; echo 'line2'; sleep 0.1; echo 'line3'"
        ],
        logsDir: LOGS_DIR
      });

      await new Promise<void>((resolve) => {
        runner.on("completed", (data: { agentId: string }) => {
          if (data.agentId === process.id) resolve();
        });
      });

      const logPath = join(LOGS_DIR, `${process.id}.log`);
      const logContent = await readFile(logPath, "utf-8");

      expect(logContent).toContain("line1");
      expect(logContent).toContain("line2");
      expect(logContent).toContain("line3");
    });
  });
});
