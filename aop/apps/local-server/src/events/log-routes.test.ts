import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { ExecutionStatus } from "../executor/execution-types.ts";
import { createLogBuffer } from "./log-buffer.ts";
import { createLogStreamHandler } from "./log-routes.ts";

interface SSEEvent {
  event?: string;
  data: string;
  id?: string;
}

const parseLine = (line: string, event: SSEEvent): void => {
  if (line.startsWith("event:")) event.event = line.slice(6).trim();
  else if (line.startsWith("data:")) event.data = line.slice(5).trim();
  else if (line.startsWith("id:")) event.id = line.slice(3).trim();
};

const parseBlock = (block: string): SSEEvent | null => {
  const event: SSEEvent = { data: "" };
  for (const line of block.split("\n")) {
    parseLine(line, event);
  }
  return event.data ? event : null;
};

const parseSSEEvents = (text: string): SSEEvent[] => {
  return text
    .split("\n\n")
    .filter((b) => b.trim())
    .map(parseBlock)
    .filter((e): e is SSEEvent => e !== null);
};

describe("log-routes", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: Hono;

  beforeEach(async () => {
    db = await createTestDb();
    const logBuffer = createLogBuffer();
    ctx = createCommandContext(db, { logBuffer });

    app = new Hono();
    app.get("/api/executions/:executionId/logs", createLogStreamHandler(ctx));
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("GET /api/executions/:executionId/logs", () => {
    it("returns 404 for non-existent execution", async () => {
      const res = await app.request("/api/executions/non-existent/logs");

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Execution not found");
    });

    it("returns SSE stream for existing execution", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      ctx.logBuffer.push("exec-1", {
        stream: "stdout",
        content: "Hello world",
        timestamp: "2024-01-01T00:00:00.000Z",
      });
      ctx.logBuffer.markComplete("exec-1", "completed");

      const res = await app.request("/api/executions/exec-1/logs");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");

      const text = await res.text();
      const events = parseSSEEvents(text);

      expect(events.length).toBeGreaterThanOrEqual(2);

      const replayEvent = JSON.parse(events[0]?.data ?? "{}");
      expect(replayEvent.type).toBe("replay");
      expect(replayEvent.lines).toHaveLength(1);
      expect(replayEvent.lines[0].content).toBe("Hello world");

      const completeEvent = JSON.parse(events[1]?.data ?? "{}");
      expect(completeEvent.type).toBe("complete");
      expect(completeEvent.status).toBe("completed");
    });

    it("replays buffered lines for late-joining clients", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      ctx.logBuffer.push("exec-1", {
        stream: "stdout",
        content: "line 1",
        timestamp: "2024-01-01T00:00:01.000Z",
      });
      ctx.logBuffer.push("exec-1", {
        stream: "stderr",
        content: "error line",
        timestamp: "2024-01-01T00:00:02.000Z",
      });
      ctx.logBuffer.push("exec-1", {
        stream: "stdout",
        content: "line 2",
        timestamp: "2024-01-01T00:00:03.000Z",
      });
      ctx.logBuffer.markComplete("exec-1", "completed");

      const res = await app.request("/api/executions/exec-1/logs");
      const text = await res.text();
      const events = parseSSEEvents(text);

      const replayEvent = JSON.parse(events[0]?.data ?? "{}");
      expect(replayEvent.type).toBe("replay");
      expect(replayEvent.lines).toHaveLength(3);
      expect(replayEvent.lines[0].content).toBe("line 1");
      expect(replayEvent.lines[0].stream).toBe("stdout");
      expect(replayEvent.lines[1].content).toBe("error line");
      expect(replayEvent.lines[1].stream).toBe("stderr");
      expect(replayEvent.lines[2].content).toBe("line 2");
    });

    it("sends complete event with failed status", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.FAILED,
        started_at: new Date().toISOString(),
      });

      ctx.logBuffer.markComplete("exec-1", "failed");

      const res = await app.request("/api/executions/exec-1/logs");
      const text = await res.text();
      const events = parseSSEEvents(text);

      const completeEvent = JSON.parse(events[0]?.data ?? "{}");
      expect(completeEvent.type).toBe("complete");
      expect(completeEvent.status).toBe("failed");
    });

    it("streams live log events as they arrive", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const responsePromise = app.request("/api/executions/exec-1/logs");

      await new Promise((resolve) => setTimeout(resolve, 50));

      ctx.logBuffer.push("exec-1", {
        stream: "stdout",
        content: "live log 1",
        timestamp: "2024-01-01T00:00:00.000Z",
      });
      ctx.logBuffer.push("exec-1", {
        stream: "stderr",
        content: "live error",
        timestamp: "2024-01-01T00:00:01.000Z",
      });
      ctx.logBuffer.markComplete("exec-1", "completed");

      const res = await responsePromise;
      expect(res.status).toBe(200);

      const text = await res.text();
      const events = parseSSEEvents(text);

      const logEvents = events.map((e) => JSON.parse(e.data)).filter((e) => e.type === "log");
      expect(logEvents).toHaveLength(2);
      expect(logEvents[0].content).toBe("live log 1");
      expect(logEvents[0].stream).toBe("stdout");
      expect(logEvents[1].content).toBe("live error");
      expect(logEvents[1].stream).toBe("stderr");

      const completeEvents = events
        .map((e) => JSON.parse(e.data))
        .filter((e) => e.type === "complete");
      expect(completeEvents).toHaveLength(1);
      expect(completeEvents[0].status).toBe("completed");
    });

    it("filters log events by executionId", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createExecution({
        id: "exec-2",
        task_id: "task-2",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const responsePromise = app.request("/api/executions/exec-1/logs");

      await new Promise((resolve) => setTimeout(resolve, 50));

      ctx.logBuffer.push("exec-2", {
        stream: "stdout",
        content: "other execution log",
        timestamp: "2024-01-01T00:00:00.000Z",
      });
      ctx.logBuffer.push("exec-1", {
        stream: "stdout",
        content: "my execution log",
        timestamp: "2024-01-01T00:00:01.000Z",
      });
      ctx.logBuffer.markComplete("exec-1", "completed");

      const res = await responsePromise;
      const text = await res.text();
      const events = parseSSEEvents(text);

      const logEvents = events.map((e) => JSON.parse(e.data)).filter((e) => e.type === "log");
      expect(logEvents).toHaveLength(1);
      expect(logEvents[0].content).toBe("my execution log");
    });

    it("filters complete events by executionId", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createExecution({
        id: "exec-2",
        task_id: "task-2",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const responsePromise = app.request("/api/executions/exec-1/logs");

      await new Promise((resolve) => setTimeout(resolve, 50));

      ctx.logBuffer.markComplete("exec-2", "failed");

      ctx.logBuffer.push("exec-1", {
        stream: "stdout",
        content: "log",
        timestamp: "2024-01-01T00:00:00.000Z",
      });
      ctx.logBuffer.markComplete("exec-1", "completed");

      const res = await responsePromise;
      const text = await res.text();
      const events = parseSSEEvents(text);

      const completeEvents = events
        .map((e) => JSON.parse(e.data))
        .filter((e) => e.type === "complete");
      expect(completeEvents).toHaveLength(1);
      expect(completeEvents[0].status).toBe("completed");
    });

    it("sends complete event with cancelled status", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      ctx.logBuffer.markComplete("exec-1", "cancelled");

      const res = await app.request("/api/executions/exec-1/logs");
      const text = await res.text();
      const events = parseSSEEvents(text);

      const completeEvent = JSON.parse(events[0]?.data ?? "{}");
      expect(completeEvent.type).toBe("complete");
      expect(completeEvent.status).toBe("cancelled");
    });

    it("returns empty stream when no logs exist for completed execution", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DONE");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.COMPLETED,
        started_at: new Date().toISOString(),
      });

      ctx.logBuffer.markComplete("exec-1", "completed");

      const res = await app.request("/api/executions/exec-1/logs");
      const text = await res.text();
      const events = parseSSEEvents(text);

      expect(events).toHaveLength(1);
      const completeEvent = JSON.parse(events[0]?.data ?? "{}");
      expect(completeEvent.type).toBe("complete");
      expect(completeEvent.status).toBe("completed");
    });

    it("returns persisted logs from database for completed execution", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DONE");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.COMPLETED,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      await ctx.executionRepository.saveExecutionLogs([
        {
          execution_id: "exec-1",
          stream: "stdout",
          content: "persisted line 1",
          timestamp: "2024-01-01T00:00:01Z",
        },
        {
          execution_id: "exec-1",
          stream: "stderr",
          content: "persisted error",
          timestamp: "2024-01-01T00:00:02Z",
        },
        {
          execution_id: "exec-1",
          stream: "stdout",
          content: "persisted line 2",
          timestamp: "2024-01-01T00:00:03Z",
        },
      ]);

      const res = await app.request("/api/executions/exec-1/logs");
      expect(res.status).toBe(200);

      const text = await res.text();
      const events = parseSSEEvents(text);

      expect(events.length).toBeGreaterThanOrEqual(2);

      const replayEvent = JSON.parse(events[0]?.data ?? "{}");
      expect(replayEvent.type).toBe("replay");
      expect(replayEvent.lines).toHaveLength(3);
      expect(replayEvent.lines[0].content).toBe("persisted line 1");
      expect(replayEvent.lines[0].stream).toBe("stdout");
      expect(replayEvent.lines[1].content).toBe("persisted error");
      expect(replayEvent.lines[1].stream).toBe("stderr");
      expect(replayEvent.lines[2].content).toBe("persisted line 2");

      const completeEvent = JSON.parse(events[1]?.data ?? "{}");
      expect(completeEvent.type).toBe("complete");
      expect(completeEvent.status).toBe("completed");
    });

    it("returns persisted logs for failed execution with correct status", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "BLOCKED");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.FAILED,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      await ctx.executionRepository.saveExecutionLogs([
        {
          execution_id: "exec-1",
          stream: "stderr",
          content: "error occurred",
          timestamp: "2024-01-01T00:00:01Z",
        },
      ]);

      const res = await app.request("/api/executions/exec-1/logs");
      const text = await res.text();
      const events = parseSSEEvents(text);

      const completeEvent = JSON.parse(events[1]?.data ?? "{}");
      expect(completeEvent.type).toBe("complete");
      expect(completeEvent.status).toBe("failed");
    });

    it("maps aborted execution status to cancelled", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "BLOCKED");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "aborted" as "aborted",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      const res = await app.request("/api/executions/exec-1/logs");
      const text = await res.text();
      const events = parseSSEEvents(text);

      const completeEvent = JSON.parse(events[0]?.data ?? "{}");
      expect(completeEvent.type).toBe("complete");
      expect(completeEvent.status).toBe("cancelled");
    });

    it("cleans up listeners on normal completion (no memory leak)", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      // Open 15 SSE connections that complete normally - more than the default EventEmitter limit of 10
      // If listeners aren't cleaned up, this would trigger MaxListenersExceededWarning
      for (let i = 0; i < 15; i++) {
        await ctx.executionRepository.createExecution({
          id: `exec-${i}`,
          task_id: "task-1",
          status: ExecutionStatus.RUNNING,
          started_at: new Date().toISOString(),
        });

        const responsePromise = app.request(`/api/executions/exec-${i}/logs`);
        await new Promise((resolve) => setTimeout(resolve, 10));

        ctx.logBuffer.push(`exec-${i}`, {
          stream: "stdout",
          content: "test log",
          timestamp: "2024-01-01T00:00:00.000Z",
        });
        ctx.logBuffer.markComplete(`exec-${i}`, "completed");

        const res = await responsePromise;
        expect(res.status).toBe(200);

        // Wait for async cleanup to complete after the response
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      // If we got here without warnings, listeners are being cleaned up properly
    });

    it("unsubscribes from log events on abort", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const controller = new AbortController();
      const responsePromise = app.request("/api/executions/exec-1/logs", {
        signal: controller.signal,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      ctx.logBuffer.push("exec-1", {
        stream: "stdout",
        content: "before abort",
        timestamp: "2024-01-01T00:00:00.000Z",
      });

      await new Promise((resolve) => setTimeout(resolve, 20));
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 20));

      ctx.logBuffer.push("exec-1", {
        stream: "stdout",
        content: "after abort - should not appear",
        timestamp: "2024-01-01T00:00:01.000Z",
      });

      try {
        await responsePromise;
      } catch {}

      const lines = ctx.logBuffer.getLines("exec-1");
      expect(lines).toHaveLength(2);
      expect(lines[0]?.content).toBe("before abort");
      expect(lines[1]?.content).toBe("after abort - should not appear");
    });
  });
});

