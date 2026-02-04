import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { createTaskRepository } from "../task/repository.ts";
import { createTaskEventEmitter, type TaskEvent } from "./task-events.ts";

describe("events/task-events", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = await createTestDb();
    await createTestRepo(db, "repo-1", "/test/repo");
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("task-created event", () => {
    test("emits event when task is created", async () => {
      const emitter = createTaskEventEmitter();
      const repo = createTaskRepository(db, { eventEmitter: emitter });
      const events: TaskEvent[] = [];
      emitter.subscribe((event) => events.push(event));

      const now = new Date().toISOString();
      await repo.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "changes/feat-1",
        status: "DRAFT",
        created_at: now,
        updated_at: now,
      });

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("task-created");
      if (events[0]?.type === "task-created") {
        expect(events[0].task.id).toBe("task-1");
      }
    });

    test("emits event when task is created via createIdempotent", async () => {
      const emitter = createTaskEventEmitter();
      const repo = createTaskRepository(db, { eventEmitter: emitter });
      const events: TaskEvent[] = [];
      emitter.subscribe((event) => events.push(event));

      const now = new Date().toISOString();
      await repo.createIdempotent({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "changes/feat-1",
        status: "DRAFT",
        created_at: now,
        updated_at: now,
      });

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("task-created");
    });

    test("does not emit event when createIdempotent finds existing task", async () => {
      const emitter = createTaskEventEmitter();
      const repo = createTaskRepository(db, { eventEmitter: emitter });

      const now = new Date().toISOString();
      await repo.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "changes/feat-1",
        status: "DRAFT",
        created_at: now,
        updated_at: now,
      });

      const events: TaskEvent[] = [];
      emitter.subscribe((event) => events.push(event));

      await repo.createIdempotent({
        id: "task-2",
        repo_id: "repo-1",
        change_path: "changes/feat-1",
        status: "READY",
        created_at: now,
        updated_at: now,
      });

      expect(events).toHaveLength(0);
    });
  });

  describe("task-status-changed event", () => {
    test("emits event when task status is updated", async () => {
      const emitter = createTaskEventEmitter();
      const repo = createTaskRepository(db, { eventEmitter: emitter });

      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");

      const events: TaskEvent[] = [];
      emitter.subscribe((event) => events.push(event));

      await repo.update("task-1", { status: "READY" });

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("task-status-changed");
      if (events[0]?.type === "task-status-changed") {
        expect(events[0].taskId).toBe("task-1");
        expect(events[0].previousStatus).toBe("DRAFT");
        expect(events[0].newStatus).toBe("READY");
      }
    });

    test("does not emit event when non-status field is updated", async () => {
      const emitter = createTaskEventEmitter();
      const repo = createTaskRepository(db, { eventEmitter: emitter });

      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");

      const events: TaskEvent[] = [];
      emitter.subscribe((event) => events.push(event));

      await repo.update("task-1", { worktree_path: "/path/to/worktree" });

      expect(events).toHaveLength(0);
    });

    test("emits event when task is marked removed", async () => {
      const emitter = createTaskEventEmitter();
      const repo = createTaskRepository(db, { eventEmitter: emitter });

      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");

      const events: TaskEvent[] = [];
      emitter.subscribe((event) => events.push(event));

      await repo.markRemoved("task-1");

      expect(events).toHaveLength(2);
      expect(events[0]?.type).toBe("task-status-changed");
      expect(events[1]?.type).toBe("task-removed");
    });

    test("emits events when stale working tasks are reset", async () => {
      const emitter = createTaskEventEmitter();
      const repo = createTaskRepository(db, { eventEmitter: emitter });

      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "WORKING");

      const events: TaskEvent[] = [];
      emitter.subscribe((event) => events.push(event));

      await repo.resetStaleWorkingTasks();

      expect(events).toHaveLength(2);
      expect(events.every((e) => e.type === "task-status-changed")).toBe(true);
    });
  });

  describe("subscribe/unsubscribe", () => {
    test("unsubscribe stops receiving events", async () => {
      const emitter = createTaskEventEmitter();
      const repo = createTaskRepository(db, { eventEmitter: emitter });
      const events: TaskEvent[] = [];

      const unsubscribe = emitter.subscribe((event) => events.push(event));

      const now = new Date().toISOString();
      await repo.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "changes/feat-1",
        status: "DRAFT",
        created_at: now,
        updated_at: now,
      });

      expect(events).toHaveLength(1);

      unsubscribe();

      await repo.create({
        id: "task-2",
        repo_id: "repo-1",
        change_path: "changes/feat-2",
        status: "DRAFT",
        created_at: now,
        updated_at: now,
      });

      expect(events).toHaveLength(1);
    });

    test("listenerCount returns correct count", () => {
      const emitter = createTaskEventEmitter();

      expect(emitter.listenerCount()).toBe(0);

      const unsubscribe1 = emitter.subscribe(() => {});
      expect(emitter.listenerCount()).toBe(1);

      const unsubscribe2 = emitter.subscribe(() => {});
      expect(emitter.listenerCount()).toBe(2);

      unsubscribe1();
      expect(emitter.listenerCount()).toBe(1);

      unsubscribe2();
      expect(emitter.listenerCount()).toBe(0);
    });
  });
});
