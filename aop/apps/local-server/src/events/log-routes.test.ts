import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
