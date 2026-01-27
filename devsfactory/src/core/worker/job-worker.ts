import { EventEmitter } from "node:events";
import type { AgentRegistryEmitter } from "../interfaces/agent-registry";
import type { JobQueueEmitter } from "../interfaces/job-queue";
import type { HandlerRegistry } from "./handlers";

export interface JobWorkerConfig {
  maxConcurrentAgents: number;
  retryBackoff: {
    initialMs: number;
    maxMs: number;
    maxAttempts: number;
  };
}

export class JobWorker extends EventEmitter {
  private running = false;
  private processing = 0;
  private jobAvailableHandler = () => this.processNext();
  private capacityHandler = () => this.processNext();
  private attempts = new Map<string, number>();

  constructor(
    private queue: JobQueueEmitter,
    private registry: AgentRegistryEmitter,
    private handlers: HandlerRegistry,
    private config: JobWorkerConfig
  ) {
    super();
  }

  start(): void {
    this.running = true;
    this.queue.on("jobAvailable", this.jobAvailableHandler);
    this.registry.on("agentUnregistered", this.capacityHandler);
    this.processNext();
  }

  stop(): void {
    this.running = false;
    this.queue.off("jobAvailable", this.jobAvailableHandler);
    this.registry.off("agentUnregistered", this.capacityHandler);
  }

  isRunning(): boolean {
    return this.running;
  }

  private calculateBackoff(attempt: number): number {
    const delay = this.config.retryBackoff.initialMs * 2 ** (attempt - 1);
    return Math.min(delay, this.config.retryBackoff.maxMs);
  }

  private async processNext(): Promise<void> {
    if (!this.running) return;

    if (this.processing >= this.config.maxConcurrentAgents) return;

    const job = await this.queue.dequeue();
    if (!job) return;

    const handler = this.handlers.get(job.type);
    if (!handler) {
      await this.queue.ack(job.id);
      return;
    }

    this.processing++;
    try {
      const result = await handler.execute(job);

      if (result.success) {
        await this.queue.ack(job.id);
        this.attempts.delete(job.id);
        this.emit("jobCompleted", { jobId: job.id });
      } else {
        const attempt = (this.attempts.get(job.id) ?? 0) + 1;
        const maxAttempts = this.config.retryBackoff.maxAttempts;
        const shouldRequeue = result.requeue !== false && attempt < maxAttempts;

        if (shouldRequeue) {
          this.attempts.set(job.id, attempt);
          const nextRetryMs = this.calculateBackoff(attempt);

          this.emit("jobFailed", {
            jobId: job.id,
            error: result.error,
            attempt
          });
          this.emit("jobRetrying", { jobId: job.id, attempt, nextRetryMs });

          await this.queue.nack(job.id, true, nextRetryMs);
        } else {
          await this.queue.ack(job.id);
          this.attempts.delete(job.id);
          this.emit("jobFailed", {
            jobId: job.id,
            error: result.error,
            permanent: true,
            attempt
          });
        }
      }
    } finally {
      this.processing--;
      this.processNext();
    }
  }
}
