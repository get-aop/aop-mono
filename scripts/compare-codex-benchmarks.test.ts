import { describe, expect, test } from "bun:test";
import type { BenchmarkResult } from "./benchmark/shared.ts";
import { buildComparisonLines } from "./compare-codex-benchmarks.ts";

const createResult = (
  overrides: Partial<BenchmarkResult>,
  mode: BenchmarkResult["mode"],
): BenchmarkResult => ({
  recordedAt: "2026-03-13T00:00:00.000Z",
  scenario: "notes-cli",
  mode,
  provider: "codex",
  model: null,
  workflow: mode === "aop-codex" ? "aop-default" : null,
  reasoningEffort: null,
  success: true,
  metrics: {
    totalDurationMs: 100,
    firstTaskCompletedMs: 50,
    maxConcurrentWorkingTasks: mode === "aop-codex" ? 2 : 1,
    tasksCompleted: 3,
    tasksExpected: 3,
    finalVerificationPassed: true,
  },
  verification: {
    command: ["bun", "test"],
    exitCode: 0,
    stdout: "",
    stderr: "",
  },
  tasks: [],
  changedFiles: [],
  unexpectedFilesChanged: [],
  missingRequiredChangedFiles: [],
  artifacts: {
    runDir: "/tmp/run",
    repoPath: "/tmp/repo",
    logPath: null,
  },
  notes: [],
  ...overrides,
});

describe("compare-codex-benchmarks", () => {
  test("includes success state and missing required outputs", () => {
    const aop = createResult(
      {
        success: false,
        metrics: {
          totalDurationMs: 250,
          firstTaskCompletedMs: 120,
          maxConcurrentWorkingTasks: 2,
          tasksCompleted: 3,
          tasksExpected: 3,
          finalVerificationPassed: true,
        },
        missingRequiredChangedFiles: ["src/cli.ts", "tests/cli.test.ts"],
      },
      "aop-codex",
    );
    const pure = createResult(
      {
        success: true,
        metrics: {
          totalDurationMs: 100,
          firstTaskCompletedMs: 40,
          maxConcurrentWorkingTasks: 1,
          tasksCompleted: 3,
          tasksExpected: 3,
          finalVerificationPassed: true,
        },
      },
      "pure-codex",
    );

    const lines = buildComparisonLines(aop, pure);

    expect(lines).toContain("- AOP success: no");
    expect(lines).toContain("- AOP workflow: aop-default");
    expect(lines).toContain("- Pure Codex success: yes");
    expect(lines).toContain("- AOP missing required outputs: src/cli.ts, tests/cli.test.ts");
    expect(lines).toContain("- Pure Codex missing required outputs: none");
  });
});
