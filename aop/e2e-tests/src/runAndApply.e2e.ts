// Prerequisites: `bun dev` must be running before executing this test

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  AOP_BIN,
  cleanupTestRepos,
  copyFixture,
  createTempRepo,
  getAopEnv,
  isLocalServerRunning,
  runAopCommand,
  setupE2ETestDir,
  triggerServerRefresh,
  waitForTask,
} from "./helpers";

const E2E_TIMEOUT = 600_000; // 10 minutes (includes setup and apply)

describe("aop task workflow and apply", () => {
  beforeAll(async () => {
    // This test requires the local server to be running
    const serverRunning = await isLocalServerRunning();
    if (!serverRunning) {
      throw new Error(
        "Local server not running.\n" +
          "Run 'bun dev' in a separate terminal before running E2E tests.",
      );
    }

    await setupE2ETestDir();
  });

  afterAll(async () => {
    await cleanupTestRepos();
  });

  test(
    "transfers changes from worktree to main repo",
    async () => {
      const repo = await createTempRepo("run-apply");
      const changePath = await copyFixture("backlog-test", repo.path);

      // Don't commit the fixture — the reconciler will relocate it to the global path.
      // Committing creates conflicts because the reconciler deletes repo-local files,
      // and the agent modifies them in the worktree, making the diff unapplicable.

      try {
        const env = getAopEnv();

        // Step 1: Initialize repo
        const { exitCode: initExit } = await runAopCommand(["repo:init", repo.path]);
        expect(initExit).toBe(0);

        // Trigger refresh to ensure watcher picks up the new repo and relocates fixture
        await triggerServerRefresh();

        // Wait for task to be detected (reconciler relocates + creates task)
        await Bun.sleep(3000);

        // Get task info
        const { exitCode: statusInitExit, stdout: statusInitOut } = await runAopCommand(
          ["status", changePath, "--json"],
          repo.path,
        );
        expect(statusInitExit).toBe(0);
        const taskBefore = JSON.parse(statusInitOut);
        expect(taskBefore.id).toStartWith("task_");
        expect(taskBefore.status).toBe("DRAFT");
        const taskId = taskBefore.id;

        // Step 2: Mark task as ready (this triggers execution via local server)
        const { exitCode: readyExit } = await runAopCommand(["task:ready", taskId]);
        expect(readyExit).toBe(0);

        // Step 3: Wait for task to complete
        const completedTask = await waitForTask(taskId, ["DONE", "BLOCKED"], {
          timeout: 300_000,
          pollInterval: 2000,
        });
        expect(completedTask).not.toBeNull();
        expect(completedTask?.status).toBe("DONE");

        // Verify the file was created in worktree
        const worktreePath = completedTask?.worktree_path;
        expect(worktreePath).not.toBeNull();
        if (!worktreePath) throw new Error("worktree_path is null");
        const helloInWorktree = join(worktreePath, "hello.txt");
        expect(existsSync(helloInWorktree)).toBe(true);

        // With global paths, AOP state lives outside the repo — working dir should be clean

        // Step 4: Apply changes from worktree to main repo (use taskId, not changePath)
        const bunPath = process.execPath;
        const applyProc = Bun.spawn({
          cmd: [bunPath, AOP_BIN, "apply", taskId],
          stdout: "inherit",
          stderr: "inherit",
          stdin: "inherit",
          cwd: repo.path,
          env,
        });

        const applyExitCode = await applyProc.exited;
        expect(applyExitCode).toBe(0);

        // Verify file was transferred to main repo
        const helloInMainPath = join(repo.path, "hello.txt");
        expect(existsSync(helloInMainPath)).toBe(true);

        // Verify there are uncommitted changes from apply
        const gitStatusResult = await Bun.$`git status --porcelain`.cwd(repo.path).quiet();
        const gitStatus = gitStatusResult.stdout.toString();
        expect(gitStatus.length).toBeGreaterThan(0);

        // Verify task status is still DONE after apply
        const { exitCode: statusAfterExit, stdout: statusAfterStdout } = await runAopCommand(
          ["status", taskId, "--json"],
          repo.path,
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
