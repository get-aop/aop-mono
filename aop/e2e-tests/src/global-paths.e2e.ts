// Prerequisites: `bun dev` must be running before executing this test

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import {
  cleanupTestRepos,
  copyFixture,
  createTempRepo,
  createTestAopHome,
  type E2EServerContext,
  ensureChangesDir,
  getFullStatus,
  isLocalServerRunning,
  runAopCommand,
  setupE2ETestDir,
  startE2EServer,
  stopE2EServer,
  type TaskInfo,
  type TempRepoResult,
  type TestAopHome,
  triggerServerRefresh,
  waitForRepoInStatus,
  waitForTask,
  waitForTasksInRepo,
} from "./helpers";

const E2E_TIMEOUT = 600_000;

describe("global paths architecture", () => {
  let repo: TempRepoResult;
  let repoId: string;
  let context: E2EServerContext;
  let wasAlreadyRunning = false;
  let testHome: TestAopHome | null = null;

  beforeAll(async () => {
    await setupE2ETestDir();
    repo = await createTempRepo("global-paths");

    await ensureChangesDir(repo.path);

    const { exitCode: initExit } = await runAopCommand(["repo:init", repo.path]);
    expect(initExit).toBe(0);

    testHome = createTestAopHome("global-paths");
    const serverResult = await startE2EServer({ aopHome: testHome.path });
    context = serverResult.context;
    wasAlreadyRunning = serverResult.wasAlreadyRunning;
    expect(serverResult.success).toBe(true);
    expect(await isLocalServerRunning()).toBe(true);

    const repoSynced = await waitForRepoInStatus(repo.path, { timeout: 5000 });
    expect(repoSynced).toBe(true);

    // Get repo ID from status
    const status = await getFullStatus();
    const repoInfo = status?.repos.find((r) => r.path === repo.path);
    if (!repoInfo) throw new Error("Repo not found in status after sync");
    repoId = repoInfo.id;
  });

  afterAll(async () => {
    if (context) {
      await stopE2EServer(context, wasAlreadyRunning);
    }
    testHome?.cleanup();
    await repo.cleanup();
    await cleanupTestRepos();
  });

  test(
    "repo registration creates global directory structure",
    async () => {
      const globalDir = aopPaths.repoDir(repoId);
      expect(existsSync(globalDir)).toBe(true);
      expect(existsSync(aopPaths.openspecChanges(repoId))).toBe(true);
      expect(existsSync(aopPaths.worktrees(repoId))).toBe(true);
      expect(existsSync(aopPaths.worktreeMetadata(repoId))).toBe(true);
    },
    E2E_TIMEOUT,
  );

  test(
    "repo init creates symlink from openspec to global path",
    async () => {
      const symlinkPath = join(repo.path, "openspec");
      const stat = lstatSync(symlinkPath);
      expect(stat.isSymbolicLink()).toBe(true);

      const target = readlinkSync(symlinkPath);
      expect(target).toBe(aopPaths.openspec(repoId));
    },
    E2E_TIMEOUT,
  );

  test(
    "writes through symlink are visible at global path",
    async () => {
      const repoLocalChange = join(repo.path, "openspec", "changes", "feat-symlink");
      mkdirSync(repoLocalChange, { recursive: true });
      writeFileSync(
        join(repoLocalChange, "proposal.md"),
        "# Symlink Test\n\nWritten through symlink.",
      );

      // Should appear at global path immediately (no relocation needed)
      const globalChange = join(aopPaths.openspecChanges(repoId), "feat-symlink");
      expect(existsSync(join(globalChange, "proposal.md"))).toBe(true);
    },
    E2E_TIMEOUT,
  );

  test(
    "tasks are created from changes at global path",
    async () => {
      // Write a change artifact directly to the global path
      const globalChange = join(aopPaths.openspecChanges(repoId), "feat-global-task");
      mkdirSync(globalChange, { recursive: true });
      writeFileSync(join(globalChange, "proposal.md"), "# Global Task Test");

      // Trigger reconciliation
      await triggerServerRefresh();

      // Wait for task to appear
      const tasks = await waitForTasksInRepo(repo.path, 2, {
        timeout: 10_000,
        pollInterval: 1000,
      });

      // Find our task
      const globalTask = tasks.find((t) => t.change_path === "openspec/changes/feat-global-task");
      expect(globalTask).not.toBeUndefined();
      expect(globalTask?.status).toBe("DRAFT");
    },
    E2E_TIMEOUT,
  );

  test(
    "worktree creation at global path with env file sync",
    async () => {
      // Create an .env file in the repo
      writeFileSync(join(repo.path, ".env.test"), "TEST_KEY=test_value");
      await Bun.$`git add .env.test && git commit -m "add env"`.cwd(repo.path).quiet();

      // Copy a fixture and let it be detected
      await copyFixture("backlog-test", repo.path);

      await triggerServerRefresh();

      // Wait for task detection
      const tasks = await waitForTasksInRepo(repo.path, 3, {
        timeout: 10_000,
        pollInterval: 500,
      });

      const backlogTask = tasks.find(
        (t) => t.change_path === "openspec/changes/backlog-test",
      ) as TaskInfo;
      expect(backlogTask).not.toBeUndefined();

      // Mark task ready and wait for execution
      const { exitCode: readyExit } = await runAopCommand(["task:ready", backlogTask.id]);
      expect(readyExit).toBe(0);

      const completedTask = await waitForTask(backlogTask.id, ["DONE", "BLOCKED"], {
        timeout: 300_000,
        pollInterval: 2000,
      });
      expect(completedTask).not.toBeNull();

      // Verify worktree was created at global path, NOT at repo-local path
      expect(completedTask).not.toBeNull();
      const worktreePath = completedTask?.worktree_path;
      expect(worktreePath).not.toBeNull();
      if (!worktreePath) throw new Error("worktree_path is null");
      expect(worktreePath.startsWith(join(homedir(), ".aop", "repos"))).toBe(true);
      expect(worktreePath.startsWith(repo.path)).toBe(false);
      expect(existsSync(worktreePath)).toBe(true);

      // Verify .env.test was symlinked into worktree
      const envInWorktree = join(worktreePath, ".env.test");
      expect(existsSync(envInWorktree)).toBe(true);
    },
    E2E_TIMEOUT,
  );

  test(
    "no AOP artifacts in user repo after task lifecycle",
    async () => {
      // After all the above tests have run, verify no AOP artifacts remain in the repo
      const repoWorktrees = join(repo.path, ".worktrees");
      expect(existsSync(repoWorktrees)).toBe(false);

      // openspec should be a symlink to the global path, not a real directory
      const repoOpenspec = join(repo.path, "openspec");
      expect(lstatSync(repoOpenspec).isSymbolicLink()).toBe(true);
    },
    E2E_TIMEOUT,
  );
});
