import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProject } from "../core/sqlite/project-store";
import { SQLiteTaskStorage } from "../core/sqlite/sqlite-task-storage";
import {
  createIsolatedGlobalDir,
  type IsolatedGlobalDirContext
} from "../test-helpers";
import {
  parseCreateTaskArgs,
  runCreateTaskCommand,
  syncNewTaskToSQLite
} from "./create-task";

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
    let ctx: IsolatedGlobalDirContext | undefined;
    try {
      ctx = await createIsolatedGlobalDir("create-task-raw-mode");
      const projectDir = join(ctx.globalDir, "..", "raw-mode-project");
      await mkdir(projectDir, { recursive: true });
      await Bun.$`git -C ${projectDir} init`.quiet();

      // Register the project in SQLite
      await ctx.run(() =>
        registerProject({
          name: "raw-mode-project",
          path: projectDir,
          gitRemote: null
        })
      );

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
        const result = await ctx.run(() =>
          runCreateTaskCommand({
            description: "Add feature",
            raw: true
          })
        );

        expect(result.success).toBe(true);
      } finally {
        process.chdir(originalCwd);
        Bun.spawn = originalSpawn;
      }
    } finally {
      if (ctx) await ctx.cleanup();
    }
  });
});

describe("syncNewTaskToSQLite", () => {
  test("creates task in SQLite from markdown file", async () => {
    let ctx: IsolatedGlobalDirContext | undefined;
    try {
      ctx = await createIsolatedGlobalDir("sync-new-task");
      const projectDir = join(ctx.globalDir, "..", "sync-test-project");
      const devsfactoryDir = join(ctx.globalDir, "tasks", "sync-test-project");
      await mkdir(projectDir, { recursive: true });
      await mkdir(join(devsfactoryDir, "test-task"), { recursive: true });

      await ctx.run(() =>
        registerProject({
          name: "sync-test-project",
          path: projectDir,
          gitRemote: null
        })
      );

      const taskMd = `---
title: "Test Task"
status: PENDING
created: 2026-02-02
priority: high
tags: [test]
---

## Description

This is a test task.

## Requirements

Some requirements here.

## Acceptance Criteria

- [ ] First criterion
- [ ] Second criterion
`;

      await writeFile(join(devsfactoryDir, "test-task", "task.md"), taskMd);

      await ctx.run(async () => {
        await syncNewTaskToSQLite({
          projectName: "sync-test-project",
          devsfactoryDir,
          taskFolder: "test-task"
        });

        const storage = new SQLiteTaskStorage({
          projectName: "sync-test-project"
        });
        const task = await storage.getTaskWithContent("test-task");

        expect(task).not.toBeNull();
        expect(task!.frontmatter.title).toBe("Test Task");
        expect(task!.frontmatter.status).toBe("PENDING");
        expect(task!.description).toBe("This is a test task.");
        expect(task!.requirements).toBe("Some requirements here.");
        expect(task!.acceptanceCriteria).toEqual([
          "First criterion",
          "Second criterion"
        ]);
      });
    } finally {
      if (ctx) await ctx.cleanup();
    }
  });

  test("creates plan in SQLite from markdown file", async () => {
    let ctx: IsolatedGlobalDirContext | undefined;
    try {
      ctx = await createIsolatedGlobalDir("sync-plan");
      const projectDir = join(ctx.globalDir, "..", "plan-test-project");
      const devsfactoryDir = join(ctx.globalDir, "tasks", "plan-test-project");
      await mkdir(projectDir, { recursive: true });
      await mkdir(join(devsfactoryDir, "test-task"), { recursive: true });

      await ctx.run(() =>
        registerProject({
          name: "plan-test-project",
          path: projectDir,
          gitRemote: null
        })
      );

      const taskMd = `---
title: "Test Task with Plan"
status: PENDING
created: 2026-02-02
priority: medium
tags: []
---

## Description

Task with plan.

## Requirements

None.

## Acceptance Criteria

- [ ] Done
`;

      const planMd = `---
status: INPROGRESS
task: test-task
created: 2026-02-02T10:00:00Z
---

## Subtasks

1. 001-first-subtask (First subtask)
2. 002-second-subtask (Second subtask) → depends on: 1
`;

      await writeFile(join(devsfactoryDir, "test-task", "task.md"), taskMd);
      await writeFile(join(devsfactoryDir, "test-task", "plan.md"), planMd);

      await ctx.run(async () => {
        await syncNewTaskToSQLite({
          projectName: "plan-test-project",
          devsfactoryDir,
          taskFolder: "test-task"
        });

        const storage = new SQLiteTaskStorage({
          projectName: "plan-test-project"
        });
        const plan = await storage.getPlan("test-task");

        expect(plan).not.toBeNull();
        expect(plan!.frontmatter.status).toBe("INPROGRESS");
        expect(plan!.subtasks).toHaveLength(2);
        expect(plan!.subtasks[0]!.slug).toBe("first-subtask");
        expect(plan!.subtasks[1]!.dependencies).toContain(1);
      });
    } finally {
      if (ctx) await ctx.cleanup();
    }
  });

  test("creates subtasks in SQLite from markdown files", async () => {
    let ctx: IsolatedGlobalDirContext | undefined;
    try {
      ctx = await createIsolatedGlobalDir("sync-subtasks");
      const projectDir = join(ctx.globalDir, "..", "subtask-test-project");
      const devsfactoryDir = join(
        ctx.globalDir,
        "tasks",
        "subtask-test-project"
      );
      await mkdir(projectDir, { recursive: true });
      await mkdir(join(devsfactoryDir, "test-task"), { recursive: true });

      await ctx.run(() =>
        registerProject({
          name: "subtask-test-project",
          path: projectDir,
          gitRemote: null
        })
      );

      const taskMd = `---
title: "Test Task with Subtasks"
status: PENDING
created: 2026-02-02
priority: low
tags: []
---

## Description

Task with subtasks.

## Requirements

None.

## Acceptance Criteria

- [ ] Done
`;

      const subtask1Md = `---
title: First Subtask
status: PENDING
dependencies: []
---

### Description

First subtask description.

### Context

Some context here.
`;

      const subtask2Md = `---
title: Second Subtask
status: PENDING
dependencies: [1]
---

### Description

Second subtask description.

### Context

Depends on first.
`;

      await writeFile(join(devsfactoryDir, "test-task", "task.md"), taskMd);
      await writeFile(
        join(devsfactoryDir, "test-task", "001-first-subtask.md"),
        subtask1Md
      );
      await writeFile(
        join(devsfactoryDir, "test-task", "002-second-subtask.md"),
        subtask2Md
      );

      await ctx.run(async () => {
        await syncNewTaskToSQLite({
          projectName: "subtask-test-project",
          devsfactoryDir,
          taskFolder: "test-task"
        });

        const storage = new SQLiteTaskStorage({
          projectName: "subtask-test-project"
        });
        const subtasks = await storage.listSubtasks("test-task");

        expect(subtasks).toHaveLength(2);
        expect(subtasks[0]!.frontmatter.title).toBe("First Subtask");
        expect(subtasks[0]!.description).toBe("First subtask description.");
        expect(subtasks[1]!.frontmatter.title).toBe("Second Subtask");
        expect(subtasks[1]!.frontmatter.dependencies).toContain(1);
      });
    } finally {
      if (ctx) await ctx.cleanup();
    }
  });

  test("does not duplicate task if already exists in SQLite", async () => {
    let ctx: IsolatedGlobalDirContext | undefined;
    try {
      ctx = await createIsolatedGlobalDir("sync-no-dup");
      const projectDir = join(ctx.globalDir, "..", "no-dup-project");
      const devsfactoryDir = join(ctx.globalDir, "tasks", "no-dup-project");
      await mkdir(projectDir, { recursive: true });
      await mkdir(join(devsfactoryDir, "test-task"), { recursive: true });

      await ctx.run(() =>
        registerProject({
          name: "no-dup-project",
          path: projectDir,
          gitRemote: null
        })
      );

      const taskMd = `---
title: "Test Task"
status: PENDING
created: 2026-02-02
priority: high
tags: []
---

## Description

This is a test task.

## Requirements

None.

## Acceptance Criteria

- [ ] Done
`;

      await writeFile(join(devsfactoryDir, "test-task", "task.md"), taskMd);

      await ctx.run(async () => {
        await syncNewTaskToSQLite({
          projectName: "no-dup-project",
          devsfactoryDir,
          taskFolder: "test-task"
        });

        await syncNewTaskToSQLite({
          projectName: "no-dup-project",
          devsfactoryDir,
          taskFolder: "test-task"
        });

        const storage = new SQLiteTaskStorage({
          projectName: "no-dup-project"
        });
        const folders = await storage.listTaskFolders();

        expect(folders).toHaveLength(1);
        expect(folders[0]).toBe("test-task");
      });
    } finally {
      if (ctx) await ctx.cleanup();
    }
  });
});
