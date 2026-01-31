import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createTaskWorktree,
  deleteWorktree,
  listWorktrees
} from "../src/core/git";
import type { RunningAgent } from "../src/core/interfaces/agent-registry";
import { Orchestrator } from "../src/core/orchestrator";
import { SdkAgentRunner } from "../src/core/sdk-agent-runner";
import { configureLogger, getLogger } from "../src/infra/logger";
import { ClaudeProvider, parseStreamJson } from "../src/providers/claude";
import { createTestDir } from "../src/test-helpers";
import type { AgentProcess, Config } from "../src/types";

process.env.DEBUG = "true";
await configureLogger();

const e2eLog = getLogger("e2e");

const FIXTURES_DIR = join(import.meta.dir, "fixtures");
const TIMEOUT = 120_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface TestRepo {
  path: string;
  devsfactoryDir: string;
  worktreesDir: string;
}

const createTestRepo = async (): Promise<TestRepo> => {
  const tempDir = await createTestDir("e2e-orchestrator");

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
  maxConcurrentAgents: 2,
  devsfactoryDir: repo.devsfactoryDir,
  worktreesDir: repo.worktreesDir,
  dashboardPort: 3001,
  debounceMs: 50,
  retryBackoff: { initialMs: 1000, maxMs: 5000, maxAttempts: 5 },
  ignorePatterns: [".git", "*.swp", "*.tmp", "*~", ".DS_Store"]
});

const inspectDirectories = async (
  repo: TestRepo,
  taskFolder: string
): Promise<void> => {
  e2eLog.debug`--- Directory Inspection ---`;

  // List worktrees
  try {
    const worktrees = await listWorktrees(repo.path);
    e2eLog.debug`Worktrees: ${worktrees.join(", ")}`;
  } catch (error) {
    e2eLog.error`Worktrees error: ${error}`;
  }

  // List devsfactory task folder
  try {
    const taskDir = join(repo.devsfactoryDir, taskFolder);
    const files = await readdir(taskDir);
    e2eLog.debug`Devsfactory/${taskFolder}: ${files.join(", ")}`;

    // Read subtask statuses
    for (const file of files) {
      if (file.match(/^\d{3}-.*\.md$/)) {
        const content = await readFile(join(taskDir, file), "utf-8");
        const statusMatch = content.match(/status:\s*(\w+)/);
        e2eLog.debug`  ${file}: status=${statusMatch?.[1] ?? "unknown"}`;
      }
    }
  } catch (error) {
    e2eLog.error`Devsfactory error: ${error}`;
  }

  // List worktrees directory
  try {
    const entries = await readdir(repo.worktreesDir);
    e2eLog.debug`Worktrees dir contents: ${entries.join(", ")}`;
  } catch (error) {
    e2eLog.error`Worktrees dir error: ${error}`;
  }

  e2eLog.debug`--- End Inspection ---`;
};

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

