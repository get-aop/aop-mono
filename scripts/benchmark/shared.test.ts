import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BenchmarkResult,
  computeUnexpectedChangedFiles,
  readTaskDocStatuses,
  summarizeBenchmarkComparison,
} from "./shared.ts";

const writeTaskDoc = async (repoPath: string, taskName: string, status: string): Promise<void> => {
  const taskDir = join(repoPath, "docs", "tasks", taskName);
  await mkdir(taskDir, { recursive: true });
  await writeFile(
    join(taskDir, "task.md"),
    `---\ntitle: ${taskName}\nstatus: ${status}\n---\n\n## Description\nfixture\n`,
  );
};

describe("benchmark shared helpers", () => {
  test("readTaskDocStatuses reads task.md frontmatter statuses", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "aop-benchmark-status-"));
    await writeTaskDoc(repoPath, "task-one", "DRAFT");
    await writeTaskDoc(repoPath, "task-two", "DONE");

    const statuses = await readTaskDocStatuses(repoPath);

    expect(statuses).toEqual({
      "task-one": "DRAFT",
      "task-two": "DONE",
    });
  });

  test("computeUnexpectedChangedFiles filters allowed path prefixes", () => {
    const unexpected = computeUnexpectedChangedFiles(
      ["src/notes.ts", "tests/cli.test.ts", "docs/tasks/benchmark-cli-report/task.md", "README.md"],
      ["src/", "tests/", "docs/tasks/"],
    );

    expect(unexpected).toEqual(["README.md"]);
  });

  test("summarizeBenchmarkComparison computes makespan improvement", () => {
    const aopResult = {
      scenario: "notes-cli",
      mode: "aop-codex",
      success: true,
      metrics: {
        totalDurationMs: 120_000,
        firstTaskCompletedMs: 45_000,
        maxConcurrentWorkingTasks: 2,
        tasksCompleted: 3,
        tasksExpected: 3,
        finalVerificationPassed: true,
      },
    } as BenchmarkResult;
    const pureResult = {
      scenario: "notes-cli",
      mode: "pure-codex",
      success: true,
      metrics: {
        totalDurationMs: 180_000,
        firstTaskCompletedMs: 75_000,
        maxConcurrentWorkingTasks: 1,
        tasksCompleted: 3,
        tasksExpected: 3,
        finalVerificationPassed: true,
      },
    } as BenchmarkResult;

    const summary = summarizeBenchmarkComparison(aopResult, pureResult);

    expect(summary.totalDurationDeltaMs).toBe(-60_000);
    expect(summary.totalDurationImprovementPct).toBeCloseTo(33.33, 2);
    expect(summary.firstCompletionDeltaMs).toBe(-30_000);
    expect(summary.firstCompletionImprovementPct).toBeCloseTo(40, 2);
  });
});
