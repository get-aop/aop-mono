import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase } from "../core/sqlite/database";
import {
  createIsolatedGlobalDir,
  type IsolatedGlobalDirContext
} from "../test-helpers";
import { parseInitArgs, runInitCommand } from "./init";

const TEST_DIR = join(tmpdir(), `.test-init-${Date.now()}`);

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("parseInitArgs", () => {
  test("returns empty path when no arguments provided (use current directory)", () => {
    const result = parseInitArgs([]);
    expect(result.path).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  test("returns the provided path argument", () => {
    const result = parseInitArgs(["/path/to/repo"]);
    expect(result.path).toBe("/path/to/repo");
    expect(result.error).toBeUndefined();
  });

  test("returns error for unknown options", () => {
    const result = parseInitArgs(["--unknown"]);
    expect(result.error).toBe("Unknown option: --unknown");
  });

  test("returns help flag when -h is provided", () => {
    const result = parseInitArgs(["-h"]);
    expect(result.help).toBe(true);
  });

  test("returns help flag when --help is provided", () => {
    const result = parseInitArgs(["--help"]);
    expect(result.help).toBe(true);
  });

  test("ignores extra positional arguments after path", () => {
    const result = parseInitArgs(["/path/to/repo", "extra", "args"]);
    expect(result.path).toBe("/path/to/repo");
    expect(result.error).toBeUndefined();
  });
});

describe("runInitCommand", () => {
  test("returns error when path is not a git repository", async () => {
    const nonGitDir = join(TEST_DIR, "non-git");
    await mkdir(nonGitDir, { recursive: true });

    const result = await runInitCommand(nonGitDir);

    expect(result.success).toBe(false);
    expect(result.error).toContain("not inside a git repository");
  });

  test("registers a valid git repository successfully", async () => {
    let ctx: IsolatedGlobalDirContext | undefined;
    try {
      ctx = await createIsolatedGlobalDir("init-valid");
      const gitDir = join(ctx.globalDir, "..", "git-repo");
      await mkdir(gitDir, { recursive: true });
      await Bun.$`git -C ${gitDir} init`.quiet();

      const result = await ctx.run(() => runInitCommand(gitDir));

      expect(result.success).toBe(true);
      expect(result.projectName).toBe("git-repo");
      expect(result.projectPath).toBe(gitDir);
      expect(result.message).toContain("Registered project");
      expect(result.message).toContain("git-repo");
    } finally {
      if (ctx) await ctx.cleanup();
    }
  });

  test("returns error when project is already registered", async () => {
    let ctx: IsolatedGlobalDirContext | undefined;
    try {
      ctx = await createIsolatedGlobalDir("init-already");
      const gitDir = join(ctx.globalDir, "..", "already-registered");
      await mkdir(gitDir, { recursive: true });
      await Bun.$`git -C ${gitDir} init`.quiet();

      const firstResult = await ctx.run(() => runInitCommand(gitDir));
      expect(firstResult.success).toBe(true);

      const secondResult = await ctx.run(() => runInitCommand(gitDir));
      expect(secondResult.success).toBe(false);
      expect(secondResult.error).toContain("already registered");
    } finally {
      if (ctx) await ctx.cleanup();
    }
  });

  test("uses current directory when no path is provided", async () => {
    let ctx: IsolatedGlobalDirContext | undefined;
    const originalCwd = process.cwd();
    try {
      ctx = await createIsolatedGlobalDir("init-cwd");
      const gitDir = join(ctx.globalDir, "..", "cwd-repo");
      await mkdir(gitDir, { recursive: true });
      await Bun.$`git -C ${gitDir} init`.quiet();
      process.chdir(gitDir);

      const result = await ctx.run(() => runInitCommand());

      expect(result.success).toBe(true);
      expect(result.projectName).toBe("cwd-repo");
    } finally {
      process.chdir(originalCwd);
      if (ctx) await ctx.cleanup();
    }
  });

  test("extracts project name from git remote URL", async () => {
    let ctx: IsolatedGlobalDirContext | undefined;
    try {
      ctx = await createIsolatedGlobalDir("init-remote");
      const gitDir = join(ctx.globalDir, "..", "remote-repo");
      await mkdir(gitDir, { recursive: true });
      await Bun.$`git -C ${gitDir} init`.quiet();
      await Bun.$`git -C ${gitDir} remote add origin git@github.com:user/my-project.git`.quiet();

      const result = await ctx.run(() => runInitCommand(gitDir));

      expect(result.success).toBe(true);
      expect(result.projectName).toBe("user-my-project");
    } finally {
      if (ctx) await ctx.cleanup();
    }
  });

  test("stores project in SQLite database, not YAML files", async () => {
    let ctx: IsolatedGlobalDirContext | undefined;
    try {
      ctx = await createIsolatedGlobalDir("init-sqlite");
      const gitDir = join(ctx.globalDir, "..", "sqlite-repo");
      await mkdir(gitDir, { recursive: true });
      await Bun.$`git -C ${gitDir} init`.quiet();

      const result = await ctx.run(async () => {
        const initResult = await runInitCommand(gitDir);
        if (!initResult.success) return initResult;

        const db = getDatabase();
        const projectInDb = db.queryOne<{ name: string; path: string }>(
          "SELECT name, path FROM projects WHERE name = ?",
          ["sqlite-repo"]
        );

        return { ...initResult, projectInDb };
      });

      expect(result.success).toBe(true);
      expect(
        (result as { projectInDb: { name: string; path: string } }).projectInDb
      ).toBeTruthy();
      expect(
        (result as { projectInDb: { name: string; path: string } }).projectInDb
          .name
      ).toBe("sqlite-repo");

      const projectsDir = join(ctx.globalDir, "projects");
      const files = await readdir(projectsDir);
      expect(
        files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      ).toHaveLength(0);
    } finally {
      if (ctx) await ctx.cleanup();
    }
  });
});