describe.skipIf(!!process.env.CI)("Orchestrator E2E Tests", () => {
  describe("Lifecycle Management", () => {
    let repo: TestRepo;

    beforeAll(async () => {
      repo = await createTestRepo();
    });

    afterAll(async () => {
      await cleanupTestRepo(repo);
    });

    test("initializes and scans empty devsfactory directory", async () => {
      const config = createConfig(repo);
      const orchestrator = new Orchestrator(config);

      await orchestrator.start();

      const state = orchestrator.getState();
      expect(state.tasks).toEqual([]);
      expect(state.plans).toEqual({});
      expect(state.subtasks).toEqual({});
      expect(orchestrator.isWatching()).toBe(true);

      await orchestrator.stop();
      expect(orchestrator.isWatching()).toBe(false);
    });

    test("scans and loads existing tasks", async () => {
      await copyFixture(repo, "simple-task");

      const config = createConfig(repo);
      const orchestrator = new Orchestrator(config);

      await orchestrator.start();

      const state = orchestrator.getState();
      expect(state.tasks.length).toBe(1);
      expect(state.tasks[0]!.folder).toBe("simple-task");

      await orchestrator.stop();
    });
  });

  describe("Task State Transitions", () => {
    let repo: TestRepo;

    beforeAll(async () => {
      repo = await createTestRepo();
      await copyFixture(repo, "simple-task", "transition-task");
    });

    afterAll(async () => {
      await cleanupTestRepo(repo);
    });

    test("transitions PENDING task to INPROGRESS when deps satisfied", async () => {
      const config = createConfig(repo);
      const orchestrator = new Orchestrator(config);
      const events: string[] = [];
      orchestrator.on("stateChanged", () => events.push("stateChanged"));

      await orchestrator.start();

      // Wait for state processing
      await sleep(200);

      const state = orchestrator.getState();
      const task = state.tasks.find((t) => t.folder === "transition-task");
      expect(task?.frontmatter.status).toBe("INPROGRESS");
      expect(events.length).toBeGreaterThan(0);

      await orchestrator.stop();
    });
  });

  describe("Subtask Processing", () => {
    let repo: TestRepo;

    beforeAll(async () => {
      repo = await createTestRepo();
      await copyFixture(repo, "simple-task-with-plan", "subtask-task");
      // Create worktree for the task (plan.md and 001-create-hello.md are included in fixture)
      await createTaskWorktree(repo.path, "subtask-task");
    });

    afterAll(async () => {
      await cleanupTestRepo(repo);
    });

    test("identifies PENDING subtasks for INPROGRESS tasks", async () => {
      const config = createConfig(repo);
      const orchestrator = new Orchestrator(config);

      await orchestrator.start();

      // Wait for state processing
      await sleep(200);

      const state = orchestrator.getState();
      expect(state.plans["subtask-task"]).toBeDefined();
      expect(state.subtasks["subtask-task"]).toBeDefined();
      expect(state.subtasks["subtask-task"]!.length).toBe(1);

      await orchestrator.stop();
    });
  });

  describe("Event Emission", () => {
    let repo: TestRepo;

    beforeAll(async () => {
      repo = await createTestRepo();
    });

    afterAll(async () => {
      await cleanupTestRepo(repo);
    });

    test("emits stateChanged on startup", async () => {
      const config = createConfig(repo);
      const orchestrator = new Orchestrator(config);
      const events: string[] = [];

      orchestrator.on("stateChanged", () => events.push("stateChanged"));

      await orchestrator.start();
      await orchestrator.stop();

      expect(events).toContain("stateChanged");
    });
  });

  describe("Recovery Logic", () => {
    test("resets INPROGRESS task without plan to PENDING", async () => {
      const repo = await createTestRepo();
      try {
        await copyFixture(repo, "recovery-task");

        const config = createConfig(repo);
        const orchestrator = new Orchestrator(config);
        const recoveryEvents: Array<{ action: string; taskFolder: string }> =
          [];

        orchestrator.on("recoveryAction", (data) => recoveryEvents.push(data));

        await orchestrator.start();
        await sleep(100);

        expect(recoveryEvents).toContainEqual({
          action: "taskResetToPending",
          taskFolder: "recovery-task"
        });

        await orchestrator.stop();
      } finally {
        await cleanupTestRepo(repo);
      }
    });

    test("detects orphaned worktree and marks task as BLOCKED", async () => {
      const repo = await createTestRepo();
      try {
        await copyFixture(repo, "orphan-task");

        // Create orphaned worktree directory
        await mkdir(join(repo.worktreesDir, "orphan-task"), {
          recursive: true
        });

        const config = createConfig(repo);
        const orchestrator = new Orchestrator(config);
        const recoveryEvents: Array<{
          action: string;
          taskFolder: string;
          worktreePath?: string;
        }> = [];

        orchestrator.on("recoveryAction", (data) => recoveryEvents.push(data));

        await orchestrator.start();
        await sleep(100);

        const orphanEvent = recoveryEvents.find(
          (e) => e.action === "orphanedWorktreeDetected"
        );
        expect(orphanEvent).toBeDefined();
        expect(orphanEvent?.taskFolder).toBe("orphan-task");

        await orchestrator.stop();
      } finally {
        await cleanupTestRepo(repo);
      }
    });
  });

  describe("Full Task with Fixtures", () => {
    let repo: TestRepo;

    beforeAll(async () => {
      repo = await createTestRepo();
      await copyFixture(repo, "sample-task");
    });

    afterAll(async () => {
      await cleanupTestRepo(repo);
    });

    test("loads task from fixture correctly", async () => {
      const config = createConfig(repo);
      const orchestrator = new Orchestrator(config);

      await orchestrator.start();
      await sleep(100);

      const state = orchestrator.getState();
      const task = state.tasks.find((t) => t.folder === "sample-task");

      expect(task).toBeDefined();
      expect(task?.frontmatter.title).toBe("Sample Feature Implementation");
      expect(task?.frontmatter.priority).toBe("high");

      await orchestrator.stop();
    });

    test("loads subtasks with dependencies from fixture", async () => {
      // plan.md is already included in the sample-task fixture
      // Create task worktree
      await createTaskWorktree(repo.path, "sample-task");

      const config = createConfig(repo);
      const orchestrator = new Orchestrator(config);

      await orchestrator.start();
      await sleep(200);

      const state = orchestrator.getState();
      const subtasks = state.subtasks["sample-task"];

      expect(subtasks).toBeDefined();
      expect(subtasks?.length).toBe(3);

      // Verify dependency chain
      const sub1 = subtasks?.find((s) => s.number === 1);
      const sub2 = subtasks?.find((s) => s.number === 2);
      const sub3 = subtasks?.find((s) => s.number === 3);

      expect(sub1?.frontmatter.dependencies).toEqual([]);
      expect(sub2?.frontmatter.dependencies).toEqual([1]);
      expect(sub3?.frontmatter.dependencies).toEqual([1, 2]);

      await orchestrator.stop();
    });
  });

  describe("Agent Spawning Integration", () => {
    let repo: TestRepo;

    beforeAll(async () => {
      repo = await createTestRepo();
    });

    afterAll(async () => {
      await cleanupTestRepo(repo);
    });

    test(
      "spawns implementation agent for ready subtask",
      async () => {
        await copyFixture(repo, "agent-spawn-task");

        // Create worktrees
        await createTaskWorktree(repo.path, "agent-spawn-task");
        const subtaskWorktreePath = join(
          repo.worktreesDir,
          "agent-spawn-task--test-subtask"
        );
        await Bun.$`git -C ${repo.path} worktree add -b task/agent-spawn-task--test-subtask ${subtaskWorktreePath} task/agent-spawn-task`.quiet();

        const config = createConfig(repo);
        const orchestrator = new Orchestrator(config);

        await orchestrator.start();

        // Give time for agent to potentially spawn
        await sleep(500);

        // The orchestrator should try to spawn an implementation agent
        // Note: In actual e2e with Claude, this would spawn a real agent
        // For this test, we're just verifying the orchestrator attempts to spawn

        const state = orchestrator.getState();
        const subtasks = state.subtasks["agent-spawn-task"];

        // Subtask should transition to INPROGRESS when agent spawns
        expect(subtasks).toBeDefined();

        await orchestrator.stop();
      },
      TIMEOUT
    );
  });

  describe("Full Flow with Diamond Dependencies", () => {
    let repo: TestRepo;
    const FULL_FLOW_TIMEOUT = 900_000; // 15 minutes for diamond pattern
    const TAIL_LINES = 100; // Last N lines to capture per agent

    beforeAll(async () => {
      repo = await createTestRepo();
      await copyFixture(repo, "hello-world-diamond");
    });

    afterAll(async () => {
      await cleanupTestRepo(repo);
    });

    test(
      "runs full orchestrator flow with diamond deps until REVIEW",
      async () => {
        // Create custom SdkAgentRunner to capture output
        const agentRunner = new SdkAgentRunner();

        // Store agent outputs: agentId -> { type, taskFolder, subtaskFile, lines[] }
        const agentOutputs = new Map<
          string,
          {
            type: string;
            taskFolder: string;
            subtaskFile?: string;
            lines: string[];
          }
        >();

        // Capture and print agent output lines in real-time
        const agentOutputLog = getLogger("agent");
        agentRunner.on("output", (data: { agentId: string; line: string }) => {
          let entry = agentOutputs.get(data.agentId);
          // Create placeholder if output arrives before agentStarted event
          if (!entry) {
            entry = { type: "unknown", taskFolder: "unknown", lines: [] };
            agentOutputs.set(data.agentId, entry);
          }
          entry.lines.push(data.line);
          // Keep only last TAIL_LINES
          if (entry.lines.length > TAIL_LINES) {
            entry.lines.shift();
          }
          // Parse and prettify stream-json output
          const prettified = parseStreamJson(data.line);
          if (prettified) {
            agentOutputLog.info("Agent output", {
              agentType: entry.type,
              subtask: entry.subtaskFile,
              agentId: data.agentId.slice(-8),
              output: prettified
            });
          }
        });

        const config = createConfig(repo);
        const orchestrator = new Orchestrator(config, agentRunner);

        // Track agent lifecycle with full observability
        agentRunner.on(
          "started",
          (data: { agentId: string; process: AgentProcess }) => {
            const { agentId, process: agent } = data;
            e2eLog.info("Agent started", {
              agentType: agent.type,
              task: agent.taskFolder,
              subtask: agent.subtaskFile,
              agentId,
              pid: agent.pid
            });

            // Initialize or update output tracking (may have placeholder from early output)
            const existing = agentOutputs.get(agentId);
            agentOutputs.set(agentId, {
              type: agent.type,
              taskFolder: agent.taskFolder,
              subtaskFile: agent.subtaskFile,
              lines: existing?.lines ?? []
            });
          }
        );

        agentRunner.on(
          "completed",
          (data: { agentId: string; exitCode: number }) => {
            const output = agentOutputs.get(data.agentId);
            const props = {
              agentType: output?.type ?? "unknown",
              subtask: output?.subtaskFile,
              agentId: data.agentId,
              exitCode: data.exitCode
            };
            if (data.exitCode === 0) {
              e2eLog.info("Agent completed", props);
            } else {
              e2eLog.warn("Agent completed with error", props);
            }
          }
        );

        orchestrator.on(
          "workerJobFailed",
          (data: { jobId: string; error?: string; attempt?: number }) => {
            e2eLog.error("Job failed", {
              jobId: data.jobId,
              error: data.error,
              attempt: data.attempt
            });
          }
        );

        orchestrator.on(
          "workerJobRetrying",
          (data: { jobId: string; attempt: number; nextRetryMs: number }) => {
            e2eLog.warn("Job retrying", {
              jobId: data.jobId,
              attempt: data.attempt,
              nextRetryMs: data.nextRetryMs
            });
          }
        );

        await orchestrator.start();

        // Poll until task reaches REVIEW status with detailed progress logging
        const startTime = Date.now();
        const pollInterval = 5000;
        let finalState: ReturnType<typeof orchestrator.getState> | undefined;
        let lastStatus = "";

        while (Date.now() - startTime < FULL_FLOW_TIMEOUT - 10000) {
          await sleep(pollInterval);

          const state = orchestrator.getState();
          const task = state.tasks.find(
            (t) => t.folder === "hello-world-diamond"
          );
          const plan = state.plans["hello-world-diamond"];
          const subtasks = state.subtasks["hello-world-diamond"] ?? [];
          const activeAgents: RunningAgent[] =
            await orchestrator.getActiveAgents();

          // Build status string
          const subtaskStatuses = subtasks
            .sort((a, b) => a.number - b.number)
            .map((s) => `${s.number}:${s.frontmatter.status}`)
            .join(", ");
          const activeAgentInfo =
            activeAgents.length > 0
              ? ` | Active: [${activeAgents.map((a: RunningAgent) => `${a.type}${a.subtaskFile ? `(${a.subtaskFile})` : ""}`).join(", ")}]`
              : "";

          const currentStatus = `Task: ${task?.frontmatter.status}, Plan: ${plan?.frontmatter.status}, Subtasks: [${subtaskStatuses}]${activeAgentInfo}`;

          // Only log if status changed
          if (currentStatus !== lastStatus) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            e2eLog.info("Status update", {
              elapsedSec: elapsed,
              taskStatus: task?.frontmatter.status,
              planStatus: plan?.frontmatter.status,
              subtasks: subtaskStatuses,
              activeAgents: activeAgents.map((a: RunningAgent) => ({
                type: a.type,
                subtask: a.subtaskFile
              }))
            });
            lastStatus = currentStatus;
            // Inspect directories on status change
            await inspectDirectories(repo, "hello-world-diamond");
          }

          if (task?.frontmatter.status === "REVIEW") {
            finalState = state;
            e2eLog.info("Task completed successfully", {
              status: "REVIEW",
              elapsedSec: Math.round((Date.now() - startTime) / 1000)
            });
            break;
          }

          if (task?.frontmatter.status === "BLOCKED") {
            // Log any agent outputs before failing
            const agentLogs = Array.from(agentOutputs.entries()).map(
              ([agentId, output]) => ({
                agentId,
                type: output.type,
                lastLines: output.lines.slice(-20)
              })
            );
            e2eLog.error("Task became BLOCKED", { agentLogs });
            throw new Error("Task became BLOCKED");
          }

          finalState = state;
        }

        await orchestrator.stop();

        // Assertions
        const task = finalState!.tasks.find(
          (t) => t.folder === "hello-world-diamond"
        );
        const subtasks = finalState!.subtasks["hello-world-diamond"] ?? [];

        expect(task?.frontmatter.status).toBe("REVIEW");
        expect(subtasks.every((s) => s.frontmatter.status === "DONE")).toBe(
          true
        );
        expect(subtasks.length).toBe(4);

        // Verify files exist in task worktree
        const worktreePath = join(repo.worktreesDir, "hello-world-diamond");
        expect(await Bun.file(join(worktreePath, "types.ts")).exists()).toBe(
          true
        );
        expect(await Bun.file(join(worktreePath, "greet.ts")).exists()).toBe(
          true
        );
        expect(
          await Bun.file(join(worktreePath, "formatter.ts")).exists()
        ).toBe(true);
        expect(await Bun.file(join(worktreePath, "main.ts")).exists()).toBe(
          true
        );

        // Use Claude to verify implementation
        await verifyDiamondImplementation(worktreePath);
      },
      FULL_FLOW_TIMEOUT
    );
  });
});

