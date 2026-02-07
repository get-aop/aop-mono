import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTestRepos, createTestRepo } from "./test-utils.ts";
import { findRepoRoot, getRemoteOrigin, listLocalBranches } from "./utils.ts";

const TEST_DIR = join(tmpdir(), "git-utils-test");

describe("findRepoRoot", () => {
  beforeAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(join(TEST_DIR, "repo/.git"), { recursive: true });
    mkdirSync(join(TEST_DIR, "repo/src/commands"), { recursive: true });
    writeFileSync(join(TEST_DIR, "repo/src/index.ts"), "");
    mkdirSync(join(TEST_DIR, "no-git/nested"), { recursive: true });
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("finds repo root from nested directory", () => {
    const nestedPath = join(TEST_DIR, "repo/src/commands");
    const result = findRepoRoot(nestedPath);
    expect(result).toBe(join(TEST_DIR, "repo"));
  });

  test("finds repo root from repo root itself", () => {
    const repoPath = join(TEST_DIR, "repo");
    const result = findRepoRoot(repoPath);
    expect(result).toBe(repoPath);
  });

  test("returns null when no .git directory exists", () => {
    const noGitPath = join(TEST_DIR, "no-git/nested");
    const result = findRepoRoot(noGitPath);
    expect(result).toBeNull();
  });
});

describe("listLocalBranches", () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await createTestRepo();
  });

  afterAll(async () => {
    await cleanupTestRepos();
  });

  test("returns single branch for new repo", async () => {
    const result = await listLocalBranches(repoPath);
    expect(result.current).toBe("main");
    expect(result.branches).toEqual(["main"]);
  });

  test("returns multiple branches", async () => {
    await Bun.$`git checkout -b feature-a`.cwd(repoPath).quiet();
    await Bun.$`git checkout -b feature-b`.cwd(repoPath).quiet();

    const result = await listLocalBranches(repoPath);
    expect(result.current).toBe("feature-b");
    expect(result.branches).toContain("main");
    expect(result.branches).toContain("feature-a");
    expect(result.branches).toContain("feature-b");
    expect(result.branches).toHaveLength(3);
  });
});

describe("getRemoteOrigin", () => {
  let repoPath: string;

  afterAll(async () => {
    await cleanupTestRepos();
  });

  test("returns null for non-git directory", async () => {
    const origin = await getRemoteOrigin("/tmp");
    expect(origin).toBeNull();
  });

  test("returns origin url when remote is configured", async () => {
    repoPath = await createTestRepo();
    const fakeOrigin = "https://github.com/test/repo.git";
    await Bun.$`git remote add origin ${fakeOrigin}`.cwd(repoPath).quiet();

    const origin = await getRemoteOrigin(repoPath);
    expect(origin).toBe(fakeOrigin);
  });
});
