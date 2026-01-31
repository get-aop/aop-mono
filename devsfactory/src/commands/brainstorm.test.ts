import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createIsolatedGlobalDir,
  type IsolatedGlobalDirContext
} from "../test-helpers";
import { parseBrainstormArgs, runBrainstormCommand } from "./brainstorm";

const TEST_DIR = join(tmpdir(), `.test-brainstorm-${Date.now()}`);

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("parseBrainstormArgs", () => {
  test("returns empty projectName when no arguments provided (use current directory)", () => {
    const result = parseBrainstormArgs([]);
    expect(result.projectName).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  test("returns the provided project name argument", () => {
    const result = parseBrainstormArgs(["my-project"]);
    expect(result.projectName).toBe("my-project");
    expect(result.error).toBeUndefined();
  });

  test("returns error for unknown options", () => {
    const result = parseBrainstormArgs(["--unknown"]);
    expect(result.error).toBe("Unknown option: --unknown");
  });

  test("returns help flag when -h is provided", () => {
    const result = parseBrainstormArgs(["-h"]);
    expect(result.help).toBe(true);
  });

  test("returns help flag when --help is provided", () => {
    const result = parseBrainstormArgs(["--help"]);
    expect(result.help).toBe(true);
  });

  test("ignores extra positional arguments after project name", () => {
    const result = parseBrainstormArgs(["my-project", "extra", "args"]);
    expect(result.projectName).toBe("my-project");
    expect(result.error).toBeUndefined();
  });
});

describe("runBrainstormCommand", () => {
  test("returns error when not in a project context and no project name provided", async () => {
    const nonProjectDir = join(TEST_DIR, "non-project");
    await mkdir(nonProjectDir, { recursive: true });

    const originalCwd = process.cwd();
    process.chdir(nonProjectDir);

    try {
      const result = await runBrainstormCommand();

      expect(result.success).toBe(false);
      expect(result.error).toContain("No project context found");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("returns error when named project is not found", async () => {
    let ctx: IsolatedGlobalDirContext | undefined;
    try {
      ctx = await createIsolatedGlobalDir("brainstorm-not-found");

      const result = await ctx.run(() =>
        runBrainstormCommand("non-existent-project")
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        "Project 'non-existent-project' not found"
      );
    } finally {
      if (ctx) await ctx.cleanup();
    }
  });

  test("succeeds in local mode with .devsfactory directory", async () => {
    const projectDir = join(TEST_DIR, "local-project");
    const devsfactoryDir = join(projectDir, ".devsfactory");
    await mkdir(devsfactoryDir, { recursive: true });

    const originalCwd = process.cwd();
    process.chdir(projectDir);

    try {
      const result = await runBrainstormCommand();

      expect(result.success).toBe(true);
      expect(result.projectName).toBe("local-project");
      expect(result.brainstormDir).toBe(join(devsfactoryDir, "brainstorm"));
      expect(result.mode).toBe("local");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("succeeds in global mode with registered project", async () => {
    let ctx: IsolatedGlobalDirContext | undefined;
    try {
      ctx = await createIsolatedGlobalDir("brainstorm-global");
      const testRootDir = join(ctx.globalDir, "..");

      const projectDir = join(testRootDir, "registered-project");
      await mkdir(projectDir, { recursive: true });
      await mkdir(
        join(ctx.globalDir, "brainstorm", "user-registered-project"),
        {
          recursive: true
        }
      );

      await Bun.$`git -C ${projectDir} init`.quiet();

      const projectConfig = {
        name: "user-registered-project",
        path: projectDir,
        gitRemote: null,
        registered: new Date().toISOString()
      };

      await writeFile(
        join(ctx.globalDir, "projects", "user-registered-project.yaml"),
        `name: ${projectConfig.name}\npath: ${projectConfig.path}\ngitRemote: null\nregistered: ${projectConfig.registered}\n`
      );

      const result = await ctx.run(() =>
        runBrainstormCommand("user-registered-project")
      );

      expect(result.success).toBe(true);
      expect(result.projectName).toBe("user-registered-project");
      expect(result.mode).toBe("global");
      expect(result.brainstormDir).toBe(
        join(ctx.globalDir, "brainstorm", "user-registered-project")
      );
    } finally {
      if (ctx) await ctx.cleanup();
    }
  });

  test("creates brainstorm directory if it does not exist", async () => {
    const projectDir = join(TEST_DIR, "new-brainstorm");
    const devsfactoryDir = join(projectDir, ".devsfactory");
    await mkdir(devsfactoryDir, { recursive: true });

    const originalCwd = process.cwd();
    process.chdir(projectDir);

    try {
      const result = await runBrainstormCommand();

      expect(result.success).toBe(true);

      const brainstormDir = join(devsfactoryDir, "brainstorm");
      const dirStat = await stat(brainstormDir);
      expect(dirStat.isDirectory()).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
