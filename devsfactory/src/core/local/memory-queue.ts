import { EventEmitter } from "node:events";
import type { JobQueue } from "../interfaces/job-queue";
import type { Job } from "../types/job";
import { getJobKey } from "../types/job";

export class MemoryQueue extends EventEmitter implements JobQueue {
  private pending: Job[] = [];
  private processing: Map<string, Job> = new Map();
  private keys: Set<string> = new Set();
  private delayedTimers: Map<string, Timer> = new Map();

  async enqueue(job: Job): Promise<void> {
    const key = getJobKey(job);
    if (this.keys.has(key)) {
      return;
    }

    this.keys.add(key);
    this.pending.push(job);
    this.emit("jobAvailable", job);
  }

  async enqueueDelayed(job: Job, delayMs: number): Promise<void> {
    const key = getJobKey(job);
    if (this.keys.has(key)) {
      return;
    }

    this.keys.add(key);
    const timer = setTimeout(() => {
      this.delayedTimers.delete(key);
      this.pending.push(job);
      this.emit("jobAvailable", job);
    }, delayMs);

    this.delayedTimers.set(key, timer);
  }

  async dequeue(): Promise<Job | undefined> {
    const index = this.findHighestPriorityIndex();
    if (index === -1) {
      return undefined;
    }

    const job = this.pending[index]!;
    this.pending.splice(index, 1);
    const runningJob = { ...job, status: "running" as const };
    this.processing.set(job.id, runningJob);
    return runningJob;
  }

  async ack(jobId: string): Promise<void> {
    const job = this.processing.get(jobId);
    if (job) {
      const key = getJobKey(job);
      this.keys.delete(key);
      this.processing.delete(jobId);
    }
  }

  async nack(
    jobId: string,
    requeue?: boolean,
    delayMs?: number
  ): Promise<void> {
    const job = this.processing.get(jobId);
    if (!job) {
      return;
    }

    this.processing.delete(jobId);

    if (requeue) {
      const requeuedJob = { ...job, status: "pending" as const };
      if (delayMs && delayMs > 0) {
        const key = getJobKey(job);
        const timer = setTimeout(() => {
          this.delayedTimers.delete(key);
          this.pending.push(requeuedJob);
          this.emit("jobAvailable", requeuedJob);
        }, delayMs);
        this.delayedTimers.set(key, timer);
      } else {
        this.pending.push(requeuedJob);
      }
    } else {
      const key = getJobKey(job);
      this.keys.delete(key);
    }
  }

  async peek(): Promise<Job | undefined> {
    const index = this.findHighestPriorityIndex();
    return index === -1 ? undefined : this.pending[index];
  }

  async size(): Promise<number> {
    return this.pending.length;
  }

  async has(key: string): Promise<boolean> {
    return this.keys.has(key);
  }

  stop(): void {
    for (const timer of this.delayedTimers.values()) {
      clearTimeout(timer);
    }
    this.delayedTimers.clear();
  }

  private findHighestPriorityIndex(): number {
    if (this.pending.length === 0) {
      return -1;
    }

    let highestIndex = 0;
    let highestPriority = this.pending[0]!.priority;

    for (let i = 1; i < this.pending.length; i++) {
      const job = this.pending[i]!;
      if (job.priority > highestPriority) {
        highestPriority = job.priority;
        highestIndex = i;
      }
    }

    return highestIndex;
  }
}
