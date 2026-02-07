// Prerequisites: `bun dev` must be running before executing this test

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  cleanupTestRepos,
  copyFixture,
  createTempRepo,
  isLocalServerRunning,
  runAopCommand,
  setupE2ETestDir,
  type TempRepoResult,
  triggerServerRefresh,
  waitForTask,
} from "./helpers";
import { API_KEY, SERVER_URL } from "./helpers/constants";
import {
  checkDevEnvironment,
  getServerTaskStatus,
  waitForServerTaskStatus,
} from "./helpers/server";

const E2E_TIMEOUT = 600_000;

describe("degraded mode", () => {
  let repo: TempRepoResult;

  beforeAll(async () => {
    const envCheck = await checkDevEnvironment();
    if (!envCheck.ready) {
      throw new Error(
        `Dev environment not ready: ${envCheck.reason}\n` +
          "Run 'bun dev' in a separate terminal before running E2E tests.",
      );
    }

    // This test requires the local server to be running
    const serverRunning = await isLocalServerRunning();
    if (!serverRunning) {
      throw new Error(
        "Local server not running.\n" +
          "Run 'bun dev' in a separate terminal before running E2E tests.",
      );
    }

    await setupE2ETestDir();
    repo = await createTempRepo("degraded-mode");
  });

  afterAll(async () => {
    await repo.cleanup();
    await cleanupTestRepos();
  });

  test(
    "tasks work locally and sync to remote server when connection is available",
    async () => {
      const changePath = await copyFixture("backlog-test", repo.path);

      await Bun.$`git add .`.cwd(repo.path).quiet();
      await Bun.$`git commit -m "Add fixture"`.cwd(repo.path).quiet();

      // Configure server connection
      const { exitCode: setServerUrl } = await runAopCommand([
        "config:set",
        "server_url",
        SERVER_URL,
      ]);
      expect(setServerUrl).toBe(0);

      const { exitCode: setApiKey } = await runAopCommand(["config:set", "api_key", API_KEY]);
      expect(setApiKey).toBe(0);

      // Initialize repo
      const { exitCode: initExit } = await runAopCommand(["repo:init", repo.path]);
      expect(initExit).toBe(0);

      // Trigger refresh to ensure watcher picks up the new repo
      await triggerServerRefresh();
      await Bun.sleep(2000);

      // Get task status - should be DRAFT
      const { exitCode: statusDraftExit, stdout: statusDraftOut } = await runAopCommand([
        "status",
        changePath,
        "--json",
      ]);
      expect(statusDraftExit).toBe(0);
      const taskDraft = JSON.parse(statusDraftOut);
      expect(taskDraft.status).toBe("DRAFT");
      const taskId = taskDraft.id;

      // Mark task as ready
      const { exitCode: readyExit } = await runAopCommand(["task:ready", taskId]);
      expect(readyExit).toBe(0);
      await Bun.sleep(1000);

      // Verify task is READY or WORKING locally
      const { exitCode: statusReadyExit, stdout: statusReadyOut } = await runAopCommand([
        "status",
        taskId,
        "--json",
      ]);
      expect(statusReadyExit).toBe(0);
      const taskReady = JSON.parse(statusReadyOut);
      expect(["READY", "WORKING"]).toContain(taskReady.status);

      // Wait for task to be synced and start working on server
      const serverTaskAfter = await waitForServerTaskStatus(taskId, ["WORKING", "DONE"], {
        timeout: 60_000,
        pollInterval: 2000,
      });

      if (serverTaskAfter) {
        expect(["WORKING", "DONE"]).toContain(serverTaskAfter.status);
      }

      // Wait for task to complete
      const completedTask = await waitForTask(taskId, ["DONE", "BLOCKED"], {
        timeout: 300_000,
        pollInterval: 5000,
      });
      expect(completedTask).not.toBeNull();
      expect(completedTask?.status).toBe("DONE");

      // Verify server has final status
      const serverTaskFinal = await getServerTaskStatus(taskId);
      expect(serverTaskFinal?.status).toBe("DONE");

      // Verify the work was done
      const worktreePath = completedTask?.worktree_path;
      expect(worktreePath).not.toBeNull();
      if (!worktreePath) throw new Error("worktree_path is null");
      const helloFile = join(worktreePath, "hello.txt");
      const helloExists = await Bun.file(helloFile).exists();
      expect(helloExists).toBe(true);
    },
    E2E_TIMEOUT,
  );
});
