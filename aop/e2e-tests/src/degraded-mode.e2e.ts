// Prerequisites: `bun dev` must be running before executing this test

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  cleanupTestRepos,
  copyFixture,
  createTempRepo,
  runAopCommand,
  setupE2ETestDir,
  type TempRepoResult,
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

    await setupE2ETestDir();
    repo = await createTempRepo("degraded-mode");
  });

  afterAll(async () => {
    await repo.cleanup();
    await cleanupTestRepos();
  });

  test(
    "tasks can be managed locally without server and sync back when connection restored",
    async () => {
      const changePath = await copyFixture("backlog-test", repo.path);

      await Bun.$`git add .`.cwd(repo.path).quiet();
      await Bun.$`git commit -m "Add fixture"`.cwd(repo.path).quiet();

      // Stop any running daemon first
      await runAopCommand(["stop"]);
      await Bun.sleep(1000);

      // Start daemon in degraded mode (clear server settings)
      const { exitCode: clearServerUrl } = await runAopCommand(["config:set", "server_url", ""]);
      expect(clearServerUrl).toBe(0);

      const { exitCode: clearApiKey } = await runAopCommand(["config:set", "api_key", ""]);
      expect(clearApiKey).toBe(0);

      const { exitCode: startExit } = await runAopCommand(["start"]);
      expect(startExit).toBe(0);
      await Bun.sleep(2000);

      try {
        // Initialize repo in degraded mode
        const { exitCode: initExit } = await runAopCommand(["repo:init", repo.path]);
        expect(initExit).toBe(0);
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

        // Mark task as ready (should work in degraded mode)
        const { exitCode: readyExit } = await runAopCommand(["task:ready", taskId]);
        expect(readyExit).toBe(0);
        await Bun.sleep(1000);

        // Verify task is READY locally (stays READY because no server to get step command)
        const { exitCode: statusReadyExit, stdout: statusReadyOut } = await runAopCommand([
          "status",
          taskId,
          "--json",
        ]);
        expect(statusReadyExit).toBe(0);
        const taskReady = JSON.parse(statusReadyOut);
        expect(taskReady.status).toBe("READY");

        // Verify task is NOT on server yet (server doesn't know about it)
        const serverTaskBefore = await getServerTaskStatus(taskId);
        expect(serverTaskBefore).toBeNull();

        // Stop daemon
        await runAopCommand(["stop"]);
        await Bun.sleep(1000);

        // Restore server settings
        const { exitCode: setServerUrl } = await runAopCommand([
          "config:set",
          "server_url",
          SERVER_URL,
        ]);
        expect(setServerUrl).toBe(0);

        const { exitCode: setApiKey } = await runAopCommand(["config:set", "api_key", API_KEY]);
        expect(setApiKey).toBe(0);

        // Start daemon with server connection
        const { exitCode: startConnectedExit } = await runAopCommand(["start"]);
        expect(startConnectedExit).toBe(0);
        await Bun.sleep(3000);

        // Since task was READY and now we have server connection, daemon should sync
        // The task should get picked up and start execution

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
        const helloFile = join(repo.path, ".worktrees", taskId, "hello.txt");
        const helloExists = await Bun.file(helloFile).exists();
        expect(helloExists).toBe(true);
      } finally {
        await runAopCommand(["stop"]);
        await runAopCommand(["config:set", "server_url", SERVER_URL]);
        await runAopCommand(["config:set", "api_key", API_KEY]);
      }
    },
    E2E_TIMEOUT,
  );
});
