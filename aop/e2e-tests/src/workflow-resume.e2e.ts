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
  setTaskStatus,
  type TempWorktreeResult,
  type TestContext,
  triggerServerRefresh,
  waitForServerTaskStatus,
  waitForTask,
} from "./helpers";

const E2E_TIMEOUT = 900_000;

describe("workflow resume-from-step", () => {
  let ctx: TestContext;
  let worktree: TempWorktreeResult;
  let remoteServerUrl: string;
  let pgDatabaseUrl: string;

  beforeAll(async () => {
    ctx = await createTestContext("workflow-resume", {
      localServerEnv: { AOP_TEST_MODE: "true" },
    });
    if (!ctx.remoteServerUrl || !ctx.pgDatabaseUrl) {
      throw new Error("Remote server context required for workflow-resume tests");
    }
    remoteServerUrl = ctx.remoteServerUrl;
    pgDatabaseUrl = ctx.pgDatabaseUrl;

    worktree = await createTempWorktree("workflow-resume");

    const { exitCode } = await runAopCommand(["repo:init", worktree.path], undefined, ctx.env);
    if (exitCode !== 0) {
      throw new Error("Failed to initialize repo");
    }

    await triggerServerRefresh(ctx.localServerUrl);
  });

  afterAll(async () => {
    await destroyTestContext(ctx);
  });

  test(
    "resume blocked task from full-review step",
    async () => {
      const changePath = await copyFixture("cli-greeting-command", worktree.path);

      await Bun.$`git add --force openspec/`.cwd(worktree.path).quiet().nothrow();
      await Bun.$`git commit -m "Add cli-greeting-command fixture" --allow-empty`
        .cwd(worktree.path)
        .quiet()
        .nothrow();

      await triggerServerRefresh(ctx.localServerUrl);
      await Bun.sleep(2000);

      const { exitCode: statusExit, stdout: statusOut } = await runAopCommand(
        ["status", changePath, "--json"],
        undefined,
        ctx.env,
      );
      expect(statusExit).toBe(0);
      const taskBefore = JSON.parse(statusOut);
      expect(taskBefore.status).toBe("DRAFT");

      const taskId = taskBefore.id;
      expect(taskId).toStartWith("task_");

      // Start the workflow — this kicks off the iterate step
      const { exitCode: readyExit } = await runAopCommand(
        ["task:ready", taskId, "--workflow", "aop-default"],
        undefined,
        ctx.env,
      );
      expect(readyExit).toBe(0);

      // Wait for the server to pick it up
      const serverWorking = await waitForServerTaskStatus(taskId, "WORKING", {
        timeout: 30_000,
        serverUrl: remoteServerUrl,
        apiKey: API_KEY,
      });
      expect(serverWorking?.status).toBe("WORKING");

      // Verify iteration started: step executions exist in the remote DB
      await Bun.sleep(5000);
      const earlySteps = await getStepExecutionsForTask(taskId, pgDatabaseUrl);
      expect(earlySteps.length).toBeGreaterThanOrEqual(1);
      expect(earlySteps.some((se) => se.step_id === "iterate")).toBe(true);

      // Force task to BLOCKED to simulate a failure — startWorkflow with
      // retryFromStep will cancel the active execution and start from the
      // requested step
      const set = await setTaskStatus(taskId, "BLOCKED", ctx.localServerUrl);
      expect(set).toBe(true);

      const afterSet = await waitForTask(taskId, ["BLOCKED"], {
        timeout: 10_000,
        localServerUrl: ctx.localServerUrl,
      });
      expect(afterSet?.status).toBe("BLOCKED");

      // Resume from full-review step using the retry flag
      const { exitCode: retryExit } = await runAopCommand(
        ["task:ready", taskId, "--resume", "full-review"],
        undefined,
        ctx.env,
      );
      expect(retryExit).toBe(0);

      const serverRetryWorking = await waitForServerTaskStatus(taskId, "WORKING", {
        timeout: 30_000,
        serverUrl: remoteServerUrl,
        apiKey: API_KEY,
      });
      expect(serverRetryWorking?.status).toBe("WORKING");

      // Wait for the resume run to complete — only full-review needs to run
      const retryResult = await waitForTask(taskId, ["DONE", "BLOCKED"], {
        timeout: 500_000,
        pollInterval: 5000,
        localServerUrl: ctx.localServerUrl,
      });
      expect(retryResult).not.toBeNull();
      expect(retryResult?.status).toBe("DONE");

      const serverFinal = await getServerTaskStatus(taskId, remoteServerUrl, API_KEY);
      expect(serverFinal?.status).toBe("DONE");

      // Verify both iterate and full-review step executions are recorded
      const allSteps = await getStepExecutionsForTask(taskId, pgDatabaseUrl);
      expect(allSteps.filter((se) => se.step_id === "iterate").length).toBeGreaterThanOrEqual(1);
      expect(allSteps.filter((se) => se.step_id === "full-review").length).toBeGreaterThanOrEqual(
        1,
      );

      // The resume created a new execution starting from full-review; verify
      // the retry execution is the one that produced the DONE outcome
      const retryExecSteps = allSteps.filter(
        (se) => se.execution_id !== earlySteps[0]?.execution_id,
      );
      expect(retryExecSteps.some((se) => se.step_id === "full-review")).toBe(true);
    },
    E2E_TIMEOUT,
  );
});
