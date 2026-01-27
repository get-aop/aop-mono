import { describe, expect, test } from "bun:test";
import type { Job } from "../types/job";
import type { JobQueue } from "./job-queue";

const createMockJob = (overrides: Partial<Job> = {}): Job => ({
  id: `job-${Math.random().toString(36).slice(2)}`,
  type: "implementation",
  taskFolder: "test-task",
  status: "pending",
  priority: 0,
  createdAt: new Date(),
  ...overrides
});

describe("JobQueue interface", () => {
  test("interface has all required methods", () => {
    const queue: JobQueue = {
      enqueue: async () => {},
      dequeue: async () => undefined,
      ack: async () => {},
      nack: async () => {},
      peek: async () => undefined,
      size: async () => 0,
      has: async () => false
    };

    expect(typeof queue.enqueue).toBe("function");
    expect(typeof queue.dequeue).toBe("function");
    expect(typeof queue.ack).toBe("function");
    expect(typeof queue.nack).toBe("function");
    expect(typeof queue.peek).toBe("function");
    expect(typeof queue.size).toBe("function");
    expect(typeof queue.has).toBe("function");
  });

  test("enqueue accepts a Job", async () => {
    let enqueuedJob: Job | undefined;
    const queue: JobQueue = {
      enqueue: async (job) => {
        enqueuedJob = job;
      },
      dequeue: async () => undefined,
      ack: async () => {},
      nack: async () => {},
      peek: async () => undefined,
      size: async () => 0,
      has: async () => false
    };

    const job = createMockJob();
    await queue.enqueue(job);
    expect(enqueuedJob).toEqual(job);
  });

  test("dequeue returns Job or undefined", async () => {
    const job = createMockJob();
    const queue: JobQueue = {
      enqueue: async () => {},
      dequeue: async () => job,
      ack: async () => {},
      nack: async () => {},
      peek: async () => undefined,
      size: async () => 0,
      has: async () => false
    };

    const result = await queue.dequeue();
    expect(result).toEqual(job);
  });

  test("ack accepts jobId string", async () => {
    let ackedId: string | undefined;
    const queue: JobQueue = {
      enqueue: async () => {},
      dequeue: async () => undefined,
      ack: async (jobId) => {
        ackedId = jobId;
      },
      nack: async () => {},
      peek: async () => undefined,
      size: async () => 0,
      has: async () => false
    };

    await queue.ack("job-123");
    expect(ackedId).toBe("job-123");
  });

  test("nack accepts jobId and optional requeue flag", async () => {
    let nackedId: string | undefined;
    let nackedRequeue: boolean | undefined;
    const queue: JobQueue = {
      enqueue: async () => {},
      dequeue: async () => undefined,
      ack: async () => {},
      nack: async (jobId, requeue) => {
        nackedId = jobId;
        nackedRequeue = requeue;
      },
      peek: async () => undefined,
      size: async () => 0,
      has: async () => false
    };

    await queue.nack("job-456", true);
    expect(nackedId).toBe("job-456");
    expect(nackedRequeue).toBe(true);
  });

  test("peek returns Job or undefined without removing", async () => {
    const job = createMockJob();
    const queue: JobQueue = {
      enqueue: async () => {},
      dequeue: async () => undefined,
      ack: async () => {},
      nack: async () => {},
      peek: async () => job,
      size: async () => 1,
      has: async () => false
    };

    const result = await queue.peek();
    expect(result).toEqual(job);
  });

  test("size returns number of pending jobs", async () => {
    const queue: JobQueue = {
      enqueue: async () => {},
      dequeue: async () => undefined,
      ack: async () => {},
      nack: async () => {},
      peek: async () => undefined,
      size: async () => 42,
      has: async () => false
    };

    const result = await queue.size();
    expect(result).toBe(42);
  });

  test("has checks if job key exists", async () => {
    let checkedKey: string | undefined;
    const queue: JobQueue = {
      enqueue: async () => {},
      dequeue: async () => undefined,
      ack: async () => {},
      nack: async () => {},
      peek: async () => undefined,
      size: async () => 0,
      has: async (key) => {
        checkedKey = key;
        return true;
      }
    };

    const result = await queue.has("implementation:task-x:001.md");
    expect(checkedKey).toBe("implementation:task-x:001.md");
    expect(result).toBe(true);
  });
});
