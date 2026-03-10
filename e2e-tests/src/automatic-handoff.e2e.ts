import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  copyFixture,
  createTempRepo,
  createTestContext,
  destroyTestContext,
  runAopCommand,
  type TestContext,
  triggerServerRefresh,
  waitForTaskMatch,
} from "./helpers";

const E2E_TIMEOUT = 600_000;

describe("automatic task handoff", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext("automatic-handoff");
  });

  afterAll(async () => {
    await destroyTestContext(ctx);
  });

  test(
    "hands off DONE task changes into the main repo branch automatically",
    async () => {
      const repo = await createTempRepo("automatic-handoff", ctx.reposDir);
      const changePath = await copyFixture("backlog-test", repo.path);

      try {
        const { exitCode: initExit } = await runAopCommand(
          ["repo:init", repo.path],
          undefined,
          ctx.env,
        );
        expect(initExit).toBe(0);

        await triggerServerRefresh(ctx.localServerUrl);
        await Bun.sleep(3000);

        const { exitCode: statusInitExit, stdout: statusInitOut } = await runAopCommand(
          ["status", changePath, "--json"],
          repo.path,
          ctx.env,
        );
        expect(statusInitExit).toBe(0);
        const taskBefore = JSON.parse(statusInitOut);
        expect(taskBefore.id).toStartWith("task_");
        expect(taskBefore.status).toBe("DRAFT");
        const taskId = taskBefore.id;

        const { exitCode: readyExit } = await runAopCommand(
          ["task:ready", taskId],
          undefined,
          ctx.env,
        );
        expect(readyExit).toBe(0);

        const completedTask = await waitForTaskMatch(
          taskId,
          (task) => task.status === "DONE" && task.worktree_path === null,
          {
          timeout: 300_000,
          pollInterval: 2000,
          localServerUrl: ctx.localServerUrl,
          },
        );
        expect(completedTask).not.toBeNull();
        expect(completedTask?.status).toBe("DONE");
        expect(completedTask?.worktree_path).toBeNull();

        const helloInMainPath = join(repo.path, "hello.txt");
        expect(existsSync(helloInMainPath)).toBe(true);

        const branchResult = await Bun.$`git branch --list backlog-test`.cwd(repo.path).text();
        expect(branchResult.trim()).toContain("backlog-test");

        const { exitCode: statusAfterExit, stdout: statusAfterStdout } = await runAopCommand(
          ["status", taskId, "--json"],
          repo.path,
          ctx.env,
        );
        expect(statusAfterExit).toBe(0);
        const finalStatus = JSON.parse(statusAfterStdout);
        expect(finalStatus.id).toStartWith("task_");
        expect(finalStatus.status).toBe("DONE");
        expect(finalStatus.worktree_path).toBeNull();
      } finally {
        await repo.cleanup();
      }
    },
    E2E_TIMEOUT,
  );
});
