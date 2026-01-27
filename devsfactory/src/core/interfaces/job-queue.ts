import type { EventEmitter } from "node:events";
import type { Job } from "../types/job";

export interface JobQueue {
  enqueue(job: Job): Promise<void>;
  dequeue(): Promise<Job | undefined>;
  ack(jobId: string): Promise<void>;
  nack(jobId: string, requeue?: boolean, delayMs?: number): Promise<void>;
  peek(): Promise<Job | undefined>;
  size(): Promise<number>;
  has(key: string): Promise<boolean>;
}

export type JobQueueEmitter = JobQueue & EventEmitter;
