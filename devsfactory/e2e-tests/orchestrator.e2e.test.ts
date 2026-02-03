import { afterAll, beforeAll, describe, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { AgentClient } from "../src/agent/agent-client";
import { AopServer } from "../src/core/aop-server";
import { AgentDispatcher } from "../src/core/remote";
import { ServerCoordinator } from "../src/core/server-coordinator";
import { InMemoryStateStore } from "../src/core/server-state-store";
import { ensureProjectRecord } from "../src/core/sqlite/project-store";
import { SQLiteTaskStorage } from "../src/core/sqlite/sqlite-task-storage";
import { configureLogger } from "../src/infra/logger";
import { createIsolatedGlobalDir, createTestDir } from "../src/test-helpers";

process.env.DEBUG = "true";
await configureLogger();

const TIMEOUT = 30_000;
const SECRET = "test-secret";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface TestRepo {
  path: string;
  devsfactoryDir: string;
  projectName: string;
}

const createTestRepo = async (name: string): Promise<TestRepo> => {
  const tempDir = await createTestDir("e2e-server-flow");

  await Bun.$`git init -b main ${tempDir}`.quiet();
  await Bun.$`git -C ${tempDir} config user.email "test@test.com"`.quiet();
  await Bun.$`git -C ${tempDir} config user.name "Test User"`.quiet();

  await Bun.$`touch ${tempDir}/README.md`.quiet();
  await Bun.$`git -C ${tempDir} add .`.quiet();
  await Bun.$`git -C ${tempDir} commit -m "Initial commit"`.quiet();

  const devsfactoryDir = join(tempDir, ".devsfactory");
  await mkdir(devsfactoryDir, { recursive: true });

  return { path: tempDir, devsfactoryDir, projectName: name };
};

const createSimpleTaskInSQLite = async (
  storage: SQLiteTaskStorage,
  taskFolder: string
): Promise<void> => {
  await storage.createTask(taskFolder, {
    frontmatter: {
      title: "Simple E2E Task",
      status: "BACKLOG",
      created: new Date(),
      priority: "high",
      tags: ["e2e", "test"],
      assignee: null,
      dependencies: [],
      startedAt: null,
      completedAt: null,
      durationMs: null
    },
    description: "A simple task for e2e testing the orchestrator.",
    requirements: '- Create a hello.txt file with "Hello World"',
    acceptanceCriteria: [
      { text: "hello.txt exists with correct content", checked: false }
    ]
  });
};

const waitForTaskStatus = async (
  store: InMemoryStateStore,
  projectName: string,
  taskFolder: string,
  status: string,
  timeoutMs = TIMEOUT
): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = store.getProjectState(projectName);
    const task = state.tasks.find((t) => t.folder === taskFolder);
    if (task?.frontmatter.status === status) return;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${taskFolder} to be ${status}`);
};

describe.skipIf(!!process.env.CI)("Server Snapshot E2E", () => {
  let repo: TestRepo;
  let globalCtx: Awaited<ReturnType<typeof createIsolatedGlobalDir>>;

  beforeAll(async () => {
    repo = await createTestRepo("e2e-project");
    globalCtx = await createIsolatedGlobalDir("e2e-server-flow");
  });

  afterAll(async () => {
    await globalCtx.cleanup();
  });

  test(
    "publishes snapshot to server when task becomes PENDING",
    async () => {
      await globalCtx.run(async () => {
        ensureProjectRecord({ name: repo.projectName, path: repo.path });

        const storage = new SQLiteTaskStorage({
          projectName: repo.projectName
        });
        await createSimpleTaskInSQLite(storage, "simple-task");

        const dispatcher = new AgentDispatcher({
          secret: SECRET,
          serverVersion: "test"
        });
        const store = new InMemoryStateStore();
        const coordinator = new ServerCoordinator(dispatcher, store, {
          maxConcurrentAgents: 1,
          retryBackoff: { initialMs: 2000, maxMs: 300000, maxAttempts: 3 }
        });
        coordinator.start();

        const server = new AopServer(coordinator, {
          port: 0,
          agentDispatcher: dispatcher
        });
        await server.start();

        const client = new AgentClient({
          serverUrl: `ws://localhost:${server.port}/api/agents`,
          secret: SECRET,
          projectName: repo.projectName,
          repoPath: repo.path
        });

        try {
          await client.connect();

          await waitForTaskStatus(
            store,
            repo.projectName,
            "simple-task",
            "BACKLOG"
          );

          await storage.updateTaskStatus("simple-task", "PENDING");

          await waitForTaskStatus(
            store,
            repo.projectName,
            "simple-task",
            "PENDING"
          );
        } finally {
          client.disconnect();
          await server.stop();
          coordinator.stop();
        }
      });
    },
    TIMEOUT
  );
});
