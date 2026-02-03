import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  AOP_BIN,
  cleanupTestRepos,
  copyFixture,
  createTempRepo,
  getAopEnv,
  runAopCommand,
  setupE2ETestDir,
} from "./helpers";

const E2E_TIMEOUT = 600_000; // 10 minutes (includes setup and apply)

describe("aop run and apply", () => {
  beforeAll(async () => {
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

      // Commit the fixture so main repo is clean
      await Bun.$`git add .`.cwd(repo.path).quiet();
      await Bun.$`git commit -m "Add fixture"`.cwd(repo.path).quiet();

      try {
        const env = getAopEnv();
        const bunPath = process.execPath;

        // Step 1: Run aop run to create worktree and have agent implement
        const runProc = Bun.spawn({
          cmd: [bunPath, AOP_BIN, "run", changePath],
          stdout: "inherit",
          stderr: "inherit",
          stdin: "inherit",
          cwd: repo.path,
          env,
        });

        const runExitCode = await runProc.exited;
        expect(runExitCode).toBe(0);

        const { exitCode: statusBeforeExit, stdout: statusBeforeStdout } = await runAopCommand(
          ["status", changePath, "--json"],
          repo.path,
        );
        expect(statusBeforeExit).toBe(0);
        const statusBeforeApply = JSON.parse(statusBeforeStdout);
        expect(statusBeforeApply.id).toStartWith("task_");
        expect(statusBeforeApply.status).toBe("DONE");

        await Bun.$`git add -A`.cwd(repo.path).quiet();
        await Bun.$`git commit -m "Add aop state" --allow-empty`.cwd(repo.path).quiet().nothrow();

        const applyProc = Bun.spawn({
          cmd: [bunPath, AOP_BIN, "apply", changePath],
          stdout: "inherit",
          stderr: "inherit",
          stdin: "inherit",
          cwd: repo.path,
          env,
        });

        const applyExitCode = await applyProc.exited;
        expect(applyExitCode).toBe(0);

        // Verify file was transferred to main repo
        const greetInMainPath = join(repo.path, "hello.txt");
        expect(existsSync(greetInMainPath)).toBe(true);

        // Verify there are uncommitted changes from apply
        const gitStatusResult = await Bun.$`git status --porcelain`.cwd(repo.path).quiet();
        const gitStatus = gitStatusResult.stdout.toString();
        expect(gitStatus.length).toBeGreaterThan(0);

        const { exitCode: statusAfterExit, stdout: statusAfterStdout } = await runAopCommand(
          ["status", changePath, "--json"],
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
