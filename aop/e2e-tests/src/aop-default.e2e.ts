// Prerequisites: `bun dev` must be running before executing this test
// Tests the aop-default workflow: implement -> full-review -> done

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  copyFixture,
  createTempWorktree,
  type DaemonContext,
  getStepExecutionsForTask,
  isLocalServerRunning,
  runAopCommand,
  startDaemon,
  stopDaemon,
  type TempWorktreeResult,
  triggerServerRefresh,
  waitForTask,
} from "./helpers";
import {
  checkDevEnvironment,
  getServerTaskStatus,
  waitForServerTaskStatus,
} from "./helpers/server";

const E2E_TIMEOUT = 600_000;

describe("aop-default workflow execution", () => {
  let worktree: TempWorktreeResult;
  let daemonContext: DaemonContext;
  let wasAlreadyRunning = false;

  beforeAll(async () => {
    const envCheck = await checkDevEnvironment();
    if (!envCheck.ready) {
      throw new Error(
        `Dev environment not ready: ${envCheck.reason}\n` +
          "Run 'bun dev' in a separate terminal before running E2E tests.",
      );
    }

    const serverRunning = await isLocalServerRunning();
    if (!serverRunning) {
      throw new Error(
        "Local server not running.\n" +
          "Run 'bun dev' in a separate terminal before running E2E tests.",
      );
    }

    worktree = await createTempWorktree("aop-default");

    const daemonResult = await startDaemon();
    daemonContext = daemonResult.context;
    wasAlreadyRunning = daemonResult.wasAlreadyRunning;

    const { exitCode: initExit } = await runAopCommand(["repo:init", worktree.path]);
    if (initExit !== 0) {
      throw new Error("Failed to initialize repo");
    }

    await triggerServerRefresh();
  });

  afterAll(async () => {
    await stopDaemon(daemonContext, wasAlreadyRunning);
    // Worktree is intentionally NOT cleaned up for inspection
  });

  test(
    "task completes through implement -> full-review -> done flow",
    async () => {
      const changePath = await copyFixture("cli-greeting-command", worktree.path);

      await Bun.$`git add .`.cwd(worktree.path).quiet();
      await Bun.$`git commit -m "Add cli-greeting-command fixture"`.cwd(worktree.path).quiet();

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

      // Mark task as READY with the aop-default workflow
      const { exitCode: readyExit } = await runAopCommand([
        "task:ready",
        taskId,
        "--workflow",
        "aop-default",
      ]);
      expect(readyExit).toBe(0);

      const serverTaskWorking = await waitForServerTaskStatus(taskId, "WORKING", {
        timeout: 30_000,
      });
      expect(serverTaskWorking?.status).toBe("WORKING");

      // Wait for task to complete - should go implement -> full-review -> done
      const completedTask = await waitForTask(taskId, ["DONE", "BLOCKED"], {
        timeout: 300_000,
        pollInterval: 5000,
      });

      expect(completedTask).not.toBeNull();
      expect(completedTask?.status).toBe("DONE");

      const serverTaskFinal = await getServerTaskStatus(taskId);
      expect(serverTaskFinal?.status).toBe("DONE");

      // Verify step_executions show the workflow progression
      const stepExecutions = await getStepExecutionsForTask(taskId);
      expect(stepExecutions.length).toBeGreaterThanOrEqual(2);

      // Should have at least one implement step with ALL_TASKS_DONE signal
      const implementComplete = stepExecutions.find(
        (se) => se.step_type === "implement" && se.signal === "ALL_TASKS_DONE",
      );
      expect(implementComplete).toBeDefined();

      // Should have a full-review step that passed
      const reviewStep = stepExecutions.find((se) => se.step_type === "full-review");
      expect(reviewStep).toBeDefined();
      expect(reviewStep?.signal).toBe("REVIEW_PASSED");
    },
    E2E_TIMEOUT,
  );
});
