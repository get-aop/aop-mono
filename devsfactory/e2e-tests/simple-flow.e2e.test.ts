import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { deleteWorktree, listWorktrees } from "../src/core/git";
import { Orchestrator } from "../src/core/orchestrator";
import { SdkAgentRunner } from "../src/core/sdk-agent-runner";
import { configureLogger, getLogger } from "../src/infra/logger";
import { parseStreamJson } from "../src/providers/claude";
import { createTestDir } from "../src/test-helpers";
import type { AgentProcess, Config } from "../src/types";

process.env.DEBUG = "true";
await configureLogger();

const e2eLog = getLogger("e2e");

const FIXTURES_DIR = join(import.meta.dir, "fixtures");
const TIMEOUT = 180_000; // 3 minutes - should be plenty for 1 subtask

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface TestRepo {
  path: string;
  devsfactoryDir: string;
  worktreesDir: string;
}

const createTestRepo = async (): Promise<TestRepo> => {
  const tempDir = await createTestDir("e2e-simple-flow");

  await Bun.$`git init -b main ${tempDir}`.quiet();
  await Bun.$`git -C ${tempDir} config user.email "test@test.com"`.quiet();
  await Bun.$`git -C ${tempDir} config user.name "Test User"`.quiet();

  await Bun.$`touch ${tempDir}/README.md`.quiet();
  await Bun.$`git -C ${tempDir} add .`.quiet();
  await Bun.$`git -C ${tempDir} commit -m "Initial commit"`.quiet();

  const devsfactoryDir = join(tempDir, ".devsfactory");
  const worktreesDir = join(tempDir, ".worktrees");
  await mkdir(devsfactoryDir, { recursive: true });
  await mkdir(worktreesDir, { recursive: true });

  return { path: tempDir, devsfactoryDir, worktreesDir };
};

const cleanupTestRepo = async (repo: TestRepo): Promise<void> => {
  const worktrees = await listWorktrees(repo.path);
  for (const wt of worktrees) {
    if (wt !== repo.path) {
      await deleteWorktree(repo.path, wt);
    }
  }
};

const createConfig = (repo: TestRepo): Config => ({
  maxConcurrentAgents: 1,
  devsfactoryDir: repo.devsfactoryDir,
  worktreesDir: repo.worktreesDir,
  dashboardPort: 3002,
  debounceMs: 50,
  retryBackoff: { initialMs: 1000, maxMs: 5000, maxAttempts: 3 },
  ignorePatterns: [".git", "*.swp", "*.tmp", "*~", ".DS_Store"]
});

const copyFixture = async (
  repo: TestRepo,
  fixtureName: string,
  destName?: string
): Promise<void> => {
  const src = join(FIXTURES_DIR, fixtureName);
  const dest = join(repo.devsfactoryDir, destName ?? fixtureName);
  await cp(src, dest, { recursive: true });
  await Bun.$`git -C ${repo.path} add .`.quiet();
  await Bun.$`git -C ${repo.path} commit -m "Add ${destName ?? fixtureName} from fixture"`.quiet();
};

describe.skipIf(!!process.env.CI)("Simple Flow E2E", () => {
  let repo: TestRepo;

  beforeAll(async () => {
    repo = await createTestRepo();
    await copyFixture(repo, "simple-task-with-plan", "simple-hello");
  });

  afterAll(async () => {
    await cleanupTestRepo(repo);
  });

  test(
    "runs single subtask to completion",
    async () => {
      const agentRunner = new SdkAgentRunner();
      const agentLog = getLogger("agent");

      agentRunner.on("output", (data: { agentId: string; line: string }) => {
        const prettified = parseStreamJson(data.line);
        if (prettified) {
          agentLog.info`${prettified}`;
        }
      });

      agentRunner.on(
        "started",
        (data: { agentId: string; process: AgentProcess }) => {
          e2eLog.info("Agent started", {
            type: data.process.type,
            subtask: data.process.subtaskFile,
            pid: data.process.pid
          });
        }
      );

      agentRunner.on(
        "completed",
        (data: { agentId: string; exitCode: number }) => {
          e2eLog.info("Agent completed", {
            agentId: data.agentId.slice(-8),
            exitCode: data.exitCode
          });
        }
      );

      // Handle agent errors (including abort during shutdown)
      agentRunner.on("error", (data: { agentId: string; error: Error }) => {
        e2eLog.warn("Agent error (may be expected during shutdown)", {
          agentId: data.agentId.slice(-8),
          error: data.error.message
        });
      });

      const config = createConfig(repo);
      const orchestrator = new Orchestrator(config, agentRunner);

      orchestrator.on(
        "workerJobFailed",
        (data: { jobId: string; error?: string }) => {
          e2eLog.error("Job failed", { jobId: data.jobId, error: data.error });
        }
      );

      await orchestrator.start();

      const startTime = Date.now();
      const pollInterval = 2000;
      let finalState: ReturnType<typeof orchestrator.getState> | undefined;

      while (Date.now() - startTime < TIMEOUT - 5000) {
        await sleep(pollInterval);

        const state = orchestrator.getState();
        const task = state.tasks.find((t) => t.folder === "simple-hello");
        const subtasks = state.subtasks["simple-hello"] ?? [];

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        e2eLog.info("Poll", {
          elapsed: `${elapsed}s`,
          task: task?.frontmatter.status,
          subtasks: subtasks.map((s) => `${s.number}:${s.frontmatter.status}`)
        });

        if (task?.frontmatter.status === "REVIEW") {
          finalState = state;
          e2eLog.info("Task completed", { elapsed: `${elapsed}s` });
          break;
        }

        if (task?.frontmatter.status === "BLOCKED") {
          throw new Error("Task became BLOCKED");
        }

        finalState = state;
      }

      await orchestrator.stop();

      // Assertions
      const task = finalState!.tasks.find((t) => t.folder === "simple-hello");
      const subtasks = finalState!.subtasks["simple-hello"] ?? [];

      expect(task?.frontmatter.status).toBe("REVIEW");
      expect(subtasks.length).toBe(1);
      expect(subtasks[0]?.frontmatter.status).toBe("DONE");

      // Verify file exists in task worktree
      const worktreePath = join(repo.worktreesDir, "simple-hello");
      const helloFile = Bun.file(join(worktreePath, "hello.txt"));
      expect(await helloFile.exists()).toBe(true);

      const content = await helloFile.text();
      expect(content.toLowerCase()).toContain("hello");
    },
    TIMEOUT
  );
});
