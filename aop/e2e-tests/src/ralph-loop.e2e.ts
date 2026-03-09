import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  API_KEY,
  copyFixture,
  createTempRepo,
  createTestContext,
  destroyTestContext,
  getServerTaskStatus,
  getStepExecutionsForTask,
  runAopCommand,
  type TempRepoResult,
  type TestContext,
  triggerServerRefresh,
  waitForServerTaskStatus,
  waitForTask,
} from "./helpers";

const E2E_TIMEOUT = 600_000;

describe("ralph loop workflow execution", () => {
  let ctx: TestContext;
  let repo: TempRepoResult;
  let remoteServerUrl: string;
  let pgDatabaseUrl: string;

  beforeAll(async () => {
    ctx = await createTestContext("ralph-loop");
    if (!ctx.remoteServerUrl || !ctx.pgDatabaseUrl) {
      throw new Error("Remote server context required for ralph-loop tests");
    }
    remoteServerUrl = ctx.remoteServerUrl;
    pgDatabaseUrl = ctx.pgDatabaseUrl;

    repo = await createTempRepo("ralph-loop", ctx.reposDir);

    const { exitCode: initExit } = await runAopCommand(
      ["repo:init", repo.path],
      undefined,
      ctx.env,
    );
    if (initExit !== 0) {
      throw new Error("Failed to initialize repo");
    }

    await triggerServerRefresh(ctx.localServerUrl);
  });

  afterAll(async () => {
    await repo.cleanup();
    await destroyTestContext(ctx);
  });

  test(
    "task completes when TASK_COMPLETE signal is detected",
    async () => {
      const changePath = await copyFixture("ralph-loop-test", repo.path);

      await Bun.$`git add --force docs/`.cwd(repo.path).quiet().nothrow();
      await Bun.$`git commit -m "Add fixture" --allow-empty`.cwd(repo.path).quiet().nothrow();

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
        ["task:ready", taskId, "--workflow", "ralph-loop"],
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
      const testFile = join(worktreePath, "iteration-test.txt");
      const fileExists = await Bun.file(testFile).exists();
      expect(fileExists).toBe(true);

      const stepExecutions = await getStepExecutionsForTask(taskId, pgDatabaseUrl);
      expect(stepExecutions.length).toBeGreaterThan(0);

      const completedWithSignal = stepExecutions.find((se) => se.signal === "TASK_COMPLETE");
      expect(completedWithSignal).toBeDefined();
      expect(completedWithSignal?.step_type).toBe("iterate");
    },
    E2E_TIMEOUT,
  );

  test(
    "workflow transitions to review step when NEEDS_REVIEW signal is detected",
    async () => {
      const changePath = await copyFixture("ralph-loop-review-test", repo.path);

      await Bun.$`git add --force docs/`.cwd(repo.path).quiet().nothrow();
      await Bun.$`git commit -m "Add review fixture" --allow-empty`
        .cwd(repo.path)
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
        ["task:ready", taskId, "--workflow", "ralph-loop"],
        undefined,
        ctx.env,
      );
      expect(readyExit).toBe(0);

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
      const testFile = join(worktreePath, "review-needed.txt");
      const fileExists = await Bun.file(testFile).exists();
      expect(fileExists).toBe(true);

      const stepExecutions = await getStepExecutionsForTask(taskId, pgDatabaseUrl);
      expect(stepExecutions.length).toBeGreaterThanOrEqual(2);

      const iterateWithReview = stepExecutions.find(
        (se) => se.step_type === "iterate" && se.signal === "NEEDS_REVIEW",
      );
      expect(iterateWithReview).toBeDefined();

      const reviewStep = stepExecutions.find((se) => se.step_type === "review");
      expect(reviewStep).toBeDefined();
      expect(reviewStep?.status).toBe("success");
    },
    E2E_TIMEOUT,
  );
});
