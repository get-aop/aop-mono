import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  copyFixture,
  createTempRepo,
  createTestContext,
  destroyTestContext,
  ensureChangesDir,
  findTasksForRepo,
  getFullStatus,
  runAopCommand,
  type TaskInfo,
  type TempRepoResult,
  type TestContext,
  triggerServerRefresh,
  waitForRepoInStatus,
  waitForTaskMatch,
  waitForTasksInRepo,
} from "./helpers";

const E2E_TIMEOUT = 600_000;

describe("backlog full flow", () => {
  let ctx: TestContext;
  let repo: TempRepoResult;

  beforeAll(async () => {
    ctx = await createTestContext("backlog");
    repo = await createTempRepo("backlog", ctx.reposDir);
  });

  afterAll(async () => {
    await repo.cleanup();
    await destroyTestContext(ctx);
  });

  test(
    "full backlog flow: detect task, mark ready, execute, complete",
    async () => {
      await ensureChangesDir(repo.path);

      const { exitCode: initExit } = await runAopCommand(
        ["repo:init", repo.path],
        undefined,
        ctx.env,
      );
      expect(initExit).toBe(0);

      const repoSynced = await waitForRepoInStatus(repo.path, { timeout: 5000, env: ctx.env });
      expect(repoSynced).toBe(true);

      await triggerServerRefresh(ctx.localServerUrl);

      await copyFixture("backlog-test", repo.path);

      const repoTasks = await waitForTasksInRepo(repo.path, 1, {
        timeout: 10_000,
        pollInterval: 500,
        env: ctx.env,
      });
      expect(repoTasks.length).toBe(1);
      const task = repoTasks[0] as TaskInfo;
      expect(task.status).toBe("DRAFT");

      const { exitCode: readyExit } = await runAopCommand(
        ["task:ready", task.id],
        undefined,
        ctx.env,
      );
      expect(readyExit).toBe(0);

      const afterReadyStatus = await getFullStatus(ctx.env);
      if (!afterReadyStatus) throw new Error("Status should not be null");
      const updatedTasks = findTasksForRepo(afterReadyStatus, repo.path);
      const updatedTask = updatedTasks[0] as TaskInfo;
      expect(["READY", "WORKING"]).toContain(updatedTask.status);

      const completedTask = await waitForTaskMatch(
        task.id,
        (currentTask) => currentTask.status === "DONE" && currentTask.worktree_path === null,
        {
        timeout: 300_000,
        pollInterval: 2000,
        localServerUrl: ctx.localServerUrl,
        },
      );
      expect(completedTask).not.toBeNull();
      if (!completedTask) throw new Error("Completed task should not be null");
      expect(completedTask.status).toBe("DONE");

      expect(completedTask.worktree_path).toBeNull();
      const helloPath = join(repo.path, "hello.txt");
      expect(existsSync(helloPath)).toBe(true);
      const branchResult = await Bun.$`git branch --list backlog-test`.cwd(repo.path).text();
      expect(branchResult.trim()).toContain("backlog-test");
    },
    E2E_TIMEOUT,
  );
});
