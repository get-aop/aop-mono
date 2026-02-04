// Prerequisites: `bun dev` must be running before executing this test

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  cleanupTestRepos,
  copyFixture,
  createTempRepo,
  type DaemonContext,
  isLocalServerRunning,
  runAopCommand,
  setupE2ETestDir,
  startDaemon,
  stopDaemon,
  type TempRepoResult,
  triggerServerRefresh,
  waitForTask,
} from "./helpers";
import {
  checkDevEnvironment,
  getServerExecutionStatus,
  getServerTaskStatus,
  waitForServerTaskStatus,
} from "./helpers/server";

const E2E_TIMEOUT = 600_000;

describe("server workflow execution", () => {
  let repo: TempRepoResult;
  let context: DaemonContext;
  let wasAlreadyRunning = false;

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
    repo = await createTempRepo("server-workflow");
  });

  afterAll(async () => {
    if (context) {
      await stopDaemon(context, wasAlreadyRunning);
    }
    await repo.cleanup();
    await cleanupTestRepos();
  });

  test(
    "full workflow execution syncs between CLI and server",
    async () => {
      const changePath = await copyFixture("backlog-test", repo.path);

      await Bun.$`git add .`.cwd(repo.path).quiet();
      await Bun.$`git commit -m "Add fixture"`.cwd(repo.path).quiet();

      const daemonResult = await startDaemon();
      context = daemonResult.context;
      wasAlreadyRunning = daemonResult.wasAlreadyRunning;

      const { exitCode: initExit } = await runAopCommand(["repo:init", repo.path]);
      expect(initExit).toBe(0);

      // Trigger refresh to ensure watcher picks up the new repo
      await triggerServerRefresh();

      await Bun.sleep(2000);

      const { exitCode: statusInitExit, stdout: statusInitOut } = await runAopCommand([
        "status",
        changePath,
        "--json",
      ]);
      expect(statusInitExit).toBe(0);
      const taskBefore = JSON.parse(statusInitOut);
      expect(taskBefore.status).toBe("DRAFT");

      const taskId = taskBefore.id;
      expect(taskId).toStartWith("task_");

      const { exitCode: readyExit } = await runAopCommand(["task:ready", taskId]);
      expect(readyExit).toBe(0);

      await Bun.sleep(1000);

      const { exitCode: statusWorkingExit, stdout: statusWorkingOut } = await runAopCommand([
        "status",
        taskId,
        "--json",
      ]);
      expect(statusWorkingExit).toBe(0);
      const taskWorking = JSON.parse(statusWorkingOut);
      expect(["READY", "WORKING"]).toContain(taskWorking.status);

      const serverTaskWorking = await waitForServerTaskStatus(taskId, "WORKING", {
        timeout: 30_000,
      });
      if (serverTaskWorking) {
        expect(serverTaskWorking.status).toBe("WORKING");

        const serverExecution = await getServerExecutionStatus(taskId);
        if (serverExecution) {
          expect(serverExecution.status).toBe("running");
        }
      }

      const completedTask = await waitForTask(taskId, ["DONE", "BLOCKED"], {
        timeout: 300_000,
        pollInterval: 5000,
      });

      expect(completedTask).not.toBeNull();
      expect(completedTask?.status).toBe("DONE");

      const serverTaskFinal = await getServerTaskStatus(taskId);
      expect(serverTaskFinal?.status).toBe("DONE");

      const helloFile = join(repo.path, ".worktrees", taskId, "hello.txt");
      const helloExists = await Bun.file(helloFile).exists();
      expect(helloExists).toBe(true);
    },
    E2E_TIMEOUT,
  );
});
