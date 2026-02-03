import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDatabase } from "../core/sqlite/database";
import { registerProject } from "../core/sqlite/project-store";
import {
  createIsolatedGlobalDir,
  type IsolatedGlobalDirContext
} from "../test-helpers";
import { parseMigrateArgs, runMigrateCommand } from "./migrate";

describe("parseMigrateArgs", () => {
  test("returns default options when no arguments", () => {
    const result = parseMigrateArgs([]);
    expect(result.dryRun).toBe(false);
    expect(result.removeFiles).toBe(false);
    expect(result.help).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  test("parses --dry-run flag", () => {
    const result = parseMigrateArgs(["--dry-run"]);
    expect(result.dryRun).toBe(true);
    expect(result.removeFiles).toBe(false);
  });

  test("parses --remove-files flag", () => {
    const result = parseMigrateArgs(["--remove-files"]);
    expect(result.dryRun).toBe(false);
    expect(result.removeFiles).toBe(true);
  });

  test("parses both flags together", () => {
    const result = parseMigrateArgs(["--dry-run", "--remove-files"]);
    expect(result.dryRun).toBe(true);
    expect(result.removeFiles).toBe(true);
  });

  test("returns help when -h provided", () => {
    const result = parseMigrateArgs(["-h"]);
    expect(result.help).toBe(true);
  });

  test("returns help when --help provided", () => {
    const result = parseMigrateArgs(["--help"]);
    expect(result.help).toBe(true);
  });

  test("returns error for unknown options", () => {
    const result = parseMigrateArgs(["--unknown"]);
    expect(result.error).toBe("Unknown option: --unknown");
  });
});

describe("runMigrateCommand", () => {
  let ctx: IsolatedGlobalDirContext | undefined;

  afterEach(async () => {
    if (ctx) {
      await ctx.cleanup();
      ctx = undefined;
    }
  });

  const createTaskMarkdown = (opts: {
    title: string;
    status: string;
    priority?: string;
    description?: string;
  }): string => `---
title: "${opts.title}"
status: ${opts.status}
created: 2026-01-01
priority: ${opts.priority ?? "medium"}
tags: []
---

## Description
${opts.description ?? "Test description"}

## Requirements
Test requirements

## Acceptance Criteria
- [ ] First criterion
- [x] Second criterion
`;

  const createSubtaskMarkdown = (opts: {
    title: string;
    status: string;
    dependencies?: number[];
  }): string => `---
title: "${opts.title}"
status: ${opts.status}
dependencies: [${(opts.dependencies ?? []).join(", ")}]
---

### Description
Subtask description

### Context
Subtask context
`;

  const createPlanMarkdown = (opts: {
    taskFolder: string;
    status?: string;
  }): string => `---
status: ${opts.status ?? "INPROGRESS"}
task: ${opts.taskFolder}
created: 2026-01-01T00:00:00Z
---

## Subtasks
1. 001-first-subtask (First subtask)
2. 002-second-subtask (Second subtask) → depends on: 1
`;

  test("returns success when no files to migrate", async () => {
    ctx = await createIsolatedGlobalDir("migrate-empty");

    const result = await ctx.run(() =>
      runMigrateCommand({ dryRun: false, removeFiles: false })
    );

    expect(result.success).toBe(true);
    expect(result.summary?.tasksImported).toBe(0);
    expect(result.summary?.subtasksImported).toBe(0);
    expect(result.summary?.plansImported).toBe(0);
  });

  test("migrates task.md files to SQLite", async () => {
    ctx = await createIsolatedGlobalDir("migrate-tasks");

    const result = await ctx.run(async () => {
      const db = getDatabase();
      registerProject({ name: "test-project", path: "/tmp/test-project" });

      const tasksDir = join(ctx!.globalDir, "tasks", "test-project", "my-task");
      await mkdir(tasksDir, { recursive: true });
      await writeFile(
        join(tasksDir, "task.md"),
        createTaskMarkdown({
          title: "My Task",
          status: "PENDING",
          description: "My description"
        })
      );

      const migrateResult = await runMigrateCommand({
        dryRun: false,
        removeFiles: false
      });

      const task = db.queryOne<{ title: string; description: string }>(
        "SELECT title, description FROM tasks WHERE project_name = ? AND folder = ?",
        ["test-project", "my-task"]
      );

      return { migrateResult, task };
    });

    expect(result.migrateResult.success).toBe(true);
    expect(result.migrateResult.summary?.tasksImported).toBe(1);
    expect(result.task).toBeTruthy();
    expect(result.task?.title).toBe("My Task");
    expect(result.task?.description).toBe("My description");
  });

  test("migrates subtask files to SQLite", async () => {
    ctx = await createIsolatedGlobalDir("migrate-subtasks");

    const result = await ctx.run(async () => {
      const db = getDatabase();
      registerProject({ name: "test-project", path: "/tmp/test-project" });

      const tasksDir = join(ctx!.globalDir, "tasks", "test-project", "my-task");
      await mkdir(tasksDir, { recursive: true });
      await writeFile(
        join(tasksDir, "task.md"),
        createTaskMarkdown({ title: "My Task", status: "PENDING" })
      );
      await writeFile(
        join(tasksDir, "001-first-subtask.md"),
        createSubtaskMarkdown({ title: "First Subtask", status: "PENDING" })
      );
      await writeFile(
        join(tasksDir, "002-second-subtask.md"),
        createSubtaskMarkdown({
          title: "Second Subtask",
          status: "PENDING",
          dependencies: [1]
        })
      );

      const migrateResult = await runMigrateCommand({
        dryRun: false,
        removeFiles: false
      });

      const subtasks = db.query<{ title: string; number: number }>(
        "SELECT title, number FROM subtasks WHERE project_name = ? AND task_folder = ? ORDER BY number",
        ["test-project", "my-task"]
      );

      return { migrateResult, subtasks };
    });

    expect(result.migrateResult.success).toBe(true);
    expect(result.migrateResult.summary?.subtasksImported).toBe(2);
    expect(result.subtasks).toHaveLength(2);
    expect(result.subtasks[0]?.title).toBe("First Subtask");
    expect(result.subtasks[1]?.title).toBe("Second Subtask");
  });

  test("migrates plan.md files to SQLite", async () => {
    ctx = await createIsolatedGlobalDir("migrate-plans");

    const result = await ctx.run(async () => {
      const db = getDatabase();
      registerProject({ name: "test-project", path: "/tmp/test-project" });

      const tasksDir = join(ctx!.globalDir, "tasks", "test-project", "my-task");
      await mkdir(tasksDir, { recursive: true });
      await writeFile(
        join(tasksDir, "task.md"),
        createTaskMarkdown({ title: "My Task", status: "INPROGRESS" })
      );
      await writeFile(
        join(tasksDir, "plan.md"),
        createPlanMarkdown({ taskFolder: "my-task" })
      );

      const migrateResult = await runMigrateCommand({
        dryRun: false,
        removeFiles: false
      });

      const plan = db.queryOne<{ status: string; task_folder: string }>(
        "SELECT status, task_folder FROM plans WHERE project_name = ? AND task_folder = ?",
        ["test-project", "my-task"]
      );

      return { migrateResult, plan };
    });

    expect(result.migrateResult.success).toBe(true);
    expect(result.migrateResult.summary?.plansImported).toBe(1);
    expect(result.plan).toBeTruthy();
    expect(result.plan?.status).toBe("INPROGRESS");
  });

  test("skips tasks already in SQLite", async () => {
    ctx = await createIsolatedGlobalDir("migrate-skip-existing");

    const result = await ctx.run(async () => {
      const db = getDatabase();
      registerProject({ name: "test-project", path: "/tmp/test-project" });

      db.run(
        `INSERT INTO tasks (project_name, folder, title, status, priority, created_at, description, requirements, acceptance_criteria)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "test-project",
          "my-task",
          "Existing Task",
          "PENDING",
          "medium",
          "2026-01-01",
          "Existing description",
          "",
          "[]"
        ]
      );

      const tasksDir = join(ctx!.globalDir, "tasks", "test-project", "my-task");
      await mkdir(tasksDir, { recursive: true });
      await writeFile(
        join(tasksDir, "task.md"),
        createTaskMarkdown({ title: "New Task Title", status: "INPROGRESS" })
      );

      const migrateResult = await runMigrateCommand({
        dryRun: false,
        removeFiles: false
      });

      const task = db.queryOne<{ title: string }>(
        "SELECT title FROM tasks WHERE project_name = ? AND folder = ?",
        ["test-project", "my-task"]
      );

      return { migrateResult, task };
    });

    expect(result.migrateResult.success).toBe(true);
    expect(result.migrateResult.summary?.tasksImported).toBe(0);
    expect(result.migrateResult.summary?.skipped).toBe(1);
    expect(result.task?.title).toBe("Existing Task");
  });

  test("dry-run shows what would be migrated without changes", async () => {
    ctx = await createIsolatedGlobalDir("migrate-dry-run");

    const result = await ctx.run(async () => {
      const db = getDatabase();
      registerProject({ name: "test-project", path: "/tmp/test-project" });

      const tasksDir = join(ctx!.globalDir, "tasks", "test-project", "my-task");
      await mkdir(tasksDir, { recursive: true });
      await writeFile(
        join(tasksDir, "task.md"),
        createTaskMarkdown({ title: "My Task", status: "PENDING" })
      );

      const migrateResult = await runMigrateCommand({
        dryRun: true,
        removeFiles: false
      });

      const task = db.queryOne<{ title: string }>(
        "SELECT title FROM tasks WHERE project_name = ? AND folder = ?",
        ["test-project", "my-task"]
      );

      return { migrateResult, task };
    });

    expect(result.migrateResult.success).toBe(true);
    expect(result.migrateResult.summary?.tasksImported).toBe(1);
    expect(result.task).toBeNull();
  });

  test("removes files when --remove-files is set", async () => {
    ctx = await createIsolatedGlobalDir("migrate-remove");

    const result = await ctx.run(async () => {
      registerProject({ name: "test-project", path: "/tmp/test-project" });

      const tasksDir = join(ctx!.globalDir, "tasks", "test-project", "my-task");
      await mkdir(tasksDir, { recursive: true });
      const taskFile = join(tasksDir, "task.md");
      await writeFile(
        taskFile,
        createTaskMarkdown({ title: "My Task", status: "PENDING" })
      );

      const migrateResult = await runMigrateCommand({
        dryRun: false,
        removeFiles: true
      });

      const fileExists = await Bun.file(taskFile).exists();

      return { migrateResult, fileExists };
    });

    expect(result.migrateResult.success).toBe(true);
    expect(result.fileExists).toBe(false);
  });

  test("migrates multiple projects", async () => {
    ctx = await createIsolatedGlobalDir("migrate-multi-project");

    const result = await ctx.run(async () => {
      const db = getDatabase();
      registerProject({ name: "project-a", path: "/tmp/project-a" });
      registerProject({ name: "project-b", path: "/tmp/project-b" });

      const tasksDirA = join(ctx!.globalDir, "tasks", "project-a", "task-a");
      const tasksDirB = join(ctx!.globalDir, "tasks", "project-b", "task-b");
      await mkdir(tasksDirA, { recursive: true });
      await mkdir(tasksDirB, { recursive: true });

      await writeFile(
        join(tasksDirA, "task.md"),
        createTaskMarkdown({ title: "Task A", status: "PENDING" })
      );
      await writeFile(
        join(tasksDirB, "task.md"),
        createTaskMarkdown({ title: "Task B", status: "DONE" })
      );

      const migrateResult = await runMigrateCommand({
        dryRun: false,
        removeFiles: false
      });

      const tasks = db.query<{ project_name: string; title: string }>(
        "SELECT project_name, title FROM tasks ORDER BY project_name"
      );

      return { migrateResult, tasks };
    });

    expect(result.migrateResult.success).toBe(true);
    expect(result.migrateResult.summary?.tasksImported).toBe(2);
    expect(result.tasks).toHaveLength(2);
  });

  test("handles parsing errors gracefully and continues", async () => {
    ctx = await createIsolatedGlobalDir("migrate-errors");

    const result = await ctx.run(async () => {
      const db = getDatabase();
      registerProject({ name: "test-project", path: "/tmp/test-project" });

      const tasksDir1 = join(
        ctx!.globalDir,
        "tasks",
        "test-project",
        "good-task"
      );
      const tasksDir2 = join(
        ctx!.globalDir,
        "tasks",
        "test-project",
        "bad-task"
      );
      await mkdir(tasksDir1, { recursive: true });
      await mkdir(tasksDir2, { recursive: true });

      await writeFile(
        join(tasksDir1, "task.md"),
        createTaskMarkdown({ title: "Good Task", status: "PENDING" })
      );
      await writeFile(
        join(tasksDir2, "task.md"),
        "invalid yaml content\n---\nno frontmatter"
      );

      const migrateResult = await runMigrateCommand({
        dryRun: false,
        removeFiles: false
      });

      const tasks = db.query<{ title: string }>(
        "SELECT title FROM tasks WHERE project_name = ?",
        ["test-project"]
      );

      return { migrateResult, tasks };
    });

    expect(result.migrateResult.success).toBe(true);
    expect(result.migrateResult.summary?.tasksImported).toBe(1);
    expect(result.migrateResult.summary?.errors).toBe(1);
    expect(result.migrateResult.failedFiles).toHaveLength(1);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.title).toBe("Good Task");
  });

  test("returns non-zero exit code hint when there are failures", async () => {
    ctx = await createIsolatedGlobalDir("migrate-exit-code");

    const result = await ctx.run(async () => {
      registerProject({ name: "test-project", path: "/tmp/test-project" });

      const tasksDir = join(
        ctx!.globalDir,
        "tasks",
        "test-project",
        "bad-task"
      );
      await mkdir(tasksDir, { recursive: true });
      await writeFile(join(tasksDir, "task.md"), "completely invalid");

      return runMigrateCommand({ dryRun: false, removeFiles: false });
    });

    expect(result.success).toBe(true);
    expect(result.hasErrors).toBe(true);
  });
});
