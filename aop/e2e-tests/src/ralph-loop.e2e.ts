// Prerequisites: `bun dev` must be running before executing this test
// These tests verify signal-based workflow transitions using the ralph-loop workflow

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  cleanupTestRepos,
  copyFixture,
  createTempRepo,
  type DaemonContext,
  getStepExecutionsForTask,
  isLocalServerRunning,
  runAopCommand,
  setupE2ETestDir,
  startDaemon,
  stopDaemon,
  type TempRepoResult,
  triggerServerRefresh,
  waitForTask,
} from "./helpers";
import {
  checkDevEnvironment,
  getServerTaskStatus,
  waitForServerTaskStatus,
} from "./helpers/server";

const E2E_TIMEOUT = 600_000;

describe("ralph loop workflow execution", () => {
  let repo: TempRepoResult;
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

    // This test requires the local server to be running
    const serverRunning = await isLocalServerRunning();
    if (!serverRunning) {
      throw new Error(
        "Local server not running.\n" +
          "Run 'bun dev' in a separate terminal before running E2E tests.",
      );
    }

    await setupE2ETestDir();
    repo = await createTempRepo("ralph-loop");

    // Start daemon once for all tests
    const daemonResult = await startDaemon();
    daemonContext = daemonResult.context;
    wasAlreadyRunning = daemonResult.wasAlreadyRunning;

    // Initialize repo once
    const { exitCode: initExit } = await runAopCommand(["repo:init", repo.path]);
    if (initExit !== 0) {
      throw new Error("Failed to initialize repo");
    }

    // Trigger refresh to ensure watcher picks up the new repo
    await triggerServerRefresh();
  });

  afterAll(async () => {
    await stopDaemon(daemonContext, wasAlreadyRunning);
    await repo.cleanup();
    await cleanupTestRepos();
  });

  test(
    "task completes when TASK_COMPLETE signal is detected",
    async () => {
      const changePath = await copyFixture("ralph-loop-test", repo.path);

      await Bun.$`git add .`.cwd(repo.path).quiet();
      await Bun.$`git commit -m "Add fixture"`.cwd(repo.path).quiet();

      // Trigger refresh to reconcile the new change
      await triggerServerRefresh();

      // Wait for reconciliation to complete
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

      // Mark task as READY with the ralph-loop workflow
      const { exitCode: readyExit } = await runAopCommand([
        "task:ready",
        taskId,
        "--workflow",
        "ralph-loop",
      ]);
      expect(readyExit).toBe(0);

      // Wait for the server to show WORKING status
      const serverTaskWorking = await waitForServerTaskStatus(taskId, "WORKING", {
        timeout: 30_000,
      });
      expect(serverTaskWorking?.status).toBe("WORKING");

      // Wait for task to complete - the iterate step should detect TASK_COMPLETE signal
      const completedTask = await waitForTask(taskId, ["DONE", "BLOCKED"], {
        timeout: 300_000,
        pollInterval: 5000,
      });

      expect(completedTask).not.toBeNull();
      expect(completedTask?.status).toBe("DONE");

      // Verify server-side task status
      const serverTaskFinal = await getServerTaskStatus(taskId);
      expect(serverTaskFinal?.status).toBe("DONE");

      // Verify the file was created
      const testFile = join(repo.path, ".worktrees", taskId, "iteration-test.txt");
      const fileExists = await Bun.file(testFile).exists();
      expect(fileExists).toBe(true);

      // Verify step_executions table contains signal value
      const stepExecutions = await getStepExecutionsForTask(taskId);
      expect(stepExecutions.length).toBeGreaterThan(0);

      // At least one step should have completed with TASK_COMPLETE signal
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

      await Bun.$`git add .`.cwd(repo.path).quiet();
      await Bun.$`git commit -m "Add review fixture"`.cwd(repo.path).quiet();

      // Trigger refresh to reconcile the new change
      await triggerServerRefresh();

      // Wait for reconciliation to complete
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

      // Mark task as READY with the ralph-loop workflow
      const { exitCode: readyExit } = await runAopCommand([
        "task:ready",
        taskId,
        "--workflow",
        "ralph-loop",
      ]);
      expect(readyExit).toBe(0);

      // Wait for task to complete - should go iterate -> review -> done
      const completedTask = await waitForTask(taskId, ["DONE", "BLOCKED"], {
        timeout: 300_000,
        pollInterval: 5000,
      });

      expect(completedTask).not.toBeNull();
      expect(completedTask?.status).toBe("DONE");

      // Verify server-side task status
      const serverTaskFinal = await getServerTaskStatus(taskId);
      expect(serverTaskFinal?.status).toBe("DONE");

      // Verify the file was created
      const testFile = join(repo.path, ".worktrees", taskId, "review-needed.txt");
      const fileExists = await Bun.file(testFile).exists();
      expect(fileExists).toBe(true);

      // Verify step_executions show the iterate -> review transition
      const stepExecutions = await getStepExecutionsForTask(taskId);
      expect(stepExecutions.length).toBeGreaterThanOrEqual(2);

      // Check that we had an iterate step with NEEDS_REVIEW signal
      const iterateWithReview = stepExecutions.find(
        (se) => se.step_type === "iterate" && se.signal === "NEEDS_REVIEW",
      );
      expect(iterateWithReview).toBeDefined();

      // Check that we had a review step that followed
      const reviewStep = stepExecutions.find((se) => se.step_type === "review");
      expect(reviewStep).toBeDefined();
      expect(reviewStep?.status).toBe("success");
    },
    E2E_TIMEOUT,
  );
});
