import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  copyFixture,
  createTempRepo,
  createTestContext,
  destroyTestContext,
  ensureChangesDir,
  getFullStatus,
  getRepoStatus,
  runAopCommand,
  type TempRepoResult,
  type TestContext,
  triggerServerRefresh,
  waitForTask,
  waitForTasksInRepo,
} from "./helpers";

const E2E_TIMEOUT = 600_000;

describe("concurrency limits", () => {
  let ctx: TestContext;
  let repo: TempRepoResult;

  beforeAll(async () => {
    ctx = await createTestContext("concurrency");
    repo = await createTempRepo("concurrency", ctx.reposDir);
  });

  afterAll(async () => {
    await repo.cleanup();
    await destroyTestContext(ctx);
  });

  test(
    "enforces global concurrency limit of 1",
    async () => {
      await ensureChangesDir(repo.path);

      const { exitCode: initExit } = await runAopCommand(
        ["repo:init", repo.path],
        undefined,
        ctx.env,
      );
      expect(initExit).toBe(0);

      const { exitCode: configExit } = await runAopCommand(
        ["config:set", "max_concurrent_tasks", "1"],
        undefined,
        ctx.env,
      );
      expect(configExit).toBe(0);

      await triggerServerRefresh(ctx.localServerUrl);

      await copyFixture("concurrency-test-1", repo.path);
      await copyFixture("concurrency-test-2", repo.path);

      const detectedTasks = await waitForTasksInRepo(repo.path, 2, {
        timeout: 60_000,
        pollInterval: 2000,
        env: ctx.env,
      });
      expect(detectedTasks.length).toBe(2);
      const draftTasks = detectedTasks.filter((t) => t.status === "DRAFT");
      expect(draftTasks.length).toBe(2);

      let status = await getFullStatus(ctx.env);
      if (!status) throw new Error("Status should not be null");

      const task1 = draftTasks.find((t) => t.change_path.includes("concurrency-test-1"));
      const task2 = draftTasks.find((t) => t.change_path.includes("concurrency-test-2"));
      if (!task1 || !task2) throw new Error("Tasks should exist");

      await runAopCommand(["task:ready", task1.id], undefined, ctx.env);
      await runAopCommand(["task:ready", task2.id], undefined, ctx.env);

      await Bun.sleep(3000);

      status = await getFullStatus(ctx.env);
      if (!status) throw new Error("Status should not be null");
      expect(status.globalCapacity.max).toBeGreaterThanOrEqual(1);

      const repoStatus = getRepoStatus(status, repo.path);
      const workingTasks = repoStatus.tasks.filter((t) => t.status === "WORKING");
      expect(workingTasks.length).toBeLessThanOrEqual(1);

      const completedTask1 = await waitForTask(task1.id, ["DONE", "BLOCKED"], {
        timeout: 300_000,
        pollInterval: 2000,
        localServerUrl: ctx.localServerUrl,
      });
      expect(completedTask1).not.toBeNull();
      expect(["DONE", "BLOCKED"]).toContain(completedTask1?.status ?? "");

      const completedTask2 = await waitForTask(task2.id, ["DONE", "BLOCKED"], {
        timeout: 300_000,
        pollInterval: 2000,
        localServerUrl: ctx.localServerUrl,
      });
      expect(completedTask2).not.toBeNull();
      expect(["DONE", "BLOCKED"]).toContain(completedTask2?.status ?? "");
    },
    E2E_TIMEOUT,
  );
});
