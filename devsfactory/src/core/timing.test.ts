import { describe, expect, test } from "bun:test";
import { formatDuration, detectBottleneck, generateTaskSummary } from "./timing";
import type { PhaseTimings, Task, Subtask } from "../types";

describe("formatDuration", () => {
  test("formats milliseconds under 1 second as '< 1s'", () => {
    expect(formatDuration(0)).toBe("< 1s");
    expect(formatDuration(500)).toBe("< 1s");
    expect(formatDuration(999)).toBe("< 1s");
  });

  test("formats milliseconds under 1 minute as seconds", () => {
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(45000)).toBe("45s");
    expect(formatDuration(59000)).toBe("59s");
  });

  test("formats milliseconds under 1 hour as minutes and seconds", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(272000)).toBe("4m 32s");
    expect(formatDuration(3599000)).toBe("59m 59s");
  });

  test("formats milliseconds 1 hour or more as hours and minutes", () => {
    expect(formatDuration(3600000)).toBe("1h 0m");
    expect(formatDuration(4980000)).toBe("1h 23m");
    expect(formatDuration(7200000)).toBe("2h 0m");
    expect(formatDuration(86400000)).toBe("24h 0m");
  });

  test("handles negative values as '< 1s'", () => {
    expect(formatDuration(-1000)).toBe("< 1s");
    expect(formatDuration(-500)).toBe("< 1s");
  });

  test("handles very large values", () => {
    expect(formatDuration(360000000)).toBe("100h 0m");
  });
});

describe("detectBottleneck", () => {
  test("returns null when all phases are null", () => {
    const phases: PhaseTimings = {
      implementation: null,
      review: null,
      merge: null,
      conflictSolver: null
    };
    expect(detectBottleneck(phases)).toBeNull();
  });

  test("returns null when no phase exceeds threshold", () => {
    const phases: PhaseTimings = {
      implementation: 1000,
      review: 1000,
      merge: 1000,
      conflictSolver: 1000
    };
    expect(detectBottleneck(phases)).toBeNull();
  });

  test("detects bottleneck when a phase exceeds 50% threshold", () => {
    const phases: PhaseTimings = {
      implementation: 6000,
      review: 2000,
      merge: 1000,
      conflictSolver: 1000
    };
    const result = detectBottleneck(phases);
    expect(result).toEqual({ phase: "implementation", percent: 60 });
  });

  test("uses custom threshold", () => {
    const phases: PhaseTimings = {
      implementation: 4000,
      review: 3000,
      merge: 2000,
      conflictSolver: 1000
    };
    expect(detectBottleneck(phases, 0.3)).toEqual({ phase: "implementation", percent: 40 });
    expect(detectBottleneck(phases, 0.5)).toBeNull();
  });

  test("returns the largest bottleneck when multiple exceed threshold", () => {
    const phases: PhaseTimings = {
      implementation: 5000,
      review: 4000,
      merge: 500,
      conflictSolver: 500
    };
    const result = detectBottleneck(phases);
    expect(result).toEqual({ phase: "implementation", percent: 50 });
  });

  test("handles phases with some null values", () => {
    const phases: PhaseTimings = {
      implementation: 8000,
      review: 2000,
      merge: null,
      conflictSolver: null
    };
    const result = detectBottleneck(phases);
    expect(result).toEqual({ phase: "implementation", percent: 80 });
  });
});

