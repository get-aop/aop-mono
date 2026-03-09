import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  API_KEY,
  copyFixture,
  createTempRepo,
  createTestContext,
  destroyTestContext,
  getServerExecutionStatus,
  getServerTaskStatus,
  runAopCommand,
  type TempRepoResult,
  type TestContext,
  triggerServerRefresh,
  waitForServerTaskStatus,
  waitForTask,
} from "./helpers";

const E2E_TIMEOUT = 600_000;

describe("server workflow execution", () => {
  let ctx: TestContext;
  let repo: TempRepoResult;
  let remoteServerUrl: string;

  beforeAll(async () => {
    ctx = await createTestContext("server-workflow");
    if (!ctx.remoteServerUrl) {
      throw new Error("Remote server context required for server-workflow tests");
    }
    remoteServerUrl = ctx.remoteServerUrl;
    repo = await createTempRepo("server-workflow", ctx.reposDir);
  });

  afterAll(async () => {
    await repo.cleanup();
    await destroyTestContext(ctx);
  });

  test(
    "full workflow execution syncs between CLI and server",
    async () => {
      const changePath = await copyFixture("backlog-test", repo.path);

      await Bun.$`git add .`.cwd(repo.path).quiet();
      await Bun.$`git commit -m "Add fixture"`.cwd(repo.path).quiet();

      const { exitCode: initExit } = await runAopCommand(
        ["repo:init", repo.path],
        undefined,
        ctx.env,
      );
      expect(initExit).toBe(0);

      await triggerServerRefresh(ctx.localServerUrl);

      await Bun.sleep(2000);

      const { exitCode: statusInitExit, stdout: statusInitOut } = await runAopCommand(
        ["status", changePath, "--json"],
        undefined,
        ctx.env,
      );
      expect(statusInitExit).toBe(0);
      const taskBefore = JSON.parse(statusInitOut);
      expect(taskBefore.status).toBe("DRAFT");

      const taskId = taskBefore.id;
      expect(taskId).toStartWith("task_");

      const { exitCode: readyExit } = await runAopCommand(
        ["task:ready", taskId],
        undefined,
        ctx.env,
      );
      expect(readyExit).toBe(0);

      await Bun.sleep(1000);

      const { exitCode: statusWorkingExit, stdout: statusWorkingOut } = await runAopCommand(
        ["status", taskId, "--json"],
        undefined,
        ctx.env,
      );
      expect(statusWorkingExit).toBe(0);
      const taskWorking = JSON.parse(statusWorkingOut);
      expect(["READY", "WORKING"]).toContain(taskWorking.status);

      const serverTaskWorking = await waitForServerTaskStatus(taskId, "WORKING", {
        timeout: 30_000,
        serverUrl: remoteServerUrl,
        apiKey: API_KEY,
      });
      if (serverTaskWorking) {
        expect(serverTaskWorking.status).toBe("WORKING");

        const serverExecution = await getServerExecutionStatus(taskId, remoteServerUrl, API_KEY);
        if (serverExecution) {
          expect(serverExecution.status).toBe("running");
        }
      }

      const completedTask = await waitForTask(taskId, ["DONE", "BLOCKED"], {
        timeout: 300_000,
        pollInterval: 5000,
        localServerUrl: ctx.localServerUrl,
      });

      expect(completedTask).not.toBeNull();
      expect(completedTask?.status).toBe("DONE");

      const serverTaskFinal = await getServerTaskStatus(taskId, remoteServerUrl, API_KEY);
      expect(serverTaskFinal?.status).toBe("DONE");

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
