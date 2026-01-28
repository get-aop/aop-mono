import { describe, expect, test } from "bun:test";
import { renderSummaryTable } from "./summary-table";
import type { TaskSummary } from "./timing";

describe("renderSummaryTable", () => {
  const createSummary = (
    overrides: Partial<TaskSummary> = {}
  ): TaskSummary => ({
    taskTitle: "Build user dashboard",
    totalDurationMs: 1469000,
    subtaskCount: 3,
    averageDurationMs: 489667,
    subtaskTimings: [
      {
        title: "Create dashboard layout",
        durationMs: 363000,
        phases: {
          implementation: 272000,
          review: 85000,
          merge: 6000,
          conflictSolver: null
        }
      },
      {
        title: "Add chart components",
        durationMs: 641000,
        phases: {
          implementation: 495000,
          review: 130000,
          merge: 16000,
          conflictSolver: null
        }
      },
      {
        title: "Implement data fetching",
        durationMs: 465000,
        phases: {
          implementation: 348000,
          review: 93000,
          merge: 24000,
          conflictSolver: null
        }
      }
    ],
    bottleneck: { phase: "implementation", percent: 76 },
    ...overrides
  });

  test("renders table with header containing task title", () => {
    const summary = createSummary();
    const output = renderSummaryTable(summary);

    expect(output).toContain("Task completed: Build user dashboard");
  });

  test("renders column headers", () => {
    const summary = createSummary();
    const output = renderSummaryTable(summary);

    expect(output).toContain("Subtask");
    expect(output).toContain("Impl");
    expect(output).toContain("Review");
    expect(output).toContain("Total");
  });

  test("renders subtask rows with timing data", () => {
    const summary = createSummary();
    const output = renderSummaryTable(summary);

    expect(output).toContain("1. Create dashboard layout");
    expect(output).toContain("4m 32s");
    expect(output).toContain("1m 25s");
    expect(output).toContain("6m 3s");
  });

  test("renders summary footer with total count and duration", () => {
    const summary = createSummary();
    const output = renderSummaryTable(summary);

    expect(output).toContain("Total: 3 subtasks");
    expect(output).toContain("24m 29s");
  });

  test("renders average duration per subtask", () => {
    const summary = createSummary();
    const output = renderSummaryTable(summary);

    expect(output).toContain("Average per subtask");
    expect(output).toContain("8m 9s");
  });

  test("renders bottleneck warning when present", () => {
    const summary = createSummary();
    const output = renderSummaryTable(summary);

    expect(output).toContain("⚠");
    expect(output).toContain("Slowest phase: implementation (76% of time)");
  });

  test("does not render bottleneck warning when absent", () => {
    const summary = createSummary({ bottleneck: null });
    const output = renderSummaryTable(summary);

    expect(output).not.toContain("⚠");
    expect(output).not.toContain("Slowest phase");
  });

  test("uses box-drawing characters for table borders", () => {
    const summary = createSummary();
    const output = renderSummaryTable(summary);

    expect(output).toContain("┌");
    expect(output).toContain("┐");
    expect(output).toContain("├");
    expect(output).toContain("┤");
    expect(output).toContain("└");
    expect(output).toContain("┘");
    expect(output).toContain("│");
    expect(output).toContain("─");
  });

  test("truncates long subtask titles with ellipsis", () => {
    const summary = createSummary({
      subtaskTimings: [
        {
          title: "This is a very long subtask title that should be truncated",
          durationMs: 300000,
          phases: {
            implementation: 200000,
            review: 100000,
            merge: null,
            conflictSolver: null
          }
        }
      ]
    });
    const output = renderSummaryTable(summary);

    expect(output).toContain("…");
    expect(output).not.toContain(
      "This is a very long subtask title that should be truncated"
    );
  });

  test("handles task with no subtasks", () => {
    const summary = createSummary({
      subtaskCount: 0,
      totalDurationMs: 0,
      averageDurationMs: 0,
      subtaskTimings: [],
      bottleneck: null
    });
    const output = renderSummaryTable(summary);

    expect(output).toContain("Task completed");
    expect(output).toContain("Total: 0 subtasks");
  });

  test("handles subtasks with missing timing data", () => {
    const summary = createSummary({
      subtaskTimings: [
        {
          title: "Subtask with no phases",
          durationMs: 0,
          phases: {
            implementation: null,
            review: null,
            merge: null,
            conflictSolver: null
          }
        }
      ]
    });
    const output = renderSummaryTable(summary);

    expect(output).toContain("Subtask with no phases");
    expect(output).toContain("-");
  });

  test("right-aligns duration columns", () => {
    const summary = createSummary({
      subtaskTimings: [
        {
          title: "Short task",
          durationMs: 5000,
          phases: {
            implementation: 3000,
            review: 2000,
            merge: null,
            conflictSolver: null
          }
        },
        {
          title: "Longer task",
          durationMs: 600000,
          phases: {
            implementation: 480000,
            review: 120000,
            merge: null,
            conflictSolver: null
          }
        }
      ]
    });
    const output = renderSummaryTable(summary);
    const lines = output.split("\n");

    const dataLines = lines.filter(
      (line) => line.includes("Short task") || line.includes("Longer task")
    );
    expect(dataLines.length).toBe(2);

    for (const line of dataLines) {
      const segments = line.split("│").filter((s) => s.trim());
      expect(segments.length).toBeGreaterThanOrEqual(3);
    }
  });
});
