import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createIsolatedGlobalDir,
  type IsolatedGlobalDirContext
} from "../test-helpers";
import { parseSysDebugArgs, runSysDebugCommand } from "./sys-debug";

const TEST_DIR = join(tmpdir(), `.test-sys-debug-${Date.now()}`);

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("parseSysDebugArgs", () => {
  test("returns help flag when -h is provided", () => {
    const result = parseSysDebugArgs(["-h"]);
    expect(result.help).toBe(true);
  });

  test("returns help flag when --help is provided", () => {
    const result = parseSysDebugArgs(["--help"]);
    expect(result.help).toBe(true);
  });

  test("returns description as first positional argument", () => {
    const result = parseSysDebugArgs(["Tests failing with timeout"]);
    expect(result.description).toBe("Tests failing with timeout");
    expect(result.error).toBeUndefined();
  });

  test("returns project name when -p is provided", () => {
    const result = parseSysDebugArgs(["Tests failing", "-p", "my-project"]);
    expect(result.description).toBe("Tests failing");
    expect(result.projectName).toBe("my-project");
  });

  test("returns project name when --project is provided", () => {
    const result = parseSysDebugArgs([
      "Tests failing",
      "--project",
      "my-project"
    ]);
    expect(result.description).toBe("Tests failing");
    expect(result.projectName).toBe("my-project");
  });

  test("returns error for unknown options", () => {
    const result = parseSysDebugArgs(["--unknown"]);
    expect(result.error).toBe("Unknown option: --unknown");
  });

  test("returns error when -p is provided without value", () => {
    const result = parseSysDebugArgs(["Bug description", "-p"]);
    expect(result.error).toBe("--project requires a value");
  });

  test("returns error when --project is provided without value", () => {
    const result = parseSysDebugArgs(["Bug description", "--project"]);
    expect(result.error).toBe("--project requires a value");
  });

  test("returns undefined description when no arguments provided", () => {
    const result = parseSysDebugArgs([]);
    expect(result.description).toBeUndefined();
  });
});

describe("runSysDebugCommand", () => {
  test("returns error when description is not provided", async () => {
    const result = await runSysDebugCommand({});

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing bug/issue description");
  });

  test("returns error when not in project context and no project specified", async () => {
    let ctx: IsolatedGlobalDirContext | undefined;
    try {
      ctx = await createIsolatedGlobalDir("sys-debug-no-ctx");
      const nonProjectDir = join(ctx.globalDir, "..", "non-project");
      await mkdir(nonProjectDir, { recursive: true });

      const originalCwd = process.cwd();
      process.chdir(nonProjectDir);

      try {
        const result = await ctx.run(() =>
          runSysDebugCommand({ description: "Tests failing" })
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain("Not in a project context");
      } finally {
        process.chdir(originalCwd);
      }
    } finally {
      if (ctx) await ctx.cleanup();
    }
  });

  test("returns error when named project does not exist", async () => {
    let ctx: IsolatedGlobalDirContext | undefined;
    try {
      ctx = await createIsolatedGlobalDir("sys-debug-not-found");

      const result = await ctx.run(() =>
        runSysDebugCommand({
          description: "Tests failing",
          projectName: "nonexistent-project"
        })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Project 'nonexistent-project' not found");
    } finally {
      if (ctx) await ctx.cleanup();
    }
  });
});
