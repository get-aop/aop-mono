import { beforeEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { AgentRegistry, RunningAgent } from "../interfaces/agent-registry";
import type { JobQueue } from "../interfaces/job-queue";
import type { Job, JobResult } from "../types/job";
import type { HandlerRegistry, JobHandler } from "./handlers";
import { JobWorker, type JobWorkerConfig } from "./job-worker";

interface JobCompletedEvent {
  jobId: string;
  job: Job;
  durationMs: number;
}

interface JobFailedEvent {
  jobId: string;
  error?: string;
  attempt?: number;
}

interface JobRetryingEvent {
  jobId: string;
  attempt: number;
  nextRetryMs: number;
}

const createJob = (overrides: Partial<Job> = {}): Job => ({
  id: "job-1",
  type: "implementation",
  taskFolder: "task-1",
  status: "pending",
  priority: 0,
  createdAt: new Date(),
  ...overrides
});

class MockQueue extends EventEmitter implements JobQueue {
  jobs: Job[] = [];
  processing = new Map<string, Job>();

  async enqueue(job: Job): Promise<void> {
    this.jobs.push(job);
    this.emit("jobAvailable", job);
  }
  async dequeue(): Promise<Job | undefined> {
    const job = this.jobs.shift();
    if (job) this.processing.set(job.id, job);
    return job;
  }
  async ack(jobId: string): Promise<void> {
    this.processing.delete(jobId);
  }
  async nack(
    jobId: string,
    requeue?: boolean,
    _delayMs?: number
  ): Promise<void> {
    const job = this.processing.get(jobId);
    this.processing.delete(jobId);
    if (requeue && job) {
      this.jobs.push(job);
      this.emit("jobAvailable", job);
    }
  }
  async peek(): Promise<Job | undefined> {
    return this.jobs[0];
  }
  async size(): Promise<number> {
    return this.jobs.length;
  }
  async has(_key: string): Promise<boolean> {
    return false;
  }
}

class MockRegistry extends EventEmitter implements AgentRegistry {
  agents = new Map<string, RunningAgent>();

  async register(agent: RunningAgent): Promise<void> {
    this.agents.set(agent.jobId, agent);
    this.emit("agentRegistered", agent);
  }
  async unregister(jobId: string): Promise<void> {
    this.agents.delete(jobId);
    this.emit("agentUnregistered", { jobId });
  }
  async get(jobId: string): Promise<RunningAgent | undefined> {
    return this.agents.get(jobId);
  }
  async getByTask(): Promise<RunningAgent[]> {
    return [];
  }
  async getBySubtask(): Promise<RunningAgent | undefined> {
    return undefined;
  }
  async getAll(): Promise<RunningAgent[]> {
    return Array.from(this.agents.values());
  }
  async count(): Promise<number> {
    return this.agents.size;
  }
}

class MockHandlerRegistry implements HandlerRegistry {
  handler: JobHandler = {
    execute: async (job: Job): Promise<JobResult> => ({
      jobId: job.id,
      success: true
    })
  };

  get() {
    return this.handler;
  }
}

describe("JobWorker", () => {
  let queue: MockQueue;
  let registry: MockRegistry;
  let handlers: MockHandlerRegistry;
  let config: JobWorkerConfig;

  beforeEach(() => {
    queue = new MockQueue();
    registry = new MockRegistry();
    handlers = new MockHandlerRegistry();
    config = {
      maxConcurrentAgents: 3,
      retryBackoff: { initialMs: 100, maxMs: 1000, maxAttempts: 5 }
    };
  });

  describe("lifecycle", () => {
    test("can be instantiated with required dependencies", () => {
      const worker = new JobWorker(queue, registry, handlers, config);
      expect(worker).toBeDefined();
    });

    test("start begins processing and stop ends it", async () => {
      const worker = new JobWorker(queue, registry, handlers, config);

      worker.start();
      expect(worker.isRunning()).toBe(true);

      worker.stop();
      expect(worker.isRunning()).toBe(false);
    });

    test("can restart after stopping", async () => {
      const worker = new JobWorker(queue, registry, handlers, config);

      worker.start();
      worker.stop();
      worker.start();

      expect(worker.isRunning()).toBe(true);
      worker.stop();
    });
  });

  describe("job processing", () => {
    test("processes job when available in queue", async () => {
      const job = createJob();
      let executedJob: Job | null = null;
      handlers.handler = {
        execute: async (j: Job) => {
          executedJob = j;
          return { jobId: j.id, success: true };
        }
      };

      const worker = new JobWorker(queue, registry, handlers, config);
      worker.start();

      await queue.enqueue(job);
      await new Promise((r) => setTimeout(r, 10));

      expect(executedJob).not.toBeNull();
      expect(executedJob!.id).toBe(job.id);

      worker.stop();
    });

    test("acks job on successful execution", async () => {
      const job = createJob();
      handlers.handler = {
        execute: async (j: Job) => ({ jobId: j.id, success: true })
      };

      const worker = new JobWorker(queue, registry, handlers, config);
      worker.start();

      await queue.enqueue(job);
      await new Promise((r) => setTimeout(r, 10));

      expect(queue.processing.size).toBe(0);
      expect(queue.jobs.length).toBe(0);

      worker.stop();
    });

    test("emits jobCompleted on successful execution", async () => {
      const job = createJob();
      handlers.handler = {
        execute: async (j: Job) => ({ jobId: j.id, success: true })
      };

      const worker = new JobWorker(queue, registry, handlers, config);
      const events: JobCompletedEvent[] = [];
      worker.on("jobCompleted", (e) => events.push(e));

      worker.start();
      await queue.enqueue(job);
      await new Promise((r) => setTimeout(r, 10));

      expect(events.length).toBe(1);
      expect(events[0]!.jobId).toBe(job.id);

      worker.stop();
    });

    test("jobCompleted event includes job object and duration", async () => {
      const job = createJob({ id: "timing-job" });
      handlers.handler = {
        execute: async (j: Job) => {
          await new Promise((r) => setTimeout(r, 50));
          return { jobId: j.id, success: true };
        }
      };

      const worker = new JobWorker(queue, registry, handlers, config);
      const events: JobCompletedEvent[] = [];
      worker.on("jobCompleted", (e) => events.push(e));

      worker.start();
      await queue.enqueue(job);
      await new Promise((r) => setTimeout(r, 100));

      expect(events.length).toBe(1);
      expect(events[0]!.job).toBeDefined();
      expect(events[0]!.job.id).toBe(job.id);
      expect(events[0]!.job.type).toBe(job.type);
      expect(events[0]!.job.taskFolder).toBe(job.taskFolder);
      expect(typeof events[0]!.durationMs).toBe("number");
      expect(events[0]!.durationMs).toBeGreaterThanOrEqual(40);

      worker.stop();
    });

    test("emits jobFailed on failed execution", async () => {
      const job = createJob();
      handlers.handler = {
        execute: async (j: Job) => ({
          jobId: j.id,
          success: false,
          error: "Test error",
          requeue: false
        })
      };

      const worker = new JobWorker(queue, registry, handlers, config);
      const events: JobFailedEvent[] = [];
      worker.on("jobFailed", (e) => events.push(e));

      worker.start();
      await queue.enqueue(job);
      await new Promise((r) => setTimeout(r, 10));

      expect(events.length).toBe(1);
      expect(events[0]!.jobId).toBe(job.id);
      expect(events[0]!.error).toBe("Test error");

      worker.stop();
    });

    test("emits jobRetrying when job is requeued", async () => {
      const job = createJob();
      let execCount = 0;
      handlers.handler = {
        execute: async (j: Job) => {
          execCount++;
          if (execCount === 1) {
            return {
              jobId: j.id,
              success: false,
              error: "Temporary failure",
              requeue: true
            };
          }
          return { jobId: j.id, success: true };
        }
      };

      const worker = new JobWorker(queue, registry, handlers, config);
      const events: JobRetryingEvent[] = [];
      worker.on("jobRetrying", (e) => events.push(e));

      worker.start();
      await queue.enqueue(job);
      await new Promise((r) => setTimeout(r, 50));

      expect(events.length).toBe(1);
      expect(events[0]!.jobId).toBe(job.id);
      expect(events[0]!.attempt).toBe(1);

      worker.stop();
    });
  });

  describe("permanent failure", () => {
    test("acks job when requeue=false (permanent failure)", async () => {
      const job = createJob();
      handlers.handler = {
        execute: async (j: Job) => ({
          jobId: j.id,
          success: false,
          error: "Permanent failure",
          requeue: false
        })
      };

      const worker = new JobWorker(queue, registry, handlers, config);
      const failedEvents: JobFailedEvent[] = [];
      const retryEvents: JobRetryingEvent[] = [];
      worker.on("jobFailed", (e) => failedEvents.push(e));
      worker.on("jobRetrying", (e) => retryEvents.push(e));

      worker.start();
      await queue.enqueue(job);
      await new Promise((r) => setTimeout(r, 10));

      expect(failedEvents.length).toBe(1);
      expect(retryEvents.length).toBe(0);
      expect(queue.processing.size).toBe(0);
      expect(queue.jobs.length).toBe(0);

      worker.stop();
    });

    test("retries job when requeue=true", async () => {
      const job = createJob();
      let execCount = 0;
      handlers.handler = {
        execute: async (j: Job) => {
          execCount++;
          if (execCount < 2) {
            return {
              jobId: j.id,
              success: false,
              error: "Temporary",
              requeue: true
            };
          }
          return { jobId: j.id, success: true };
        }
      };

      const worker = new JobWorker(queue, registry, handlers, config);
      const retryEvents: JobRetryingEvent[] = [];
      const completedEvents: JobCompletedEvent[] = [];
      worker.on("jobRetrying", (e) => retryEvents.push(e));
      worker.on("jobCompleted", (e) => completedEvents.push(e));

      worker.start();
      await queue.enqueue(job);
      await new Promise((r) => setTimeout(r, 50));

      expect(retryEvents.length).toBe(1);
      expect(completedEvents.length).toBe(1);

      worker.stop();
    });

    test("defaults to requeue=true when not specified", async () => {
      const job = createJob();
      let execCount = 0;
      handlers.handler = {
        execute: async (j: Job) => {
          execCount++;
          if (execCount < 2) {
            return { jobId: j.id, success: false, error: "fail" };
          }
          return { jobId: j.id, success: true };
        }
      };

      const worker = new JobWorker(queue, registry, handlers, config);
      const retryEvents: JobRetryingEvent[] = [];
      worker.on("jobRetrying", (e) => retryEvents.push(e));

      worker.start();
      await queue.enqueue(job);
      await new Promise((r) => setTimeout(r, 50));

      expect(retryEvents.length).toBe(1);

      worker.stop();
    });
  });

  describe("capacity management", () => {
    test("waits when at capacity before dequeuing", async () => {
      config.maxConcurrentAgents = 1;
      const job1 = createJob({ id: "job-1" });
      const job2 = createJob({ id: "job-2" });
      const executionOrder: string[] = [];
      let job1Resolve: () => void;
      const job1Promise = new Promise<void>((r) => {
        job1Resolve = r;
      });

      handlers.handler = {
        execute: async (j: Job) => {
          executionOrder.push(j.id);
          if (j.id === "job-1") {
            await job1Promise;
          }
          return { jobId: j.id, success: true };
        }
      };

      const worker = new JobWorker(queue, registry, handlers, config);
      worker.start();

      await queue.enqueue(job1);
      await new Promise((r) => setTimeout(r, 10));

      await queue.enqueue(job2);
      await new Promise((r) => setTimeout(r, 10));

      expect(executionOrder).toEqual(["job-1"]);

      job1Resolve!();
      await new Promise((r) => setTimeout(r, 10));

      expect(executionOrder).toEqual(["job-1", "job-2"]);

      worker.stop();
    });

    test("processes next job when capacity becomes available", async () => {
      config.maxConcurrentAgents = 1;
      const job1 = createJob({ id: "job-1" });
      const job2 = createJob({ id: "job-2" });
      const completed: string[] = [];

      handlers.handler = {
        execute: async (j: Job) => {
          return { jobId: j.id, success: true };
        }
      };

      const worker = new JobWorker(queue, registry, handlers, config);
      worker.on("jobCompleted", (e) => completed.push(e.jobId));
      worker.start();

      await queue.enqueue(job1);
      await queue.enqueue(job2);
      await new Promise((r) => setTimeout(r, 50));

      expect(completed).toContain("job-1");
      expect(completed).toContain("job-2");

      worker.stop();
    });
  });

  describe("backoff calculation", () => {
    test("calculates exponential backoff: initialMs * 2^(attempt-1)", async () => {
      const job = createJob();
      let execCount = 0;
      handlers.handler = {
        execute: async (j: Job) => {
          execCount++;
          if (execCount === 1) {
            return {
              jobId: j.id,
              success: false,
              error: "fail",
              requeue: true
            };
          }
          return { jobId: j.id, success: true };
        }
      };

      const worker = new JobWorker(queue, registry, handlers, config);
      const events: JobRetryingEvent[] = [];
      worker.on("jobRetrying", (e) => events.push(e));

      worker.start();
      await queue.enqueue(job);
      await new Promise((r) => setTimeout(r, 50));

      expect(events[0]!.nextRetryMs).toBe(100);

      worker.stop();
    });

    test("caps backoff at maxMs", async () => {
      config.retryBackoff = { initialMs: 500, maxMs: 1000, maxAttempts: 5 };
      const job = createJob();
      let attempt = 0;
      handlers.handler = {
        execute: async (j: Job) => {
          attempt++;
          if (attempt < 4) {
            return {
              jobId: j.id,
              success: false,
              error: "fail",
              requeue: true
            };
          }
          return { jobId: j.id, success: true };
        }
      };

      const worker = new JobWorker(queue, registry, handlers, config);
      const events: JobRetryingEvent[] = [];
      worker.on("jobRetrying", (e) => events.push(e));

      worker.start();
      await queue.enqueue(job);
      await new Promise((r) => setTimeout(r, 100));

      const lastEvent = events[events.length - 1];
      expect(lastEvent!.nextRetryMs).toBeLessThanOrEqual(1000);

      worker.stop();
    });

    test("tracks attempts per job id", async () => {
      const job = createJob();
      let execCount = 0;
      handlers.handler = {
        execute: async (j: Job) => {
          execCount++;
          if (execCount < 3)
            return { jobId: j.id, success: false, error: "fail" };
          return { jobId: j.id, success: true };
        }
      };

      const worker = new JobWorker(queue, registry, handlers, config);
      const retryEvents: JobRetryingEvent[] = [];
      const completedEvents: JobCompletedEvent[] = [];
      worker.on("jobRetrying", (e) => retryEvents.push(e));
      worker.on("jobCompleted", (e) => completedEvents.push(e));

      worker.start();
      await queue.enqueue(job);
      await new Promise((r) => setTimeout(r, 50));

      expect(retryEvents.length).toBe(2);
      expect(retryEvents[0]!.attempt).toBe(1);
      expect(retryEvents[1]!.attempt).toBe(2);
      expect(completedEvents.length).toBe(1);

      worker.stop();
    });
  });

  describe("max attempts", () => {
    test("stops retrying after maxAttempts is reached", async () => {
      config.retryBackoff = { initialMs: 10, maxMs: 100, maxAttempts: 3 };
      const job = createJob();
      handlers.handler = {
        execute: async (j: Job) => ({
          jobId: j.id,
          success: false,
          error: "Always fails"
        })
      };

      const worker = new JobWorker(queue, registry, handlers, config);
      const retryEvents: JobRetryingEvent[] = [];
      const failedEvents: JobFailedEvent[] = [];
      worker.on("jobRetrying", (e) => retryEvents.push(e));
      worker.on("jobFailed", (e) => failedEvents.push(e));

      worker.start();
      await queue.enqueue(job);
      await new Promise((r) => setTimeout(r, 100));

      expect(retryEvents.length).toBe(2);
      expect(failedEvents.length).toBe(3);
      const permanentFailure = failedEvents.find(
        (e) => (e as { permanent?: boolean }).permanent
      );
      expect(permanentFailure).toBeDefined();

      worker.stop();
    });

    test("respects maxAttempts boundary exactly", async () => {
      config.retryBackoff = { initialMs: 10, maxMs: 100, maxAttempts: 2 };
      const job = createJob();
      let execCount = 0;
      handlers.handler = {
        execute: async (j: Job) => {
          execCount++;
          return { jobId: j.id, success: false, error: "fail" };
        }
      };

      const worker = new JobWorker(queue, registry, handlers, config);
      worker.start();
      await queue.enqueue(job);
      await new Promise((r) => setTimeout(r, 100));

      expect(execCount).toBe(2);
      worker.stop();
    });
  });
});
