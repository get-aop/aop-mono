import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  AOP_BIN,
  copyFixture,
  createTempRepo,
  createTestContext,
  destroyTestContext,
  runAopCommand,
  type TestContext,
  triggerServerRefresh,
  waitForTask,
} from "./helpers";

const E2E_TIMEOUT = 600_000;

describe("aop task workflow and apply", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext("run-apply");
  });

  afterAll(async () => {
    await destroyTestContext(ctx);
  });

  test(
    "transfers changes from worktree to main repo",
    async () => {
      const repo = await createTempRepo("run-apply", ctx.reposDir);
      const changePath = await copyFixture("backlog-test", repo.path);

      // Don't commit the fixture — the reconciler will relocate it to the global path.
      // Committing creates conflicts because the reconciler deletes repo-local files,
      // and the agent modifies them in the worktree, making the diff unapplicable.

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

        const completedTask = await waitForTask(taskId, ["DONE", "BLOCKED"], {
          timeout: 300_000,
          pollInterval: 2000,
          localServerUrl: ctx.localServerUrl,
        });
        expect(completedTask).not.toBeNull();
        expect(completedTask?.status).toBe("DONE");

        const worktreePath = completedTask?.worktree_path;
        expect(worktreePath).not.toBeNull();
        if (!worktreePath) throw new Error("worktree_path is null");
        const helloInWorktree = join(worktreePath, "hello.txt");
        expect(existsSync(helloInWorktree)).toBe(true);

        const applyProc = Bun.spawn({
          cmd: [process.execPath, AOP_BIN, "apply", taskId],
          stdout: "inherit",
          stderr: "inherit",
          stdin: "inherit",
          cwd: repo.path,
          env: ctx.env,
        });

        const applyExitCode = await applyProc.exited;
        expect(applyExitCode).toBe(0);

        const helloInMainPath = join(repo.path, "hello.txt");
        expect(existsSync(helloInMainPath)).toBe(true);

        const gitStatusResult = await Bun.$`git status --porcelain`.cwd(repo.path).quiet();
        const gitStatus = gitStatusResult.stdout.toString();
        expect(gitStatus.length).toBeGreaterThan(0);

        const { exitCode: statusAfterExit, stdout: statusAfterStdout } = await runAopCommand(
          ["status", taskId, "--json"],
          repo.path,
          ctx.env,
        );
        expect(statusAfterExit).toBe(0);
        const statusAfterApply = JSON.parse(statusAfterStdout);
        expect(statusAfterApply.id).toStartWith("task_");
        expect(statusAfterApply.status).toBe("DONE");
      } finally {
        await repo.cleanup();
      }
    },
    E2E_TIMEOUT,
  );
});
