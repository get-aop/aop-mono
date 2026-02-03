import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createIsolatedGlobalDir,
  type IsolatedGlobalDirContext
} from "../test-helpers";
import type { SubtaskStatus, TaskStatus } from "../types";
import { registerProject } from "./sqlite/project-store";
import { SQLiteTaskStorage } from "./sqlite/sqlite-task-storage";
import { exportTaskStats, type TaskStats } from "./stats-exporter";

let ctx: IsolatedGlobalDirContext;
const PROJECT_NAME = "stats-exporter-test";

const createProjectInDb = async () => {
  await ctx.run(() =>
    registerProject({
      name: PROJECT_NAME,
      path: "/tmp/stats-exporter-test"
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

describe("exportTaskStats", () => {
  beforeEach(async () => {
    ctx = await createIsolatedGlobalDir("stats-exporter");
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  test("returns complete stats for a finished task with subtasks", async () => {
    await createProjectInDb();
    await createTaskInDb("my-task", {
      title: "Build user dashboard",
      status: "DONE",
      startedAt: new Date("2026-01-27T10:05:00Z"),
      completedAt: new Date("2026-01-27T10:29:29Z"),
      durationMs: 1469000
    });

    await createSubtaskInDb("my-task", "001-create-layout.md", {
      title: "Create dashboard layout",
      status: "DONE",
      durationMs: 363000,
      phases: {
        implementation: 272000,
        review: 85000,
        merge: 6000,
        conflictSolver: null
      }
    });

    await createSubtaskInDb("my-task", "002-add-widgets.md", {
      title: "Add dashboard widgets",
      status: "DONE",
      durationMs: 537000,
      phases: {
        implementation: 400000,
        review: 120000,
        merge: 17000,
        conflictSolver: null
      }
    });

    await createSubtaskInDb("my-task", "003-final-touches.md", {
      title: "Final touches",
      status: "DONE",
      durationMs: 569000,
      phases: {
        implementation: 450000,
        review: 100000,
        merge: 19000,
        conflictSolver: null
      }
    });

    const stats = await ctx.run(() => exportTaskStats("my-task", PROJECT_NAME));

    expect(stats.task).toBe("Build user dashboard");
    expect(stats.taskFolder).toBe("my-task");
    expect(stats.startedAt).toBe("2026-01-27T10:05:00.000Z");
    expect(stats.completedAt).toBe("2026-01-27T10:29:29.000Z");
    expect(stats.durationMs).toBe(1469000);
    expect(stats.subtasks).toHaveLength(3);

    expect(stats.subtasks[0]).toEqual({
      number: 1,
      title: "Create dashboard layout",
      durationMs: 363000,
      phases: {
        implementation: 272000,
        review: 85000,
        merge: 6000,
        conflictSolver: null
      }
    });

    expect(stats.summary.totalSubtasks).toBe(3);
    expect(stats.summary.completedSubtasks).toBe(3);
    expect(stats.summary.averageDurationMs).toBe(489667);
    expect(stats.summary.slowestPhase).toBe("implementation");
    expect(stats.summary.slowestPhasePercent).toBe(76);
  });

  test("throws error when task folder does not exist", async () => {
    await expect(
      ctx.run(() => exportTaskStats("nonexistent-task", PROJECT_NAME))
    ).rejects.toThrow("Task 'nonexistent-task' not found");
  });

  test("handles task with no timing data", async () => {
    await createProjectInDb();
    await createTaskInDb("no-timing", {
      title: "Task without timing",
      status: "PENDING"
    });

    const stats = await ctx.run(() =>
      exportTaskStats("no-timing", PROJECT_NAME)
    );

    expect(stats.task).toBe("Task without timing");
    expect(stats.startedAt).toBeNull();
    expect(stats.completedAt).toBeNull();
    expect(stats.durationMs).toBeNull();
    expect(stats.subtasks).toHaveLength(0);
    expect(stats.summary.totalSubtasks).toBe(0);
    expect(stats.summary.completedSubtasks).toBe(0);
    expect(stats.summary.averageDurationMs).toBe(0);
    expect(stats.summary.slowestPhase).toBeNull();
    expect(stats.summary.slowestPhasePercent).toBeNull();
  });

  test("handles task in progress with partial timing data", async () => {
    await createProjectInDb();
    await createTaskInDb("in-progress-task", {
      title: "Task in progress",
      status: "INPROGRESS",
      startedAt: new Date("2026-01-27T10:05:00Z")
    });

    await createSubtaskInDb("in-progress-task", "001-first-subtask.md", {
      title: "First subtask",
      status: "DONE",
      durationMs: 300000,
      phases: {
        implementation: 250000,
        review: 40000,
        merge: 10000,
        conflictSolver: null
      }
    });

    await createSubtaskInDb("in-progress-task", "002-second-subtask.md", {
      title: "Second subtask",
      status: "INPROGRESS",
      durationMs: null,
      phases: {
        implementation: null,
        review: null,
        merge: null,
        conflictSolver: null
      }
    });

    const stats = await ctx.run(() =>
      exportTaskStats("in-progress-task", PROJECT_NAME)
    );

    expect(stats.task).toBe("Task in progress");
    expect(stats.startedAt).toBe("2026-01-27T10:05:00.000Z");
    expect(stats.completedAt).toBeNull();
    expect(stats.durationMs).toBeNull();
    expect(stats.subtasks).toHaveLength(2);

    expect(stats.subtasks[0]!.durationMs).toBe(300000);
    expect(stats.subtasks[1]!.durationMs).toBeNull();

    expect(stats.summary.totalSubtasks).toBe(2);
    expect(stats.summary.completedSubtasks).toBe(1);
    expect(stats.summary.averageDurationMs).toBe(300000);
  });

  test("produces valid JSON output", async () => {
    await createProjectInDb();
    await createTaskInDb("json-test", {
      title: "JSON validation test",
      status: "DONE",
      startedAt: new Date("2026-01-27T10:00:00Z"),
      completedAt: new Date("2026-01-27T10:05:00Z"),
      durationMs: 300000
    });

    const stats = await ctx.run(() =>
      exportTaskStats("json-test", PROJECT_NAME)
    );
    const jsonString = JSON.stringify(stats);
    const parsed = JSON.parse(jsonString) as TaskStats;

    expect(parsed.task).toBe("JSON validation test");
    expect(parsed.taskFolder).toBe("json-test");
  });

  test("handles subtasks without timing object", async () => {
    await createProjectInDb();
    await createTaskInDb("no-subtask-timing", {
      title: "Task with subtasks but no timing",
      status: "INPROGRESS"
    });

    await createSubtaskInDb("no-subtask-timing", "001-no-timing.md", {
      title: "Subtask without timing",
      status: "PENDING"
    });

    const stats = await ctx.run(() =>
      exportTaskStats("no-subtask-timing", PROJECT_NAME)
    );

    expect(stats.subtasks).toHaveLength(1);
    expect(stats.subtasks[0]!.durationMs).toBeNull();
    expect(stats.subtasks[0]!.phases).toEqual({
      implementation: null,
      review: null,
      merge: null,
      conflictSolver: null
    });
  });
});
