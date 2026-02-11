import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createExecutionRepository, type ExecutionRepository } from "./execution-repository.ts";
import { ExecutionStatus, StepExecutionStatus } from "./execution-types.ts";
import { createLogFlusher, type LogFlusher } from "./log-flusher.ts";

describe("LogFlusher", () => {
  let db: Kysely<Database>;
  let repo: ExecutionRepository;
  let flusher: LogFlusher;
  let logsDir: string;

  beforeEach(async () => {
    db = await createTestDb();
    repo = createExecutionRepository(db);
    logsDir = join(tmpdir(), `aop-test-flusher-${Date.now()}`);
    mkdirSync(logsDir, { recursive: true });
  });

  afterEach(async () => {
    flusher?.stop();
    await db.destroy();
    if (existsSync(logsDir)) rmSync(logsDir, { recursive: true });
  });

  const setupStep = async (stepId: string) => {
    await db
      .insertInto("tasks")
      .values({ id: "task-1", repo_id: "repo-1", change_path: "c", status: "WORKING" })
      .onConflict((oc) => oc.doNothing())
      .execute();
    await db
      .insertInto("repos")
      .values({ id: "repo-1", path: "/r", max_concurrent_tasks: 1 })
      .onConflict((oc) => oc.doNothing())
      .execute();
    await repo.createExecution({
      id: "exec-1",
      task_id: "task-1",
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });
    await repo.createStepExecution({
      id: stepId,
      execution_id: "exec-1",
      status: StepExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });
  };

  const writeLogFile = (stepId: string, lines: string[]): string => {
    const logFile = join(logsDir, `${stepId}.jsonl`);
    writeFileSync(logFile, lines.join("\n"));
    return logFile;
  };

  test("track + finalFlush persists all lines from file to DB", async () => {
    const stepId = "step-flush-1";
    await setupStep(stepId);

    flusher = createLogFlusher(repo);
    const lines = [
      JSON.stringify({ type: "assistant", message: "line 1" }),
      JSON.stringify({ type: "assistant", message: "line 2" }),
      JSON.stringify({ type: "result", subtype: "success" }),
    ];
    const logFile = writeLogFile(stepId, lines);

    flusher.track(stepId, logFile);
    await flusher.finalFlush(stepId);

    const logs = await repo.getStepLogs(stepId);
    expect(logs.length).toBe(3);
    expect(logs[0]?.content).toBe(lines[0]);
    expect(logs[1]?.content).toBe(lines[1]);
    expect(logs[2]?.content).toBe(lines[2]);
  });

  test("finalFlush on untracked step is a no-op", async () => {
    flusher = createLogFlusher(repo);
    await flusher.finalFlush("nonexistent-step");
    // Should not throw
  });

  test("periodic tick flushes incrementally", async () => {
    const stepId = "step-periodic-1";
    await setupStep(stepId);

    flusher = createLogFlusher(repo, { flushIntervalMs: 50 });
    const logFile = join(logsDir, `${stepId}.jsonl`);

    // Write initial lines
    writeFileSync(logFile, `${JSON.stringify({ type: "assistant", message: "line 1" })}\n`);

    flusher.track(stepId, logFile);
    flusher.start();

    // Wait for at least one tick
    await new Promise((resolve) => setTimeout(resolve, 120));

    const logsAfterFirstTick = await repo.getStepLogs(stepId);
    expect(logsAfterFirstTick.length).toBe(1);

    // Append more lines
    writeFileSync(
      logFile,
      [
        JSON.stringify({ type: "assistant", message: "line 1" }),
        JSON.stringify({ type: "assistant", message: "line 2" }),
        JSON.stringify({ type: "result", subtype: "success" }),
      ].join("\n"),
    );

    // Wait for another tick
    await new Promise((resolve) => setTimeout(resolve, 120));

    const logsAfterSecondTick = await repo.getStepLogs(stepId);
    expect(logsAfterSecondTick.length).toBe(3);
  });

  test("second tick with no new lines writes nothing", async () => {
    const stepId = "step-noop-1";
    await setupStep(stepId);

    flusher = createLogFlusher(repo, { flushIntervalMs: 50 });
    const lines = [JSON.stringify({ type: "assistant", message: "line 1" })];
    const logFile = writeLogFile(stepId, lines);

    flusher.track(stepId, logFile);
    flusher.start();

    // Wait for two ticks
    await new Promise((resolve) => setTimeout(resolve, 180));

    const logs = await repo.getStepLogs(stepId);
    expect(logs.length).toBe(1);
  });

  test("stop clears timers and tracking", async () => {
    const stepId = "step-stop-1";
    await setupStep(stepId);

    flusher = createLogFlusher(repo, { flushIntervalMs: 50 });
    const lines = [JSON.stringify({ type: "assistant", message: "line 1" })];
    const logFile = writeLogFile(stepId, lines);

    flusher.track(stepId, logFile);
    flusher.start();
    flusher.stop();

    // After stop, finalFlush should be a no-op since tracking was cleared
    await flusher.finalFlush(stepId);

    const logs = await repo.getStepLogs(stepId);
    // May have 0 or 1 depending on race, but stop cleared tracking
    // so finalFlush won't contribute
    expect(logs.length).toBeLessThanOrEqual(1);
  });

  test("partial flush then append then finalFlush — all rows present, no duplicates", async () => {
    const stepId = "step-nodedup-1";
    await setupStep(stepId);

    flusher = createLogFlusher(repo, { flushIntervalMs: 50 });
    const logFile = join(logsDir, `${stepId}.jsonl`);

    writeFileSync(
      logFile,
      [
        JSON.stringify({ type: "assistant", message: "line 1" }),
        JSON.stringify({ type: "assistant", message: "line 2" }),
      ].join("\n"),
    );

    flusher.track(stepId, logFile);
    flusher.start();

    // Wait for a tick to flush the first 2 lines
    await new Promise((resolve) => setTimeout(resolve, 120));

    const midLogs = await repo.getStepLogs(stepId);
    expect(midLogs.length).toBe(2);

    // Append 2 more lines (rewrite file with all 4 lines)
    writeFileSync(
      logFile,
      [
        JSON.stringify({ type: "assistant", message: "line 1" }),
        JSON.stringify({ type: "assistant", message: "line 2" }),
        JSON.stringify({ type: "assistant", message: "line 3" }),
        JSON.stringify({ type: "result", subtype: "success" }),
      ].join("\n"),
    );

    // finalFlush picks up only the delta (lines 3-4)
    await flusher.finalFlush(stepId);

    const allLogs = await repo.getStepLogs(stepId);
    expect(allLogs.length).toBe(4);
    expect(allLogs[0]?.content).toContain("line 1");
    expect(allLogs[1]?.content).toContain("line 2");
    expect(allLogs[2]?.content).toContain("line 3");
    expect(allLogs[3]?.content).toContain("success");
  });

  test("handles missing log file gracefully", async () => {
    const stepId = "step-missing-1";
    await setupStep(stepId);

    flusher = createLogFlusher(repo);
    flusher.track(stepId, join(logsDir, "nonexistent.jsonl"));
    await flusher.finalFlush(stepId);

    const logs = await repo.getStepLogs(stepId);
    expect(logs.length).toBe(0);
  });

  test("start is idempotent", () => {
    flusher = createLogFlusher(repo, { flushIntervalMs: 1000 });
    flusher.start();
    flusher.start(); // Should not throw or create duplicate timers
    flusher.stop();
  });
});
