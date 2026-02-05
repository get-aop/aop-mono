import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createApp } from "../app.ts";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { createTaskEventEmitter, type TaskEventEmitter } from "./task-events.ts";

interface SSEParsedEvent {
  event: string;
  data: string;
  id: string;
}

const parseSSELine = (line: string, parsed: SSEParsedEvent): void => {
  if (line.startsWith("event:")) parsed.event = line.slice(6).trim();
  else if (line.startsWith("data:")) parsed.data = line.slice(5).trim();
  else if (line.startsWith("id:")) parsed.id = line.slice(3).trim();
};

const parseSSEBlock = (block: string): SSEParsedEvent | null => {
  const parsed: SSEParsedEvent = { event: "", data: "", id: "" };
  for (const line of block.split("\n")) {
    parseSSELine(line, parsed);
  }
  return parsed.event || parsed.data ? parsed : null;
};

const parseSSEEvents = (text: string): SSEParsedEvent[] => {
  return text
    .split("\n\n")
    .filter((b) => b.trim())
    .map(parseSSEBlock)
    .filter((e): e is SSEParsedEvent => e !== null);
};

describe("events/routes", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let emitter: TaskEventEmitter;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    db = await createTestDb();
    emitter = createTaskEventEmitter();
    ctx = createCommandContext(db, { taskEventEmitter: emitter });
    app = createApp({
      ctx,
      startTimeMs: Date.now(),
      isReady: () => true,
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("GET /api/events", () => {
    test("returns SSE content-type", async () => {
      const controller = new AbortController();
      const res = await app.request("/api/events", {
        signal: controller.signal,
      });

      expect(res.headers.get("content-type")).toContain("text/event-stream");

      controller.abort();
    });

    test("sends init event with current state on connection", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo", {
        maxConcurrentTasks: 2,
      });
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "READY");

      const controller = new AbortController();
      const res = await app.request("/api/events", {
        signal: controller.signal,
      });

      // biome-ignore lint/style/noNonNullAssertion: test code, body always exists
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";

      const { value } = await reader.read();
      text += decoder.decode(value);
      controller.abort();

      const events = parseSSEEvents(text);
      expect(events.length).toBeGreaterThanOrEqual(1);

      const initEvent = events.find((e) => e.event === "init");
      expect(initEvent).toBeDefined();

      // biome-ignore lint/style/noNonNullAssertion: already checked via expect
      const initData = JSON.parse(initEvent!.data);
      expect(initData.type).toBe("init");
      expect(initData.status.repos).toHaveLength(1);
      expect(initData.status.repos[0].tasks).toHaveLength(2);
    });

    test("broadcasts task-created event when task is created", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");

      const controller = new AbortController();
      const res = await app.request("/api/events", {
        signal: controller.signal,
      });

      // biome-ignore lint/style/noNonNullAssertion: test code, body always exists
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";

      // Read init + immediate heartbeat
      const { value: initValue } = await reader.read();
      text += decoder.decode(initValue);

      const now = new Date().toISOString();
      await ctx.taskRepository.create({
        id: "task-new",
        repo_id: "repo-1",
        change_path: "changes/new-feat",
        status: "DRAFT",
        created_at: now,
        updated_at: now,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Read until we get the task-created event
      for (let i = 0; i < 3; i++) {
        const { value } = await reader.read();
        if (value) text += decoder.decode(value);
      }
      controller.abort();

      const events = parseSSEEvents(text);
      const createdEvent = events.find((e) => e.event === "task-created");
      expect(createdEvent).toBeDefined();

      // biome-ignore lint/style/noNonNullAssertion: already checked via expect
      const eventData = JSON.parse(createdEvent!.data);
      expect(eventData.type).toBe("task-created");
      expect(eventData.task.id).toBe("task-new");
    });

    test("broadcasts task-status-changed event when task status changes", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");

      const controller = new AbortController();
      const res = await app.request("/api/events", {
        signal: controller.signal,
      });

      // biome-ignore lint/style/noNonNullAssertion: test code, body always exists
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";

      // Read init + immediate heartbeat
      const { value: initValue } = await reader.read();
      text += decoder.decode(initValue);

      await ctx.taskRepository.update("task-1", { status: "READY" });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Read until we get the status-changed event
      for (let i = 0; i < 3; i++) {
        const { value } = await reader.read();
        if (value) text += decoder.decode(value);
      }
      controller.abort();

      const events = parseSSEEvents(text);
      const statusEvent = events.find((e) => e.event === "task-status-changed");
      expect(statusEvent).toBeDefined();

      // biome-ignore lint/style/noNonNullAssertion: already checked via expect
      const eventData = JSON.parse(statusEvent!.data);
      expect(eventData.type).toBe("task-status-changed");
      expect(eventData.taskId).toBe("task-1");
      expect(eventData.previousStatus).toBe("DRAFT");
      expect(eventData.newStatus).toBe("READY");
    });

    test("broadcasts task-removed event when task is removed", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");

      const controller = new AbortController();
      const res = await app.request("/api/events", {
        signal: controller.signal,
      });

      // biome-ignore lint/style/noNonNullAssertion: test code, body always exists
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";

      // Read init + immediate heartbeat
      const { value: initValue } = await reader.read();
      text += decoder.decode(initValue);

      await ctx.taskRepository.markRemoved("task-1");
      await new Promise((resolve) => setTimeout(resolve, 100));

      // markRemoved emits both task-status-changed and task-removed events
      // Read multiple chunks to ensure we get all events
      for (let i = 0; i < 4; i++) {
        const { value } = await reader.read();
        if (value) text += decoder.decode(value);
      }
      controller.abort();

      const events = parseSSEEvents(text);
      const removedEvent = events.find((e) => e.event === "task-removed");
      expect(removedEvent).toBeDefined();

      // biome-ignore lint/style/noNonNullAssertion: already checked via expect
      const eventData = JSON.parse(removedEvent!.data);
      expect(eventData.type).toBe("task-removed");
      expect(eventData.taskId).toBe("task-1");
    });

    test("increments event IDs for each event", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");

      const controller = new AbortController();
      const res = await app.request("/api/events", {
        signal: controller.signal,
      });

      // biome-ignore lint/style/noNonNullAssertion: test code, body always exists
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";

      const { value: initValue } = await reader.read();
      text += decoder.decode(initValue);

      const now = new Date().toISOString();
      await ctx.taskRepository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "changes/feat-1",
        status: "DRAFT",
        created_at: now,
        updated_at: now,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const { value: eventValue } = await reader.read();
      text += decoder.decode(eventValue);
      controller.abort();

      const events = parseSSEEvents(text);
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0]?.id).toBe("0");
      expect(events[1]?.id).toBe("1");
    });

    test("subscribes to event emitter on connection", async () => {
      const initialListenerCount = emitter.listenerCount();

      const controller = new AbortController();
      const res = await app.request("/api/events", {
        signal: controller.signal,
      });

      // biome-ignore lint/style/noNonNullAssertion: test code, body always exists
      const reader = res.body!.getReader();
      await reader.read();

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(emitter.listenerCount()).toBe(initialListenerCount + 1);

      controller.abort();
    });

    test("unsubscribes from event emitter when connection is aborted", async () => {
      const initialListenerCount = emitter.listenerCount();

      const controller = new AbortController();
      const res = await app.request("/api/events", {
        signal: controller.signal,
      });

      // biome-ignore lint/style/noNonNullAssertion: test code, body always exists
      const reader = res.body!.getReader();
      await reader.read();

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(emitter.listenerCount()).toBe(initialListenerCount + 1);

      controller.abort();
      await reader.cancel();

      // Wait for onAbort callback to execute
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(emitter.listenerCount()).toBe(initialListenerCount);
    });

    test("cleans up listeners on abort (no memory leak)", async () => {
      const initialListenerCount = emitter.listenerCount();

      // Open 15 SSE connections that are aborted - more than the default EventEmitter limit of 10
      // If listeners aren't cleaned up, this would trigger MaxListenersExceededWarning
      for (let i = 0; i < 15; i++) {
        const controller = new AbortController();
        const res = await app.request("/api/events", {
          signal: controller.signal,
        });

        // biome-ignore lint/style/noNonNullAssertion: test code, body always exists
        const reader = res.body!.getReader();
        await reader.read();

        controller.abort();
        await reader.cancel();

        // Wait for cleanup to complete
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      // If we got here without warnings, listeners are being cleaned up properly
      expect(emitter.listenerCount()).toBe(initialListenerCount);
    });
  });

  describe("heartbeat", () => {
    let heartbeatApp: ReturnType<typeof createApp>;

    beforeEach(() => {
      heartbeatApp = createApp({
        ctx,
        startTimeMs: Date.now(),
        isReady: () => true,
        eventsSSEOptions: { heartbeatIntervalMs: 50 },
      });
    });

    test("sends heartbeat events at configured interval", async () => {
      const controller = new AbortController();
      const res = await heartbeatApp.request("/api/events", {
        signal: controller.signal,
      });

      // biome-ignore lint/style/noNonNullAssertion: test code, body always exists
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";

      // Read init event
      const { value: initValue } = await reader.read();
      text += decoder.decode(initValue);

      // Wait for heartbeat interval (50ms) plus buffer
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Read heartbeat event
      const { value: heartbeatValue } = await reader.read();
      text += decoder.decode(heartbeatValue);
      controller.abort();

      const events = parseSSEEvents(text);
      const heartbeatEvent = events.find((e) => e.event === "heartbeat");
      expect(heartbeatEvent).toBeDefined();
      expect(heartbeatEvent?.data).toBe("");
    });

    test("heartbeat increments event ID correctly", async () => {
      const controller = new AbortController();
      const res = await heartbeatApp.request("/api/events", {
        signal: controller.signal,
      });

      // biome-ignore lint/style/noNonNullAssertion: test code, body always exists
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";

      // Read init event (id: 0) and immediate heartbeat (id: 1)
      const { value: initValue } = await reader.read();
      text += decoder.decode(initValue);

      // Wait for interval heartbeat (id: 2)
      await new Promise((resolve) => setTimeout(resolve, 80));

      const { value: heartbeatValue } = await reader.read();
      text += decoder.decode(heartbeatValue);
      controller.abort();

      const events = parseSSEEvents(text);
      const initEvent = events.find((e) => e.event === "init");
      // Find heartbeats - there should be at least 2 (immediate + interval)
      const heartbeatEvents = events.filter((e) => e.event === "heartbeat");

      expect(initEvent?.id).toBe("0");
      expect(heartbeatEvents.length).toBeGreaterThanOrEqual(1);
      // First heartbeat is immediate (id: 1), subsequent are from interval
      expect(heartbeatEvents[0]?.id).toBe("1");
    });
  });
});
