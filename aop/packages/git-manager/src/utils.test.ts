import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRepoRoot, getRemoteOrigin } from "./utils.ts";

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

describe("getRemoteOrigin", () => {
  test("returns null for non-git directory", async () => {
    const origin = await getRemoteOrigin("/tmp");
    expect(origin).toBeNull();
  });
});
