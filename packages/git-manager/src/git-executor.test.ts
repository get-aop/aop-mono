import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GitExecutor } from "./git-executor.ts";
import { cleanupTestRepos, createTestRepo } from "./test-utils.ts";

describe("GitExecutor", () => {
  let repoPath: string;
  let executor: GitExecutor;

  beforeEach(async () => {
    repoPath = await createTestRepo({ withInitialCommit: false });
    executor = new GitExecutor(repoPath);
  });

  afterEach(async () => {
    await cleanupTestRepos();
  });

  describe("exec", () => {
    test("executes git command and returns stdout", async () => {
      const result = await executor.exec(["status", "--porcelain"]);
      expect(result).toBe("");
    });

    test("throws on non-zero exit code", async () => {
      await expect(executor.exec(["checkout", "nonexistent"])).rejects.toThrow(
        "git checkout nonexistent failed",
      );
    });

    test("uses custom cwd when provided", async () => {
      const subdir = `${repoPath}/subdir`;
      await Bun.$`mkdir -p ${subdir}`.quiet();

      const result = await executor.exec(["rev-parse", "--show-toplevel"], subdir);
      expect(result).toEndWith(repoPath);
    });
  });

  describe("execRaw", () => {
    test("returns exitCode, stdout, stderr without throwing", async () => {
      const result = await executor.execRaw(["checkout", "nonexistent"]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("nonexistent");
    });

    test("returns success result with stdout", async () => {
      const result = await executor.execRaw(["status", "--porcelain"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    });
  });
});
