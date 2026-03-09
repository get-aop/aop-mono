import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { createLogBuffer } from "../events/index.ts";
import {
  cleanupLogFile,
  ensureDir,
  extractPauseContext,
  finalizeExecutionAndGetNextStep,
  persistStepLogs,
  populateLogBuffer,
  processAgentCompletion,
} from "./completion-handler.ts";

describe("completion-handler", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let tempDir: string;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db, { logBuffer: createLogBuffer() });
    tempDir = await mkdtemp(join(tmpdir(), "aop-completion-handler-"));
  });

  afterEach(async () => {
    await db.destroy();
    await rm(tempDir, { recursive: true, force: true });
  });

  test("processAgentCompletion extracts signals and pause context from complete JSONL output", async () => {
    const logFile = join(tempDir, "agent.jsonl");
    await writeFile(
      logFile,
      `${JSON.stringify({
        type: "text",
        part: {
          text: [
            "Need input",
            "<aop>REQUIRES_INPUT</aop>",
            "INPUT_REASON: Need clarification",
            "INPUT_TYPE: text",
          ].join("\n"),
        },
      })}\n`,
    );

    const result = processAgentCompletion(logFile, { exitCode: 0, sessionId: "session-1" }, [
      { name: "REQUIRES_INPUT", description: "pause" },
    ]);

    expect(result).toEqual({
      exitCode: 0,
      sessionId: "session-1",
      status: "success",
      signal: "REQUIRES_INPUT",
      pauseContext: "INPUT_REASON: Need clarification\nINPUT_TYPE: text",
    });
  });

  test("processAgentCompletion skips signal detection for partial output and timeouts", async () => {
    const logFile = join(tempDir, "partial.jsonl");
    await writeFile(logFile, '{"type":"text","part":{"text":"<aop>REQUIRES_INPUT</aop>"');

    const partial = processAgentCompletion(logFile, { exitCode: 0 }, [
      { name: "REQUIRES_INPUT", description: "pause" },
    ]);
    const timedOut = processAgentCompletion(logFile, { exitCode: 0, timedOut: true }, [
      { name: "REQUIRES_INPUT", description: "pause" },
    ]);

    expect(partial.status).toBe("success");
    expect(partial.signal).toBeUndefined();
    expect(timedOut.status).toBe("timeout");
    expect(timedOut.signal).toBeUndefined();
  });

  test("populateLogBuffer stores non-empty log lines and ignores missing files", async () => {
    populateLogBuffer(ctx, join(tempDir, "missing.jsonl"), "step-missing");

    const logFile = join(tempDir, "buffer.jsonl");
    await writeFile(logFile, "first\n\nsecond\n");

    populateLogBuffer(ctx, logFile, "step-1");

    expect(ctx.logBuffer.getLines("step-1")).toEqual(["first", "second"]);
    expect(ctx.logBuffer.getLines("step-missing")).toEqual([]);
  });

  test("cleanupLogFile removes an existing log file", async () => {
    const logFile = join(tempDir, "cleanup.jsonl");
    await writeFile(logFile, "cleanup");

    cleanupLogFile(logFile);

    expect(Bun.file(logFile).exists()).resolves.toBe(false);
  });

  test("persistStepLogs saves buffered log lines and swallows persistence errors", async () => {
    ctx.logBuffer.push("step-success", "line-1");
    ctx.logBuffer.push("step-success", "line-2");

    await persistStepLogs(ctx, "step-success");

    const saved = await ctx.executionRepository.getStepLogs("step-success");
    expect(saved.map((entry) => entry.content)).toEqual(["line-1", "line-2"]);

    ctx.logBuffer.push("step-fail", "line-3");
    ctx.executionRepository.saveStepLogs = async () => {
      throw new Error("db down");
    };

    await expect(persistStepLogs(ctx, "step-fail")).resolves.toBeUndefined();
    await expect(persistStepLogs(ctx, "step-empty")).resolves.toBeUndefined();
  });

  test("finalizeExecutionAndGetNextStep returns the next step only for WORKING completions", async () => {
    await createTestRepo(db, "repo-1", join(tempDir, "repo-1"));
    await createTestTask(db, "task-1", "repo-1", "changes/task-1", "WORKING");

    ctx.workflowService = {
      ...ctx.workflowService,
      completeStep: async () => ({
        taskStatus: "WORKING",
        execution: { id: "exec-1", workflowId: "simple" },
        step: {
          id: "step-next",
          stepId: "implement",
          type: "implement",
          promptTemplate: "prompt",
          attempt: 1,
          iteration: 0,
          signals: [],
        },
      }),
    };

    const next = await finalizeExecutionAndGetNextStep(ctx, "task-1", "exec-1", "step-1", {
      exitCode: 0,
      sessionId: "session-1",
      status: "success",
      signal: "TASK_COMPLETE",
    });
    const missing = await finalizeExecutionAndGetNextStep(ctx, "missing-task", "exec-1", "step-1", {
      exitCode: 1,
      status: "failure",
    });

    expect(next).toEqual({
      execution: { id: "exec-1", workflowId: "simple" },
      step: {
        id: "step-next",
        stepId: "implement",
        type: "implement",
        promptTemplate: "prompt",
        attempt: 1,
        iteration: 0,
        signals: [],
      },
    });
    expect(missing).toBeNull();
  });

  test("extractPauseContext returns only input metadata lines", () => {
    expect(
      extractPauseContext(
        ["Some output", "INPUT_REASON: Need approval", "ignore this", "INPUT_TYPE: text"].join(
          "\n",
        ),
      ),
    ).toBe("INPUT_REASON: Need approval\nINPUT_TYPE: text");
    expect(extractPauseContext("No metadata")).toBeUndefined();
  });

  test("ensureDir creates the directory only when it is missing", async () => {
    const nestedDir = join(tempDir, "nested", "path");

    ensureDir(nestedDir);
    ensureDir(nestedDir);

    expect((await stat(nestedDir)).isDirectory()).toBe(true);
  });
});
