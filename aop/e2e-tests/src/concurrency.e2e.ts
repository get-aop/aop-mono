// Prerequisites: `bun dev` must be running before executing this test

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cleanupTestRepos,
  copyFixture,
  createTempRepo,
  createTestAopHome,
  type E2EServerContext,
  ensureChangesDir,
  getFullStatus,
  getRepoStatus,
  isLocalServerRunning,
  runAopCommand,
  setupE2ETestDir,
  startE2EServer,
  stopE2EServer,
  type TempRepoResult,
  type TestAopHome,
  triggerServerRefresh,
  waitForTask,
  waitForTasksInRepo,
} from "./helpers";

const E2E_TIMEOUT = 600_000;

describe("concurrency limits", () => {
  let repo: TempRepoResult;
  let context: E2EServerContext;
  let wasAlreadyRunning = false;
  let testHome: TestAopHome | null = null;

  beforeAll(async () => {
    await setupE2ETestDir();
    repo = await createTempRepo("concurrency");
  });

  afterAll(async () => {
    if (context) {
      await stopE2EServer(context, wasAlreadyRunning);
    }
    testHome?.cleanup();
    await repo.cleanup();
    await cleanupTestRepos();
  });

  test(
    "enforces global concurrency limit of 1",
    async () => {
      await ensureChangesDir(repo.path);

      const { exitCode: initExit } = await runAopCommand(["repo:init", repo.path]);
      expect(initExit).toBe(0);

      testHome = createTestAopHome("concurrency");
      const serverResult = await startE2EServer({ aopHome: testHome.path });
      const { success, context: serverCtx, wasAlreadyRunning: alreadyRunning } = serverResult;
      context = serverCtx;
      wasAlreadyRunning = alreadyRunning;
      expect(success).toBe(true);

      // Verify local server is running
      expect(await isLocalServerRunning()).toBe(true);

      // Trigger refresh to ensure watcher picks up the new repo
      await triggerServerRefresh();

      await copyFixture("concurrency-test-1", repo.path);
      await copyFixture("concurrency-test-2", repo.path);

      // Wait for tasks to be detected (may take up to 30s for ticker poll if server was already running)
      const detectedTasks = await waitForTasksInRepo(repo.path, 2, {
        timeout: 60_000,
        pollInterval: 2000,
      });
      expect(detectedTasks.length).toBe(2);
      const draftTasks = detectedTasks.filter((t) => t.status === "DRAFT");
      expect(draftTasks.length).toBe(2);

      let status = await getFullStatus();
      if (!status) throw new Error("Status should not be null");

      const task1 = draftTasks.find((t) => t.change_path.includes("concurrency-test-1"));
      const task2 = draftTasks.find((t) => t.change_path.includes("concurrency-test-2"));
      if (!task1 || !task2) throw new Error("Tasks should exist");

      await runAopCommand(["task:ready", task1.id]);
      await runAopCommand(["task:ready", task2.id]);

      await Bun.sleep(3000);

      status = await getFullStatus();
      if (!status) throw new Error("Status should not be null");
      expect(status.globalCapacity.max).toBeGreaterThanOrEqual(1);

      // Check repo-scoped working tasks (allows parallelization with other e2e tests)
      const repoStatus = getRepoStatus(status, repo.path);
      const workingTasks = repoStatus.tasks.filter((t) => t.status === "WORKING");
      expect(workingTasks.length).toBeLessThanOrEqual(1);

      const completedTask1 = await waitForTask(task1.id, ["DONE", "BLOCKED"], {
        timeout: 300_000,
        pollInterval: 2000,
      });
      expect(completedTask1).not.toBeNull();

      const completedTask2 = await waitForTask(task2.id, ["DONE", "BLOCKED"], {
        timeout: 300_000,
        pollInterval: 2000,
      });
      expect(completedTask2).not.toBeNull();

      const finalStatus = await getFullStatus();
      if (!finalStatus) throw new Error("Status should not be null");
      const finalRepoStatus = getRepoStatus(finalStatus, repo.path);
      const doneTasks = finalRepoStatus.tasks.filter((t) => t.status === "DONE");
      expect(doneTasks.length).toBe(2);

      // Check repo-scoped working count (allows parallelization with other e2e tests)
      expect(finalRepoStatus.working).toBe(0);
    },
    E2E_TIMEOUT,
  );
});