describe("generateTaskSummary", () => {
  const createTask = (overrides: Partial<Task> = {}): Task => ({
    folder: "test-task",
    frontmatter: {
      title: "Test Task",
      status: "DONE",
      created: new Date("2026-01-01"),
      priority: "medium",
      tags: [],
      assignee: null,
      dependencies: [],
      startedAt: new Date("2026-01-01T10:00:00Z"),
      completedAt: new Date("2026-01-01T11:00:00Z"),
      durationMs: 3600000
    },
    description: "Test description",
    requirements: "Test requirements",
    acceptanceCriteria: [],
    ...overrides
  });

  const createSubtask = (overrides: Partial<Subtask> = {}): Subtask => ({
    filename: "001-test-subtask.md",
    number: 1,
    slug: "test-subtask",
    frontmatter: {
      title: "Test Subtask",
      status: "DONE",
      dependencies: [],
      timing: {
        startedAt: new Date("2026-01-01T10:00:00Z"),
        completedAt: new Date("2026-01-01T10:30:00Z"),
        durationMs: 1800000,
        phases: {
          implementation: 1200000,
          review: 300000,
          merge: 300000,
          conflictSolver: null
        }
      }
    },
    description: "Test subtask description",
    ...overrides
  });

  test("generates summary for task with subtasks", () => {
    const task = createTask();
    const subtasks = [
      createSubtask(),
      createSubtask({
        filename: "002-another-subtask.md",
        number: 2,
        slug: "another-subtask",
        frontmatter: {
          title: "Another Subtask",
          status: "DONE",
          dependencies: [1],
          timing: {
            startedAt: new Date("2026-01-01T10:30:00Z"),
            completedAt: new Date("2026-01-01T11:00:00Z"),
            durationMs: 1800000,
            phases: {
              implementation: 1000000,
              review: 400000,
              merge: 400000,
              conflictSolver: null
            }
          }
        },
        description: "Another subtask description"
      })
    ];

    const summary = generateTaskSummary(task, subtasks);

    expect(summary.taskTitle).toBe("Test Task");
    expect(summary.totalDurationMs).toBe(3600000);
    expect(summary.subtaskCount).toBe(2);
    expect(summary.averageDurationMs).toBe(1800000);
    expect(summary.subtaskTimings).toHaveLength(2);
    expect(summary.subtaskTimings[0]).toEqual({
      title: "Test Subtask",
      durationMs: 1800000,
      phases: {
        implementation: 1200000,
        review: 300000,
        merge: 300000,
        conflictSolver: null
      }
    });
  });

  test("handles task with no completed subtasks", () => {
    const task = createTask({
      frontmatter: {
        title: "Empty Task",
        status: "INPROGRESS",
        created: new Date("2026-01-01"),
        priority: "medium",
        tags: [],
        assignee: null,
        dependencies: [],
        startedAt: null,
        completedAt: null,
        durationMs: null
      }
    });
    const subtasks: Subtask[] = [];

    const summary = generateTaskSummary(task, subtasks);

    expect(summary.taskTitle).toBe("Empty Task");
    expect(summary.totalDurationMs).toBe(0);
    expect(summary.subtaskCount).toBe(0);
    expect(summary.averageDurationMs).toBe(0);
    expect(summary.subtaskTimings).toHaveLength(0);
    expect(summary.bottleneck).toBeNull();
  });

  test("handles subtasks without timing data", () => {
    const task = createTask();
    const subtasks = [
      createSubtask({
        frontmatter: {
          title: "No Timing Subtask",
          status: "PENDING",
          dependencies: [],
          timing: undefined
        }
      })
    ];

    const summary = generateTaskSummary(task, subtasks);

    expect(summary.subtaskCount).toBe(1);
    expect(summary.subtaskTimings).toHaveLength(1);
    expect(summary.subtaskTimings[0].durationMs).toBe(0);
  });

  test("calculates aggregate bottleneck across subtasks", () => {
    const task = createTask();
    const subtasks = [
      createSubtask({
        frontmatter: {
          title: "Subtask 1",
          status: "DONE",
          dependencies: [],
          timing: {
            startedAt: new Date(),
            completedAt: new Date(),
            durationMs: 10000,
            phases: {
              implementation: 8000,
              review: 1000,
              merge: 1000,
              conflictSolver: null
            }
          }
        }
      }),
      createSubtask({
        number: 2,
        filename: "002-subtask.md",
        frontmatter: {
          title: "Subtask 2",
          status: "DONE",
          dependencies: [],
          timing: {
            startedAt: new Date(),
            completedAt: new Date(),
            durationMs: 10000,
            phases: {
              implementation: 7000,
              review: 2000,
              merge: 1000,
              conflictSolver: null
            }
          }
        }
      })
    ];

    const summary = generateTaskSummary(task, subtasks);

    expect(summary.bottleneck).toEqual({ phase: "implementation", percent: 75 });
  });
});
