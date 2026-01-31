import { z } from "zod";

export const JobTypeSchema = z.enum([
  "implementation",
  "review",
  "completing-task",
  "completion-review",
  "merge",
  "conflict-solver",
  "migrate-worktree"
]);

export const JobStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed"
]);

export const JobSchema = z.object({
  id: z.string(),
  type: JobTypeSchema,
  taskFolder: z.string(),
  subtaskFile: z.string().optional(),
  status: JobStatusSchema.default("pending"),
  priority: z.number().default(0),
  createdAt: z.coerce.date()
});

export const JobResultSchema = z.object({
  jobId: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
  requeue: z.boolean().optional()
});

export type JobType = z.infer<typeof JobTypeSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type Job = z.infer<typeof JobSchema>;
export type JobResult = z.infer<typeof JobResultSchema>;

export const JOB_PRIORITY: Record<JobType, number> = {
  "migrate-worktree": 50,
  "conflict-solver": 40,
  merge: 30,
  "completion-review": 25,
  review: 20,
  "completing-task": 15,
  implementation: 10
} as const;

export const getJobKey = (job: Job): string => {
  const base = `${job.type}:${job.taskFolder}`;
  return job.subtaskFile ? `${base}:${job.subtaskFile}` : base;
};