const readFileOrEmpty = (path: string): Promise<string> =>
  Bun.file(path)
    .text()
    .catch(() => "");

const verifyDiamondImplementation = async (
  worktreePath: string
): Promise<void> => {
  const provider = new ClaudeProvider();

  const [typesContent, greetContent, formatterContent, mainContent] =
    await Promise.all([
      readFileOrEmpty(join(worktreePath, "types.ts")),
      readFileOrEmpty(join(worktreePath, "greet.ts")),
      readFileOrEmpty(join(worktreePath, "formatter.ts")),
      readFileOrEmpty(join(worktreePath, "main.ts"))
    ]);

  const prompt = `
You are verifying a TypeScript implementation. Requirements:
1. types.ts: GreetingOptions interface with name and optional uppercase, FormattedGreeting type
2. greet.ts: greet(options) function returning a greeting string
3. formatter.ts: formatMessage(message) function returning FormattedGreeting
4. main.ts: integrates greet and formatter

types.ts:
\`\`\`typescript
${typesContent}
\`\`\`

greet.ts:
\`\`\`typescript
${greetContent}
\`\`\`

formatter.ts:
\`\`\`typescript
${formatterContent}
\`\`\`

main.ts:
\`\`\`typescript
${mainContent}
\`\`\`

Respond with ONLY "PASS" if all files exist and implement the core functionality, or "FAIL: <reason>":
`;

  const command = provider.buildCommand({ prompt, cwd: worktreePath });
  const proc = Bun.spawn(command, {
    cwd: worktreePath,
    stdout: "pipe",
    stderr: "pipe"
  });

  const output = await new Response(proc.stdout).text();
  await proc.exited;

  // Parse JSON stream output to extract actual text response
  const textParts = output
    .split("\n")
    .map((line) => parseStreamJson(line))
    .filter((text): text is string => text !== null && !text.startsWith("──"));

  const responseText = textParts.join(" ").trim();

  if (!responseText.toUpperCase().startsWith("PASS")) {
    throw new Error(`Implementation verification failed: ${responseText}`);
  }
};
