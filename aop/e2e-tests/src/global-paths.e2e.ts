import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import {
  copyFixture,
  createTempRepo,
  createTestContext,
  destroyTestContext,
  ensureChangesDir,
  getFullStatus,
  runAopCommand,
  type TaskInfo,
  type TempRepoResult,
  type TestContext,
  triggerServerRefresh,
  waitForRepoInStatus,
  waitForTask,
  waitForTasksInRepo,
} from "./helpers";

const E2E_TIMEOUT = 600_000;

describe("global paths architecture", () => {
  let ctx: TestContext;
  let repo: TempRepoResult;
  let repoId: string;

  beforeAll(async () => {
    ctx = await createTestContext("global-paths", { remoteServer: false });
    repo = await createTempRepo("global-paths", ctx.reposDir);

    await ensureChangesDir(repo.path);

    const { exitCode: initExit } = await runAopCommand(
      ["repo:init", repo.path],
      undefined,
      ctx.env,
    );
    expect(initExit).toBe(0);

    const repoSynced = await waitForRepoInStatus(repo.path, { timeout: 5000, env: ctx.env });
    expect(repoSynced).toBe(true);

    const status = await getFullStatus(ctx.env);
    const repoInfo = status?.repos.find((r) => r.path === repo.path);
    if (!repoInfo) throw new Error("Repo not found in status after sync");
    repoId = repoInfo.id;
  });

  afterAll(async () => {
    await repo.cleanup();
    await destroyTestContext(ctx);
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

      const globalChange = join(aopPaths.openspecChanges(repoId), "feat-symlink");
      expect(existsSync(join(globalChange, "proposal.md"))).toBe(true);
    },
    E2E_TIMEOUT,
  );

  test(
    "tasks are created from changes at global path",
    async () => {
      const globalChange = join(aopPaths.openspecChanges(repoId), "feat-global-task");
      mkdirSync(globalChange, { recursive: true });
      writeFileSync(join(globalChange, "proposal.md"), "# Global Task Test");

      await triggerServerRefresh(ctx.localServerUrl);

      const tasks = await waitForTasksInRepo(repo.path, 2, {
        timeout: 10_000,
        pollInterval: 1000,
        env: ctx.env,
      });

      const globalTask = tasks.find((t) => t.change_path === "openspec/changes/feat-global-task");
      expect(globalTask).not.toBeUndefined();
      expect(globalTask?.status).toBe("DRAFT");
    },
    E2E_TIMEOUT,
  );

  test(
    "worktree creation at global path with env file sync",
    async () => {
      writeFileSync(join(repo.path, ".env.test"), "TEST_KEY=test_value");
      await Bun.$`git add .env.test && git commit -m "add env"`.cwd(repo.path).quiet();

      await copyFixture("backlog-test", repo.path);

      await triggerServerRefresh(ctx.localServerUrl);

      const tasks = await waitForTasksInRepo(repo.path, 3, {
        timeout: 10_000,
        pollInterval: 500,
        env: ctx.env,
      });

      const backlogTask = tasks.find(
        (t) => t.change_path === "openspec/changes/backlog-test",
      ) as TaskInfo;
      expect(backlogTask).not.toBeUndefined();

      const { exitCode: readyExit } = await runAopCommand(
        ["task:ready", backlogTask.id],
        undefined,
        ctx.env,
      );
      expect(readyExit).toBe(0);

      const completedTask = await waitForTask(backlogTask.id, ["DONE", "BLOCKED"], {
        timeout: 300_000,
        pollInterval: 2000,
        localServerUrl: ctx.localServerUrl,
      });
      expect(completedTask).not.toBeNull();

      const worktreePath = completedTask?.worktree_path;
      expect(worktreePath).not.toBeNull();
      if (!worktreePath) throw new Error("worktree_path is null");
      expect(worktreePath.startsWith(join(homedir(), ".aop", "repos"))).toBe(true);
      expect(worktreePath.startsWith(repo.path)).toBe(false);
      expect(existsSync(worktreePath)).toBe(true);

      const envInWorktree = join(worktreePath, ".env.test");
      expect(existsSync(envInWorktree)).toBe(true);
    },
    E2E_TIMEOUT,
  );

  test(
    "no AOP artifacts in user repo after task lifecycle",
    async () => {
      const repoWorktrees = join(repo.path, ".worktrees");
      expect(existsSync(repoWorktrees)).toBe(false);

      const repoOpenspec = join(repo.path, "openspec");
      expect(lstatSync(repoOpenspec).isSymbolicLink()).toBe(true);
    },
    E2E_TIMEOUT,
  );
});
