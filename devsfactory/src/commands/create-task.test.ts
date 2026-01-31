import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createIsolatedGlobalDir,
  type IsolatedGlobalDirContext
} from "../test-helpers";
import { parseCreateTaskArgs, runCreateTaskCommand } from "./create-task";

const TEST_DIR = join(tmpdir(), `.test-create-task-${Date.now()}`);

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("parseCreateTaskArgs", () => {
  test("returns help flag when -h is provided", () => {
    const result = parseCreateTaskArgs(["-h"]);
    expect(result.help).toBe(true);
  });

  test("returns help flag when --help is provided", () => {
    const result = parseCreateTaskArgs(["--help"]);
    expect(result.help).toBe(true);
  });

  test("returns description as first positional argument", () => {
    const result = parseCreateTaskArgs(["Add user authentication"]);
    expect(result.description).toBe("Add user authentication");
    expect(result.error).toBeUndefined();
  });

  test("returns project name when -p is provided", () => {
    const result = parseCreateTaskArgs(["Add auth", "-p", "my-project"]);
    expect(result.description).toBe("Add auth");
    expect(result.projectName).toBe("my-project");
  });

  test("returns project name when --project is provided", () => {
    const result = parseCreateTaskArgs(["Add auth", "--project", "my-project"]);
    expect(result.description).toBe("Add auth");
    expect(result.projectName).toBe("my-project");
  });

  test("returns slug when -s is provided", () => {
    const result = parseCreateTaskArgs(["Add auth", "-s", "add-auth"]);
    expect(result.description).toBe("Add auth");
    expect(result.slug).toBe("add-auth");
  });

  test("returns slug when --slug is provided", () => {
    const result = parseCreateTaskArgs(["Add auth", "--slug", "add-auth"]);
    expect(result.description).toBe("Add auth");
    expect(result.slug).toBe("add-auth");
  });

  test("returns debug flag when -d is provided", () => {
    const result = parseCreateTaskArgs(["Add auth", "-d"]);
    expect(result.description).toBe("Add auth");
    expect(result.debug).toBe(true);
  });

  test("returns debug flag when --debug is provided", () => {
    const result = parseCreateTaskArgs(["Add auth", "--debug"]);
    expect(result.description).toBe("Add auth");
    expect(result.debug).toBe(true);
  });

  test("returns raw flag when -r is provided", () => {
    const result = parseCreateTaskArgs(["Add auth", "-r"]);
    expect(result.description).toBe("Add auth");
    expect(result.raw).toBe(true);
  });

  test("returns raw flag when --raw is provided", () => {
    const result = parseCreateTaskArgs(["Add auth", "--raw"]);
    expect(result.description).toBe("Add auth");
    expect(result.raw).toBe(true);
  });

  test("returns all options when provided together", () => {
    const result = parseCreateTaskArgs([
      "Add user authentication with JWT",
      "-p",
      "my-project",
      "-s",
      "add-auth",
      "-d"
    ]);
    expect(result.description).toBe("Add user authentication with JWT");
    expect(result.projectName).toBe("my-project");
    expect(result.slug).toBe("add-auth");
    expect(result.debug).toBe(true);
  });

  test("returns error for unknown options", () => {
    const result = parseCreateTaskArgs(["--unknown"]);
    expect(result.error).toBe("Unknown option: --unknown");
  });

  test("returns error when -p is provided without value", () => {
    const result = parseCreateTaskArgs(["Add auth", "-p"]);
    expect(result.error).toBe("--project requires a value");
  });

  test("returns error when --project is provided without value", () => {
    const result = parseCreateTaskArgs(["Add auth", "--project"]);
    expect(result.error).toBe("--project requires a value");
  });

  test("returns error when -s is provided without value", () => {
    const result = parseCreateTaskArgs(["Add auth", "-s"]);
    expect(result.error).toBe("--slug requires a value");
  });

  test("returns error when --slug is provided without value", () => {
    const result = parseCreateTaskArgs(["Add auth", "--slug"]);
    expect(result.error).toBe("--slug requires a value");
  });

  test("returns undefined description when no arguments provided", () => {
    const result = parseCreateTaskArgs([]);
    expect(result.description).toBeUndefined();
  });
});

describe("runCreateTaskCommand", () => {
  test("returns error when not in project context and no project specified", async () => {
    let ctx: IsolatedGlobalDirContext | undefined;
    try {
      ctx = await createIsolatedGlobalDir("create-task-no-ctx");
      const nonProjectDir = join(ctx.globalDir, "..", "non-project");
      await mkdir(nonProjectDir, { recursive: true });

      const originalCwd = process.cwd();
      process.chdir(nonProjectDir);

      try {
        const result = await ctx.run(() =>
          runCreateTaskCommand({ description: "Add something" })
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
      ctx = await createIsolatedGlobalDir("create-task-not-found");

      const result = await ctx.run(() =>
        runCreateTaskCommand({
          description: "Add something",
          projectName: "nonexistent-project"
        })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Project 'nonexistent-project' not found");
    } finally {
      if (ctx) await ctx.cleanup();
    }
  });

  test("runs in raw mode when -r flag is provided", async () => {
    const projectDir = join(TEST_DIR, "raw-mode-project");
    const devsfactoryDir = join(projectDir, ".devsfactory");
    await mkdir(devsfactoryDir, { recursive: true });
    await Bun.$`git -C ${projectDir} init`.quiet();

    const originalCwd = process.cwd();
    process.chdir(projectDir);

    // Mock Bun.spawn for raw mode
    const originalSpawn = Bun.spawn;
    const mockStdout = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            '{"type":"result","subtype":"success","total_cost_usd":0.01}\n'
          )
        );
        controller.close();
      }
    });
    const mockStderr = new ReadableStream({
      start(controller) {
        controller.close();
      }
    });

    Bun.spawn = mock(() => ({
      stdout: mockStdout,
      stderr: mockStderr,
      stdin: process.stdin,
      exited: Promise.resolve(0),
      exitCode: 0,
      pid: 12345
    })) as unknown as typeof Bun.spawn;

    try {
      const result = await runCreateTaskCommand({
        description: "Add feature",
        raw: true
      });

      expect(result.success).toBe(true);
    } finally {
      process.chdir(originalCwd);
      Bun.spawn = originalSpawn;
    }
  });
});
