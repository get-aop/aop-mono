import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listDirectories } from "./handlers.ts";

describe("listDirectories", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = `/tmp/aop-fs-test-${Date.now()}`;
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("lists subdirectories in a given path", async () => {
    mkdirSync(path.join(testDir, "dir-a"));
    mkdirSync(path.join(testDir, "dir-b"));
    writeFileSync(path.join(testDir, "file.txt"), "content");

    const result = await listDirectories(testDir);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.path).toBe(testDir);
    expect(result.data.directories).toContain("dir-a");
    expect(result.data.directories).toContain("dir-b");
    expect(result.data.directories).not.toContain("file.txt");
  });

  test("excludes hidden directories by default", async () => {
    mkdirSync(path.join(testDir, ".hidden"));
    mkdirSync(path.join(testDir, "visible"));

    const result = await listDirectories(testDir);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.directories).toContain("visible");
    expect(result.data.directories).not.toContain(".hidden");
  });

  test("includes hidden directories when hidden=true", async () => {
    mkdirSync(path.join(testDir, ".hidden"));
    mkdirSync(path.join(testDir, "visible"));

    const result = await listDirectories(testDir, { hidden: true });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.directories).toContain("visible");
    expect(result.data.directories).toContain(".hidden");
  });

  test("defaults to home directory when path is omitted", async () => {
    const result = await listDirectories();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.path).toBe(os.homedir());
  });

  test("returns parent path when not at root", async () => {
    const subDir = path.join(testDir, "subdir");
    mkdirSync(subDir);

    const result = await listDirectories(subDir);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.parent).toBe(testDir);
  });

  test("returns null parent at root", async () => {
    const result = await listDirectories("/");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.parent).toBeNull();
  });

  test("returns NOT_FOUND for non-existent path", async () => {
    const result = await listDirectories("/non/existent/path");

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  test("returns NOT_A_DIRECTORY for file path", async () => {
    const filePath = path.join(testDir, "file.txt");
    writeFileSync(filePath, "content");

    const result = await listDirectories(filePath);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("NOT_A_DIRECTORY");
  });

  test("returns PERMISSION_DENIED for unreadable path", async () => {
    const restrictedDir = path.join(testDir, "restricted");
    mkdirSync(restrictedDir, { mode: 0o000 });

    const result = await listDirectories(restrictedDir);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("PERMISSION_DENIED");

    // Cleanup: restore permissions before rmSync
    const { chmodSync } = await import("node:fs");
    chmodSync(restrictedDir, 0o755);
  });

  test("sorts directories alphabetically", async () => {
    mkdirSync(path.join(testDir, "zebra"));
    mkdirSync(path.join(testDir, "alpha"));
    mkdirSync(path.join(testDir, "mango"));

    const result = await listDirectories(testDir);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.directories).toEqual(["alpha", "mango", "zebra"]);
  });

  test("returns isGitRepo true when .git directory exists", async () => {
    mkdirSync(path.join(testDir, ".git"));

    const result = await listDirectories(testDir);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.isGitRepo).toBe(true);
  });

  test("returns isGitRepo false when .git directory does not exist", async () => {
    const result = await listDirectories(testDir);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.isGitRepo).toBe(false);
  });

  test("returns isGitRepo false when .git is a file not a directory", async () => {
    writeFileSync(path.join(testDir, ".git"), "gitdir: /some/path");

    const result = await listDirectories(testDir);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.isGitRepo).toBe(false);
  });
});