describe("log-routes file-based streaming", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: Hono;
  let testDir: string;

  const writeJsonl = (filename: string, entries: Record<string, unknown>[]): string => {
    const path = join(testDir, filename);
    writeFileSync(path, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`);
    return path;
  };

  const setupFileRoute = (isProcessAlive: (pid: number) => boolean) => {
    app = new Hono();
    app.get(
      "/api/executions/:executionId/logs",
      createLogStreamHandler(ctx, {
        logsDir: testDir,
        isProcessAlive,
        pollIntervalMs: 50,
      }),
    );
  };

  const createRunningExecution = async (execId: string, stepId: string, agentPid: number) => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await ctx.executionRepository.createExecution({
      id: execId,
      task_id: "task-1",
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });
    await ctx.executionRepository.createStepExecution({
      id: stepId,
      execution_id: execId,
      step_type: "implement",
      agent_pid: agentPid,
      session_id: null,
      status: "running",
      exit_code: null,
      signal: null,
      error: null,
      started_at: new Date().toISOString(),
      ended_at: null,
    });
  };

  beforeEach(async () => {
    db = await createTestDb();
    const logBuffer = createLogBuffer();
    ctx = createCommandContext(db, { logBuffer });
    testDir = join(tmpdir(), `log-routes-file-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(async () => {
    await db.destroy();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("streams from log file when agent is already dead", async () => {
    const stepId = "step-1";
    await createRunningExecution("exec-1", stepId, 99999);

    writeJsonl(`${stepId}.jsonl`, [
      { type: "assistant", message: { content: [{ type: "text", text: "Hello from file" }] } },
      { type: "tool_use", tool_name: "Bash", input: { command: "ls" } },
    ]);

    setupFileRoute(() => false);

    const res = await app.request("/api/executions/exec-1/logs");
    expect(res.status).toBe(200);

    const text = await res.text();
    const events = parseSSEEvents(text);
    const parsed = events.map((e) => JSON.parse(e.data));

    const replayEvent = parsed.find((e) => e.type === "replay");
    expect(replayEvent).toBeDefined();
    expect(replayEvent.lines).toHaveLength(2);
    expect(replayEvent.lines[0].content).toBe("Hello from file");
    expect(replayEvent.lines[1].content).toBe("[Bash] ls");

    const completeEvent = parsed.find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();
  });

  it("resumes from Last-Event-ID offset", async () => {
    const stepId = "step-2";
    await createRunningExecution("exec-2", stepId, 99998);

    writeJsonl(`${stepId}.jsonl`, [
      { type: "assistant", message: { content: [{ type: "text", text: "line 1" }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "line 2" }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "line 3" }] } },
    ]);

    setupFileRoute(() => false);

    const res = await app.request("/api/executions/exec-2/logs", {
      headers: { "Last-Event-ID": "0" },
    });
    expect(res.status).toBe(200);

    const text = await res.text();
    const events = parseSSEEvents(text);
    const parsed = events.map((e) => JSON.parse(e.data));

    const replayEvent = parsed.find((e) => e.type === "replay");
    expect(replayEvent).toBeDefined();
    expect(replayEvent.lines).toHaveLength(2);
    expect(replayEvent.lines[0].content).toBe("line 2");
    expect(replayEvent.lines[1].content).toBe("line 3");

    expect(events[0]?.id).toBe("1");
  });

  it("skips all lines when Last-Event-ID exceeds line count", async () => {
    const stepId = "step-3";
    await createRunningExecution("exec-3", stepId, 99997);

    writeJsonl(`${stepId}.jsonl`, [
      { type: "assistant", message: { content: [{ type: "text", text: "only line" }] } },
    ]);

    setupFileRoute(() => false);

    const res = await app.request("/api/executions/exec-3/logs", {
      headers: { "Last-Event-ID": "10" },
    });
    expect(res.status).toBe(200);

    const text = await res.text();
    const events = parseSSEEvents(text);
    const parsed = events.map((e) => JSON.parse(e.data));

    const replayEvent = parsed.find((e) => e.type === "replay");
    expect(replayEvent).toBeUndefined();

    const completeEvent = parsed.find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();
  });

  it("polls file and detects agent exit", async () => {
    const stepId = "step-4";
    await createRunningExecution("exec-4", stepId, 99996);

    writeJsonl(`${stepId}.jsonl`, [
      { type: "assistant", message: { content: [{ type: "text", text: "initial" }] } },
    ]);

    let alive = true;
    setupFileRoute(() => alive);

    const responsePromise = app.request("/api/executions/exec-4/logs");

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logFile = join(testDir, `${stepId}.jsonl`);
    const newEntry = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "new output" }] },
    });
    writeFileSync(logFile, `${newEntry}\n`, { flag: "a" });

    await new Promise((resolve) => setTimeout(resolve, 150));

    await ctx.executionRepository.updateExecution("exec-4", {
      status: ExecutionStatus.COMPLETED,
      completed_at: new Date().toISOString(),
    });
    alive = false;

    const res = await responsePromise;
    expect(res.status).toBe(200);

    const text = await res.text();
    const events = parseSSEEvents(text);
    const parsed = events.map((e) => JSON.parse(e.data));

    const replayEvent = parsed.find((e) => e.type === "replay");
    expect(replayEvent).toBeDefined();
    expect(replayEvent.lines[0].content).toBe("initial");

    const completeEvent = parsed.find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();
    expect(completeEvent.status).toBe("completed");
  });

  it("falls back to LogBuffer when no step execution exists", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await ctx.executionRepository.createExecution({
      id: "exec-5",
      task_id: "task-1",
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });

    setupFileRoute(() => false);

    ctx.logBuffer.push("exec-5", {
      stream: "stdout",
      content: "from buffer",
      timestamp: "2024-01-01T00:00:00.000Z",
    });
    ctx.logBuffer.markComplete("exec-5", "completed");

    const res = await app.request("/api/executions/exec-5/logs");
    const text = await res.text();
    const events = parseSSEEvents(text);
    const parsed = events.map((e) => JSON.parse(e.data));

    const replayEvent = parsed.find((e) => e.type === "replay");
    expect(replayEvent).toBeDefined();
    expect(replayEvent.lines[0].content).toBe("from buffer");
  });

  it("assigns event IDs aligned with line count", async () => {
    const stepId = "step-6";
    await createRunningExecution("exec-6", stepId, 99994);

    writeJsonl(`${stepId}.jsonl`, [
      { type: "assistant", message: { content: [{ type: "text", text: "line 1" }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "line 2" }] } },
    ]);

    setupFileRoute(() => false);

    const res = await app.request("/api/executions/exec-6/logs");
    const text = await res.text();
    const events = parseSSEEvents(text);

    expect(events[0]?.id).toBe("0");
    expect(events[1]?.id).toBe("2");
  });

  it("includes persisted logs from completed steps in running execution replay", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await ctx.executionRepository.createExecution({
      id: "exec-multi",
      task_id: "task-1",
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });

    // Step 1 completed — its log file was deleted, but logs persisted to DB
    await ctx.executionRepository.createStepExecution({
      id: "step-completed",
      execution_id: "exec-multi",
      step_type: "iterate",
      agent_pid: null,
      session_id: null,
      status: "success",
      exit_code: 0,
      signal: null,
      error: null,
      started_at: "2024-01-01T00:00:00.000Z",
      ended_at: "2024-01-01T00:08:00.000Z",
    });
    await ctx.executionRepository.saveExecutionLogs([
      {
        execution_id: "exec-multi",
        stream: "stdout",
        content: "step 1 output",
        timestamp: "2024-01-01T00:01:00.000Z",
      },
      {
        execution_id: "exec-multi",
        stream: "stdout",
        content: "step 1 done",
        timestamp: "2024-01-01T00:07:00.000Z",
      },
    ]);

    // Step 2 running — its log file exists on disk
    await ctx.executionRepository.createStepExecution({
      id: "step-running",
      execution_id: "exec-multi",
      step_type: "review",
      agent_pid: 99993,
      session_id: null,
      status: "running",
      exit_code: null,
      signal: null,
      error: null,
      started_at: "2024-01-01T00:08:01.000Z",
      ended_at: null,
    });
    writeJsonl("step-running.jsonl", [
      { type: "assistant", message: { content: [{ type: "text", text: "step 2 reviewing" }] } },
    ]);

    setupFileRoute(() => false);

    const res = await app.request("/api/executions/exec-multi/logs");
    expect(res.status).toBe(200);

    const text = await res.text();
    const events = parseSSEEvents(text);
    const parsed = events.map((e) => JSON.parse(e.data));

    const replayEvent = parsed.find((e: { type: string }) => e.type === "replay");
    expect(replayEvent).toBeDefined();
    // Should contain both persisted step 1 logs AND current step 2 file logs
    expect(replayEvent.lines).toHaveLength(3);
    expect(replayEvent.lines[0].content).toBe("step 1 output");
    expect(replayEvent.lines[1].content).toBe("step 1 done");
    expect(replayEvent.lines[2].content).toBe("step 2 reviewing");
  });
});
