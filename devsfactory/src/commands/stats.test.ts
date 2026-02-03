import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { registerProject } from "../core/sqlite/project-store";
import { SQLiteTaskStorage } from "../core/sqlite/sqlite-task-storage";
import {
  createIsolatedGlobalDir,
  type IsolatedGlobalDirContext
} from "../test-helpers";
import type { SubtaskStatus, TaskStatus } from "../types";
import { parseStatsArgs, runStatsCommand } from "./stats";

let ctx: IsolatedGlobalDirContext;
const PROJECT_NAME = "stats-test-project";

const createProjectInDb = async () => {
  await ctx.run(() =>
    registerProject({
      name: PROJECT_NAME,
      path: "/tmp/stats-test-project"
    })
  );
};

const createTaskInDb = async (
  taskFolder: string,
  data: {
    title: string;
    status: TaskStatus;
    priority?: "high" | "medium" | "low";
    startedAt?: Date | null;
    completedAt?: Date | null;
    durationMs?: number | null;
  }
) => {
  await ctx.run(async () => {
    const storage = new SQLiteTaskStorage({ projectName: PROJECT_NAME });
    await storage.createTaskWithContent({
      folder: taskFolder,
      frontmatter: {
        title: data.title,
        status: data.status,
        created: new Date("2026-01-27T10:00:00Z"),
        priority: data.priority ?? "medium",
        tags: [],
        assignee: null,
        dependencies: [],
        startedAt: data.startedAt ?? null,
        completedAt: data.completedAt ?? null,
        durationMs: data.durationMs ?? null
      },
      description: "Test task",
      requirements: "None",
      acceptanceCriteria: ["Done"],
      notes: undefined
    });
  });
};

const createSubtaskInDb = async (
  taskFolder: string,
  filename: string,
  data: {
    title: string;
    status: SubtaskStatus;
    durationMs?: number | null;
    phases?: {
      implementation?: number | null;
      review?: number | null;
      merge?: number | null;
      conflictSolver?: number | null;
    };
  }
) => {
  await ctx.run(async () => {
    const storage = new SQLiteTaskStorage({ projectName: PROJECT_NAME });
    await storage.createSubtaskWithContent(taskFolder, {
      filename,
      frontmatter: {
        title: data.title,
        status: data.status,
        dependencies: []
      },
      objective: "Test subtask",
      acceptanceCriteria: undefined,
      tasksChecklist: undefined,
      result: undefined
    });

    if (data.durationMs !== undefined || data.phases) {
      await storage.updateSubtaskTiming(taskFolder, filename, {
        durationMs: data.durationMs ?? undefined,
        phases: data.phases
      });
    }
  });
};

describe("parseStatsArgs", () => {
  test("parses task folder from args", () => {
    const result = parseStatsArgs(["my-task"]);
    expect(result.taskFolder).toBe("my-task");
    expect(result.format).toBe("json");
    expect(result.error).toBeUndefined();
  });

  test("parses --format json option", () => {
    const result = parseStatsArgs(["my-task", "--format", "json"]);
    expect(result.taskFolder).toBe("my-task");
    expect(result.format).toBe("json");
    expect(result.error).toBeUndefined();
  });

  test("returns error when task folder is missing", () => {
    const result = parseStatsArgs([]);
    expect(result.error).toBe("Missing task folder argument");
  });

  test("returns error for unknown format", () => {
    const result = parseStatsArgs(["my-task", "--format", "xml"]);
    expect(result.error).toBe("Unknown format: xml");
  });

  test("returns error for unknown option", () => {
    const result = parseStatsArgs(["my-task", "--unknown"]);
    expect(result.error).toBe("Unknown option: --unknown");
  });
});

describe("runStatsCommand", () => {
  beforeEach(async () => {
    ctx = await createIsolatedGlobalDir("stats-cmd");
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  test("outputs valid JSON for a task", async () => {
    await createProjectInDb();
    await createTaskInDb("my-task", {
      title: "Build dashboard",
      status: "DONE",
      startedAt: new Date("2026-01-27T10:05:00Z"),
      completedAt: new Date("2026-01-27T10:15:00Z"),
      durationMs: 600000
    });

    await createSubtaskInDb("my-task", "001-first.md", {
      title: "First subtask",
      status: "DONE",
      durationMs: 600000,
      phases: {
        implementation: 500000,
        review: 80000,
        merge: 20000,
        conflictSolver: null
      }
    });

    const result = await ctx.run(() =>
      runStatsCommand("my-task", PROJECT_NAME)
    );

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();

    const parsed = JSON.parse(result.output!);
    expect(parsed.task).toBe("Build dashboard");
    expect(parsed.taskFolder).toBe("my-task");
    expect(parsed.durationMs).toBe(600000);
    expect(parsed.subtasks).toHaveLength(1);
    expect(parsed.summary.totalSubtasks).toBe(1);
  });

  test("returns error for non-existent task", async () => {
    const result = await ctx.run(() =>
      runStatsCommand("nonexistent", PROJECT_NAME)
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Task 'nonexistent' not found");
  });

  test("outputs pretty-printed JSON", async () => {
    await createProjectInDb();
    await createTaskInDb("pretty-task", {
      title: "Pretty task",
      status: "PENDING",
      priority: "low"
    });

    const result = await ctx.run(() =>
      runStatsCommand("pretty-task", PROJECT_NAME)
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("\n");
    expect(result.output).toContain('  "task"');
  });
});
