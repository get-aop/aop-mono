import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Job } from "../types/job";
import { getJobKey } from "../types/job";
import { MemoryQueue } from "./memory-queue";

const createJob = (overrides: Partial<Job> = {}): Job => ({
  id: `job-${Math.random().toString(36).slice(2)}`,
  type: "implementation",
  taskFolder: "test-task",
  status: "pending",
  priority: 0,
  createdAt: new Date(),
  ...overrides
});

describe("MemoryQueue", () => {
  let queue: MemoryQueue;

  beforeEach(() => {
    queue = new MemoryQueue();
  });

  afterEach(() => {
    queue.stop();
  });

  describe("enqueue/dequeue", () => {
    test("enqueue adds job and dequeue retrieves in FIFO order", async () => {
      const job1 = createJob({ id: "job-1", taskFolder: "task-1" });
      const job2 = createJob({ id: "job-2", taskFolder: "task-2" });

      await queue.enqueue(job1);
      await queue.enqueue(job2);

      const dequeued1 = await queue.dequeue();
      const dequeued2 = await queue.dequeue();

      expect(dequeued1?.id).toBe("job-1");
      expect(dequeued2?.id).toBe("job-2");
    });

    test("dequeue returns undefined when queue is empty", async () => {
      const result = await queue.dequeue();
      expect(result).toBeUndefined();
    });

    test("dequeue marks job as processing", async () => {
      const job = createJob();
      await queue.enqueue(job);

      const dequeued = await queue.dequeue();
      expect(dequeued?.status).toBe("running");
    });
  });

  describe("deduplication", () => {
    test("rejects duplicate jobs with same key", async () => {
      const job1 = createJob({
        id: "job-1",
        type: "implementation",
        taskFolder: "task-a"
      });
      const job2 = createJob({
        id: "job-2",
        type: "implementation",
        taskFolder: "task-a"
      });

      await queue.enqueue(job1);
      await queue.enqueue(job2);

      expect(await queue.size()).toBe(1);
    });

    test("allows jobs with different keys", async () => {
      const job1 = createJob({ taskFolder: "task-a" });
      const job2 = createJob({ taskFolder: "task-b" });

      await queue.enqueue(job1);
      await queue.enqueue(job2);

      expect(await queue.size()).toBe(2);
    });

    test("has() returns true for existing job key", async () => {
      const job = createJob({ type: "merge", taskFolder: "task-x" });
      await queue.enqueue(job);

      const key = getJobKey(job);
      expect(await queue.has(key)).toBe(true);
    });

    test("has() returns false for non-existent key", async () => {
      expect(await queue.has("nonexistent:key")).toBe(false);
    });

    test("has() returns true for processing job", async () => {
      const job = createJob({ type: "review", taskFolder: "task-y" });
      await queue.enqueue(job);
      await queue.dequeue();

      const key = getJobKey(job);
      expect(await queue.has(key)).toBe(true);
    });
  });

  describe("ack/nack", () => {
    test("ack removes job from processing", async () => {
      const job = createJob();
      await queue.enqueue(job);
      const dequeued = await queue.dequeue();

      await queue.ack(dequeued!.id);

      const key = getJobKey(job);
      expect(await queue.has(key)).toBe(false);
    });

    test("nack with requeue=true puts job back in queue", async () => {
      const job = createJob();
      await queue.enqueue(job);
      const dequeued = await queue.dequeue();

      await queue.nack(dequeued!.id, true);

      expect(await queue.size()).toBe(1);
      const requeued = await queue.dequeue();
      expect(requeued?.id).toBe(job.id);
    });

    test("nack with requeue=false removes job", async () => {
      const job = createJob();
      await queue.enqueue(job);
      const dequeued = await queue.dequeue();

      await queue.nack(dequeued!.id, false);

      expect(await queue.size()).toBe(0);
      const key = getJobKey(job);
      expect(await queue.has(key)).toBe(false);
    });

    test("nack defaults to not requeue", async () => {
      const job = createJob();
      await queue.enqueue(job);
      const dequeued = await queue.dequeue();

      await queue.nack(dequeued!.id);

      expect(await queue.size()).toBe(0);
    });
  });

  describe("peek", () => {
    test("peek returns next job without removing", async () => {
      const job = createJob();
      await queue.enqueue(job);

      const peeked = await queue.peek();
      expect(peeked?.id).toBe(job.id);

      expect(await queue.size()).toBe(1);
    });

    test("peek returns undefined when empty", async () => {
      const result = await queue.peek();
      expect(result).toBeUndefined();
    });
  });

  describe("size", () => {
    test("returns count of pending jobs only", async () => {
      await queue.enqueue(createJob({ id: "j1" }));
      await queue.enqueue(createJob({ id: "j2", taskFolder: "t2" }));
      await queue.dequeue();

      expect(await queue.size()).toBe(1);
    });
  });

  describe("events", () => {
    test("emits jobAvailable when job enqueued", async () => {
      const events: Job[] = [];
      queue.on("jobAvailable", (job) => events.push(job));

      const job = createJob();
      await queue.enqueue(job);

      expect(events).toHaveLength(1);
      expect(events[0]!.id).toBe(job.id);
    });

    test("does not emit jobAvailable for duplicate", async () => {
      const events: Job[] = [];
      queue.on("jobAvailable", (job) => events.push(job));

      const job1 = createJob({ taskFolder: "same" });
      const job2 = createJob({ taskFolder: "same" });
      await queue.enqueue(job1);
      await queue.enqueue(job2);

      expect(events).toHaveLength(1);
    });
  });

  describe("delayed jobs", () => {
    test("enqueueDelayed schedules job for later", async () => {
      const job = createJob();
      await queue.enqueueDelayed(job, 50);

      expect(await queue.size()).toBe(0);
      expect(await queue.has(getJobKey(job))).toBe(true);

      await new Promise((r) => setTimeout(r, 100));
      expect(await queue.size()).toBe(1);
    });

    test("delayed job emits jobAvailable when ready", async () => {
      const events: Job[] = [];
      queue.on("jobAvailable", (j) => events.push(j));

      const job = createJob();
      await queue.enqueueDelayed(job, 30);

      expect(events).toHaveLength(0);
      await new Promise((r) => setTimeout(r, 60));
      expect(events).toHaveLength(1);
    });

    test("stop() clears delayed job timers", async () => {
      const job = createJob();
      await queue.enqueueDelayed(job, 100);

      queue.stop();
      await new Promise((r) => setTimeout(r, 150));

      expect(await queue.size()).toBe(0);
    });
  });
});
