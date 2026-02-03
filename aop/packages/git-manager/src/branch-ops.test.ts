import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BranchOps } from "./branch-ops.ts";
import { GitExecutor } from "./git-executor.ts";
import { cleanupTestRepos, createTestRepo } from "./test-utils.ts";

describe("BranchOps", () => {
  let repoPath: string;
  let branchOps: BranchOps;

  beforeEach(async () => {
    repoPath = await createTestRepo();
    const executor = new GitExecutor(repoPath);
    branchOps = new BranchOps(executor);
  });

  afterEach(async () => {
    await cleanupTestRepos();
  });

  describe("exists", () => {
    test("returns true for existing branch", async () => {
      expect(await branchOps.exists("main")).toBe(true);
    });

    test("returns false for non-existing branch", async () => {
      expect(await branchOps.exists("nonexistent")).toBe(false);
    });
  });

  describe("getCommit", () => {
    test("returns commit SHA for branch", async () => {
      const sha = await branchOps.getCommit("main");
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
    });

    test("throws for non-existing ref", async () => {
      await expect(branchOps.getCommit("nonexistent")).rejects.toThrow();
    });
  });

  describe("create", () => {
    test("creates new branch from start point", async () => {
      const mainSha = await branchOps.getCommit("main");
      await branchOps.create("feature", mainSha);

      expect(await branchOps.exists("feature")).toBe(true);
    });
  });

  describe("delete", () => {
    test("deletes existing branch", async () => {
      await Bun.$`git branch feature`.cwd(repoPath).quiet();
      expect(await branchOps.exists("feature")).toBe(true);

      await branchOps.delete("feature");
      expect(await branchOps.exists("feature")).toBe(false);
    });
  });

  describe("checkout", () => {
    test("checks out existing branch", async () => {
      await Bun.$`git branch feature`.cwd(repoPath).quiet();
      await branchOps.checkout("feature");

      const current = await Bun.$`git rev-parse --abbrev-ref HEAD`.cwd(repoPath).text();
      expect(current.trim()).toBe("feature");
    });
  });

  describe("checkoutPrevious", () => {
    test("returns to previous branch", async () => {
      await Bun.$`git branch feature`.cwd(repoPath).quiet();
      await branchOps.checkout("feature");
      await branchOps.checkoutPrevious();

      const current = await Bun.$`git rev-parse --abbrev-ref HEAD`.cwd(repoPath).text();
      expect(current.trim()).toBe("main");
    });
  });

  describe("getDefaultBranch", () => {
    test("returns main when main branch exists", async () => {
      const defaultBranch = await branchOps.getDefaultBranch();
      expect(defaultBranch).toBe("main");
    });

    test("returns master when only master exists", async () => {
      // Rename main to master
      await Bun.$`git branch -m main master`.cwd(repoPath).quiet();

      const defaultBranch = await branchOps.getDefaultBranch();
      expect(defaultBranch).toBe("master");
    });

    test("returns current branch when neither main nor master exists", async () => {
      // Rename main to something else and switch to it
      await Bun.$`git branch -m main develop`.cwd(repoPath).quiet();

      const defaultBranch = await branchOps.getDefaultBranch();
      expect(defaultBranch).toBe("develop");
    });
  });
});
