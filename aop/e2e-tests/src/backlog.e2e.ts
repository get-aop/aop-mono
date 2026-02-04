// Prerequisites: `bun dev` must be running before executing this test

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  cleanupTestRepos,
  copyFixture,
  createTempRepo,
  type DaemonContext,
  ensureChangesDir,
  findTasksForRepo,
  getFullStatus,
  isLocalServerRunning,
  runAopCommand,
  setupE2ETestDir,
  startDaemon,
  stopDaemon,
  type TaskInfo,
  type TempRepoResult,
  triggerServerRefresh,
  waitForRepoInStatus,
  waitForTask,
  waitForTasksInRepo,
} from "./helpers";

const E2E_TIMEOUT = 600_000;

describe("backlog full flow", () => {
  let repo: TempRepoResult;
  let context: DaemonContext;
  let wasAlreadyRunning = false;

  beforeAll(async () => {
    await setupE2ETestDir();
    repo = await createTempRepo("backlog");
  });

  afterAll(async () => {
    if (context) {
      await stopDaemon(context, wasAlreadyRunning);
    }
    await repo.cleanup();
    await cleanupTestRepos();
  });

  test(
    "full backlog flow: detect task, mark ready, execute, complete",
    async () => {
      await ensureChangesDir(repo.path);

      const { exitCode: initExit } = await runAopCommand(["repo:init", repo.path]);
      expect(initExit).toBe(0);

      const daemonResult = await startDaemon();
      const { success, context: daemonCtx, wasAlreadyRunning: alreadyRunning } = daemonResult;
      context = daemonCtx;
      wasAlreadyRunning = alreadyRunning;
      expect(success).toBe(true);

      // Verify local server is running
      expect(await isLocalServerRunning()).toBe(true);

      // Wait for server to process repo:init (adds repo to watcher)
      const repoSynced = await waitForRepoInStatus(repo.path, { timeout: 5000 });
      expect(repoSynced).toBe(true);

      // Trigger refresh to ensure watcher picks up the new repo
      await triggerServerRefresh();

      await copyFixture("backlog-test", repo.path);

      // Wait for task to be detected (watcher should trigger reconcile)
      const repoTasks = await waitForTasksInRepo(repo.path, 1, {
        timeout: 10_000,
        pollInterval: 500,
      });
      expect(repoTasks.length).toBe(1);
      const task = repoTasks[0] as TaskInfo;
      expect(task.status).toBe("DRAFT");

      const { exitCode: readyExit } = await runAopCommand(["task:ready", task.id]);
      expect(readyExit).toBe(0);

      const afterReadyStatus = await getFullStatus();
      if (!afterReadyStatus) throw new Error("Status should not be null");
      const updatedTasks = findTasksForRepo(afterReadyStatus, repo.path);
      const updatedTask = updatedTasks[0] as TaskInfo;
      // Task may already be WORKING if queue processor picked it up immediately
      expect(["READY", "WORKING"]).toContain(updatedTask.status);
      expect(updatedTask.ready_at).not.toBeNull();

      const completedTask = await waitForTask(task.id, ["DONE", "BLOCKED"], {
        timeout: 300_000,
        pollInterval: 2000,
      });
      expect(completedTask).not.toBeNull();
      if (!completedTask) throw new Error("Completed task should not be null");
      expect(completedTask.status).toBe("DONE");

      const helloPath = join(repo.path, ".worktrees", task.id, "hello.txt");
      expect(existsSync(helloPath)).toBe(true);
    },
    E2E_TIMEOUT,
  );
});
