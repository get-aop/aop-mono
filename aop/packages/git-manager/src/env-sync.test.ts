import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverEnvFiles, syncEnvFiles } from "./env-sync.ts";
import { GitExecutor } from "./git-executor.ts";
import { cleanupTestRepos, commitPendingChanges, createTestRepo } from "./test-utils.ts";

describe("env-sync", () => {
  let repoPath: string;
  let worktreePath: string;
  let executor: GitExecutor;

  beforeEach(async () => {
    repoPath = await createTestRepo();
    worktreePath = `${repoPath}-worktree`;
    mkdirSync(worktreePath, { recursive: true });
    executor = new GitExecutor(repoPath);
  });

  afterEach(async () => {
    await cleanupTestRepos();
  });

  describe("discoverEnvFiles", () => {
    test("discovers tracked .env files", async () => {
      writeFileSync(join(repoPath, ".env"), "KEY=value");
      await commitPendingChanges(repoPath);

      const files = await discoverEnvFiles(executor);

      expect(files).toEqual([".env"]);
    });

    test("discovers untracked .env files (not gitignored)", async () => {
      writeFileSync(join(repoPath, ".env.local"), "SECRET=123");

      const files = await discoverEnvFiles(executor);

      expect(files).toEqual([".env.local"]);
    });

    test("discovers multiple .env* files", async () => {
      writeFileSync(join(repoPath, ".env"), "A=1");
      writeFileSync(join(repoPath, ".env.test"), "B=2");
      await commitPendingChanges(repoPath);

      const files = await discoverEnvFiles(executor);

      expect(files).toContain(".env");
      expect(files).toContain(".env.test");
      expect(files.length).toBe(2);
    });

    test("discovers nested .env files", async () => {
      mkdirSync(join(repoPath, "packages", "api"), { recursive: true });
      writeFileSync(join(repoPath, "packages", "api", ".env.test"), "DB=test");
      await commitPendingChanges(repoPath);

      const files = await discoverEnvFiles(executor);

      expect(files).toEqual(["packages/api/.env.test"]);
    });

    test("excludes gitignored .env files", async () => {
      writeFileSync(join(repoPath, ".gitignore"), "node_modules/\n");
      mkdirSync(join(repoPath, "node_modules"), { recursive: true });
      writeFileSync(join(repoPath, "node_modules", ".env"), "BAD=1");
      writeFileSync(join(repoPath, ".env"), "GOOD=1");
      await commitPendingChanges(repoPath);

      const files = await discoverEnvFiles(executor);

      expect(files).toEqual([".env"]);
    });

    test("deduplicates results from tracked and untracked", async () => {
      writeFileSync(join(repoPath, ".env"), "KEY=value");
      await commitPendingChanges(repoPath);

      const files = await discoverEnvFiles(executor);

      const envCount = files.filter((f) => f === ".env").length;
      expect(envCount).toBe(1);
    });

    test("returns empty array when no .env files exist", async () => {
      const files = await discoverEnvFiles(executor);

      expect(files).toEqual([]);
    });
  });

  describe("syncEnvFiles", () => {
    test("symlinks root-level .env into worktree", async () => {
      writeFileSync(join(repoPath, ".env"), "KEY=value");
      await commitPendingChanges(repoPath);

      await syncEnvFiles(executor, repoPath, worktreePath);

      const link = join(worktreePath, ".env");
      expect(existsSync(link)).toBe(true);
      expect(readlinkSync(link)).toBe(join(repoPath, ".env"));
    });

    test("symlinks nested .env preserving directory structure", async () => {
      mkdirSync(join(repoPath, "packages", "api"), { recursive: true });
      writeFileSync(join(repoPath, "packages", "api", ".env.test"), "DB=test");
      await commitPendingChanges(repoPath);

      await syncEnvFiles(executor, repoPath, worktreePath);

      const link = join(worktreePath, "packages", "api", ".env.test");
      expect(existsSync(link)).toBe(true);
      expect(readlinkSync(link)).toBe(join(repoPath, "packages", "api", ".env.test"));
    });

    test("skips when env file already exists in worktree", async () => {
      writeFileSync(join(repoPath, ".env"), "REPO_VALUE=1");
      await commitPendingChanges(repoPath);

      writeFileSync(join(worktreePath, ".env"), "WORKTREE_VALUE=2");

      await syncEnvFiles(executor, repoPath, worktreePath);

      const content = await Bun.file(join(worktreePath, ".env")).text();
      expect(content).toBe("WORKTREE_VALUE=2");
    });

    test("does nothing when no .env files exist", async () => {
      await syncEnvFiles(executor, repoPath, worktreePath);
    });

    test("symlinks multiple .env files", async () => {
      writeFileSync(join(repoPath, ".env"), "A=1");
      writeFileSync(join(repoPath, ".env.local"), "B=2");
      await commitPendingChanges(repoPath);

      await syncEnvFiles(executor, repoPath, worktreePath);

      expect(existsSync(join(worktreePath, ".env"))).toBe(true);
      expect(existsSync(join(worktreePath, ".env.local"))).toBe(true);
    });
  });
});
