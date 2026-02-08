import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  API_KEY,
  copyFixture,
  createTempWorktree,
  createTestContext,
  destroyTestContext,
  getServerTaskStatus,
  getStepExecutionsForTask,
  runAopCommand,
  type TempWorktreeResult,
  type TestContext,
  triggerServerRefresh,
  waitForServerTaskStatus,
  waitForTask,
} from "./helpers";

const E2E_TIMEOUT = 600_000;

describe("aop-default workflow execution", () => {
  let ctx: TestContext;
  let worktree: TempWorktreeResult;
  let remoteServerUrl: string;
  let pgDatabaseUrl: string;

  beforeAll(async () => {
    ctx = await createTestContext("aop-default");
    if (!ctx.remoteServerUrl || !ctx.pgDatabaseUrl) {
      throw new Error("Remote server context required for aop-default tests");
    }
    remoteServerUrl = ctx.remoteServerUrl;
    pgDatabaseUrl = ctx.pgDatabaseUrl;

    worktree = await createTempWorktree("aop-default");

    const { exitCode: initExit } = await runAopCommand(
      ["repo:init", worktree.path],
      undefined,
      ctx.env,
    );
    if (initExit !== 0) {
      throw new Error("Failed to initialize repo");
    }

    await triggerServerRefresh(ctx.localServerUrl);
  });

  afterAll(async () => {
    await destroyTestContext(ctx);
  });

  test(
    "task completes through implement -> full-review -> done flow",
    async () => {
      const changePath = await copyFixture("cli-greeting-command", worktree.path);

      await Bun.$`git add --force openspec/`.cwd(worktree.path).quiet().nothrow();
      await Bun.$`git commit -m "Add cli-greeting-command fixture" --allow-empty`
        .cwd(worktree.path)
        .quiet()
        .nothrow();

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
        ["task:ready", taskId, "--workflow", "aop-default"],
        undefined,
        ctx.env,
      );
      expect(readyExit).toBe(0);

      const serverTaskWorking = await waitForServerTaskStatus(taskId, "WORKING", {
        timeout: 30_000,
        serverUrl: remoteServerUrl,
        apiKey: API_KEY,
      });
      expect(serverTaskWorking?.status).toBe("WORKING");

      const completedTask = await waitForTask(taskId, ["DONE", "BLOCKED"], {
        timeout: 500_000,
        pollInterval: 5000,
        localServerUrl: ctx.localServerUrl,
      });

      expect(completedTask).not.toBeNull();
      expect(completedTask?.status).toBe("DONE");

      const serverTaskFinal = await getServerTaskStatus(taskId, remoteServerUrl, API_KEY);
      expect(serverTaskFinal?.status).toBe("DONE");

      const stepExecutions = await getStepExecutionsForTask(taskId, pgDatabaseUrl);
      expect(stepExecutions.length).toBeGreaterThanOrEqual(2);

      const implementComplete = stepExecutions.find(
        (se) => se.step_type === "implement" && se.signal === "ALL_TASKS_DONE",
      );
      expect(implementComplete).toBeDefined();

      const reviewStep = stepExecutions.find((se) => se.step_type === "full-review");
      expect(reviewStep).toBeDefined();
      expect(reviewStep?.signal).toBe("REVIEW_PASSED");
    },
    E2E_TIMEOUT,
  );
});
