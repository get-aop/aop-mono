import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exportTaskStats, type TaskStats } from "./stats-exporter";

const TEST_DIR = "/tmp/stats-exporter-test";
const DEVSFACTORY_DIR = join(TEST_DIR, ".devsfactory");

const createTaskFile = async (
  taskFolder: string,
  frontmatter: Record<string, unknown>,
  body = "## Description\nTest task\n\n## Requirements\nNone\n\n## Acceptance Criteria\n- [ ] Done"
) => {
  const dirPath = join(DEVSFACTORY_DIR, taskFolder);
  await mkdir(dirPath, { recursive: true });
  const yaml = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  await writeFile(join(dirPath, "task.md"), `---\n${yaml}\n---\n${body}`);
};

const createSubtaskFile = async (
  taskFolder: string,
  filename: string,
  frontmatter: Record<string, unknown>,
  body = "### Description\nTest subtask"
) => {
  const dirPath = join(DEVSFACTORY_DIR, taskFolder);
  await mkdir(dirPath, { recursive: true });
  const yaml = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        return `${k}:${formatYamlValue(v, 2)}`;
      }
      return `${k}: ${formatYamlValue(v, 2)}`;
    })
    .join("\n");
  await writeFile(join(dirPath, filename), `---\n${yaml}\n---\n${body}`);
};

const formatYamlValue = (value: unknown, indent: number): string => {
  const spaces = " ".repeat(indent);
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((v) => `\n${spaces}- ${formatYamlValue(v, indent + 2)}`)
      .join("");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries
      .map(([k, v]) => {
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          return `\n${spaces}${k}:${formatYamlValue(v, indent + 2)}`;
        }
        return `\n${spaces}${k}: ${formatYamlValue(v, indent + 2)}`;
      })
      .join("");
  }
  return String(value);
};

describe("exportTaskStats", () => {
  beforeEach(async () => {
    await mkdir(DEVSFACTORY_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("returns complete stats for a finished task with subtasks", async () => {
    await createTaskFile("my-task", {
      title: "Build user dashboard",
      status: "DONE",
      created: "2026-01-27T10:00:00Z",
      priority: "medium",
      startedAt: "2026-01-27T10:05:00Z",
      completedAt: "2026-01-27T10:29:29Z",
      durationMs: 1469000
    });

    await createSubtaskFile("my-task", "001-create-layout.md", {
      title: "Create dashboard layout",
      status: "DONE",
      dependencies: [],
      timing: {
        startedAt: "2026-01-27T10:05:00Z",
        completedAt: "2026-01-27T10:11:03Z",
        durationMs: 363000,
        phases: {
          implementation: 272000,
          review: 85000,
          merge: 6000,
          conflictSolver: null
        }
      }
    });

    await createSubtaskFile("my-task", "002-add-widgets.md", {
      title: "Add dashboard widgets",
      status: "DONE",
      dependencies: [1],
      timing: {
        startedAt: "2026-01-27T10:11:03Z",
        completedAt: "2026-01-27T10:20:00Z",
        durationMs: 537000,
        phases: {
          implementation: 400000,
          review: 120000,
          merge: 17000,
          conflictSolver: null
        }
      }
    });

    await createSubtaskFile("my-task", "003-final-touches.md", {
      title: "Final touches",
      status: "DONE",
      dependencies: [2],
      timing: {
        startedAt: "2026-01-27T10:20:00Z",
        completedAt: "2026-01-27T10:29:29Z",
        durationMs: 569000,
        phases: {
          implementation: 450000,
          review: 100000,
          merge: 19000,
          conflictSolver: null
        }
      }
    });

    const stats = await exportTaskStats("my-task", DEVSFACTORY_DIR);

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
      exportTaskStats("nonexistent-task", DEVSFACTORY_DIR)
    ).rejects.toThrow("Task file not found");
  });

  test("handles task with no timing data", async () => {
    await createTaskFile("no-timing", {
      title: "Task without timing",
      status: "PENDING",
      created: "2026-01-27T10:00:00Z",
      priority: "medium"
    });

    const stats = await exportTaskStats("no-timing", DEVSFACTORY_DIR);

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
    await createTaskFile("in-progress-task", {
      title: "Task in progress",
      status: "INPROGRESS",
      created: "2026-01-27T10:00:00Z",
      priority: "medium",
      startedAt: "2026-01-27T10:05:00Z"
    });

    await createSubtaskFile("in-progress-task", "001-first-subtask.md", {
      title: "First subtask",
      status: "DONE",
      dependencies: [],
      timing: {
        startedAt: "2026-01-27T10:05:00Z",
        completedAt: "2026-01-27T10:10:00Z",
        durationMs: 300000,
        phases: {
          implementation: 250000,
          review: 40000,
          merge: 10000,
          conflictSolver: null
        }
      }
    });

    await createSubtaskFile("in-progress-task", "002-second-subtask.md", {
      title: "Second subtask",
      status: "INPROGRESS",
      dependencies: [1],
      timing: {
        startedAt: "2026-01-27T10:10:00Z",
        completedAt: null,
        durationMs: null,
        phases: {
          implementation: null,
          review: null,
          merge: null,
          conflictSolver: null
        }
      }
    });

    const stats = await exportTaskStats("in-progress-task", DEVSFACTORY_DIR);

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
    await createTaskFile("json-test", {
      title: "JSON validation test",
      status: "DONE",
      created: "2026-01-27T10:00:00Z",
      priority: "medium",
      startedAt: "2026-01-27T10:00:00Z",
      completedAt: "2026-01-27T10:05:00Z",
      durationMs: 300000
    });

    const stats = await exportTaskStats("json-test", DEVSFACTORY_DIR);
    const jsonString = JSON.stringify(stats);
    const parsed = JSON.parse(jsonString) as TaskStats;

    expect(parsed.task).toBe("JSON validation test");
    expect(parsed.taskFolder).toBe("json-test");
  });

  test("handles subtasks without timing object", async () => {
    await createTaskFile("no-subtask-timing", {
      title: "Task with subtasks but no timing",
      status: "INPROGRESS",
      created: "2026-01-27T10:00:00Z",
      priority: "medium"
    });

    await createSubtaskFile("no-subtask-timing", "001-no-timing.md", {
      title: "Subtask without timing",
      status: "PENDING",
      dependencies: []
    });

    const stats = await exportTaskStats("no-subtask-timing", DEVSFACTORY_DIR);

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
