import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  API_KEY,
  copyFixture,
  createTempRepo,
  createTestContext,
  destroyTestContext,
  getServerTaskStatus,
  runAopCommand,
  type TempRepoResult,
  type TestContext,
  triggerServerRefresh,
  waitForServerTaskStatus,
  waitForTask,
} from "./helpers";

const E2E_TIMEOUT = 600_000;

describe("degraded mode", () => {
  let ctx: TestContext;
  let repo: TempRepoResult;
  let remoteServerUrl: string;

  beforeAll(async () => {
    ctx = await createTestContext("degraded-mode");
    if (!ctx.remoteServerUrl) {
      throw new Error("Remote server context required for degraded-mode tests");
    }
    remoteServerUrl = ctx.remoteServerUrl;
    repo = await createTempRepo("degraded-mode", ctx.reposDir);
  });

  afterAll(async () => {
    await repo.cleanup();
    await destroyTestContext(ctx);
  });

  test(
    "tasks work locally and sync to remote server when connection is available",
    async () => {
      const changePath = await copyFixture("backlog-test", repo.path);

      await Bun.$`git add .`.cwd(repo.path).quiet();
      await Bun.$`git commit -m "Add fixture"`.cwd(repo.path).quiet();

      const { exitCode: setServerUrl } = await runAopCommand(
        ["config:set", "server_url", remoteServerUrl],
        undefined,
        ctx.env,
      );
      expect(setServerUrl).toBe(0);

      const { exitCode: setApiKey } = await runAopCommand(
        ["config:set", "api_key", API_KEY],
        undefined,
        ctx.env,
      );
      expect(setApiKey).toBe(0);

      const { exitCode: initExit } = await runAopCommand(
        ["repo:init", repo.path],
        undefined,
        ctx.env,
      );
      expect(initExit).toBe(0);

      await triggerServerRefresh(ctx.localServerUrl);
      await Bun.sleep(2000);

      const { exitCode: statusDraftExit, stdout: statusDraftOut } = await runAopCommand(
        ["status", changePath, "--json"],
        undefined,
        ctx.env,
      );
      expect(statusDraftExit).toBe(0);
      const taskDraft = JSON.parse(statusDraftOut);
      expect(taskDraft.status).toBe("DRAFT");
      const taskId = taskDraft.id;

      const { exitCode: readyExit } = await runAopCommand(
        ["task:ready", taskId],
        undefined,
        ctx.env,
      );
      expect(readyExit).toBe(0);
      await Bun.sleep(1000);

      const { exitCode: statusReadyExit, stdout: statusReadyOut } = await runAopCommand(
        ["status", taskId, "--json"],
        undefined,
        ctx.env,
      );
      expect(statusReadyExit).toBe(0);
      const taskReady = JSON.parse(statusReadyOut);
      expect(["READY", "WORKING"]).toContain(taskReady.status);

      const serverTaskAfter = await waitForServerTaskStatus(taskId, ["WORKING", "DONE"], {
        timeout: 60_000,
        pollInterval: 2000,
        serverUrl: remoteServerUrl,
        apiKey: API_KEY,
      });

      if (serverTaskAfter) {
        expect(["WORKING", "DONE"]).toContain(serverTaskAfter.status);
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
