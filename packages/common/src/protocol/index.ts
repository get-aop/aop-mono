import { z } from "zod";
import type { TaskStatus } from "../types/task";

export const ExecutionStatus = {
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  ABORTED: "aborted",
  CANCELLED: "cancelled",
} as const;

export type ExecutionStatus = (typeof ExecutionStatus)[keyof typeof ExecutionStatus];

export const StepExecutionStatus = {
  RUNNING: "running",
  SUCCESS: "success",
  FAILURE: "failure",
  CANCELLED: "cancelled",
  AWAITING_INPUT: "awaiting_input",
} as const;

export type StepExecutionStatus = (typeof StepExecutionStatus)[keyof typeof StepExecutionStatus];

export const ErrorCode = {
  AGENT_TIMEOUT: "agent_timeout",
  AGENT_CRASH: "agent_crash",
  SCRIPT_FAILED: "script_failed",
  ABORTED: "aborted",
  MAX_RETRIES_EXCEEDED: "max_retries_exceeded",
  PROMPT_NOT_FOUND: "prompt_not_found",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const AbortReason = {
  TASK_REMOVED: "task_removed",
  CHANGE_FILES_DELETED: "change_files_deleted",
} as const;

export type AbortReason = (typeof AbortReason)[keyof typeof AbortReason];

export type { TaskStatus };
const TaskStatusEnum = z.enum([
  "DRAFT",
  "READY",
  "RESUMING",
  "WORKING",
  "PAUSED",
  "BLOCKED",
  "DONE",
  "REMOVED",
]);

const ErrorCodeEnum = z.enum([
  "agent_timeout",
  "agent_crash",
  "script_failed",
  "aborted",
  "max_retries_exceeded",
  "prompt_not_found",
]);

const AbortReasonEnum = z.enum(["task_removed", "change_files_deleted"]);

export const AuthRequestSchema = z.object({
  requestedMaxConcurrentTasks: z.number().int().positive().optional(),
});

export type AuthRequest = z.infer<typeof AuthRequestSchema>;

export const AuthResponseSchema = z.object({
  clientId: z.string(),
  effectiveMaxConcurrentTasks: z.number().int().positive(),
});

export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const TaskReadyRequestSchema = z.object({
  repoId: z.string(),
  workflowName: z.string().optional(),
  retryFromStep: z.string().optional(),
});

export type TaskReadyRequest = z.infer<typeof TaskReadyRequestSchema>;

export const SignalDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export type SignalDefinition = z.infer<typeof SignalDefinitionSchema>;

export const StepCommandSchema = z.object({
  id: z.string(),
  type: z.string(),
  stepId: z.string().optional(),
  promptTemplate: z.string(),
  attempt: z.number().int().positive(),
  signals: z.array(SignalDefinitionSchema).optional(),
  iteration: z.number().int().nonnegative(),
  input: z.string().optional(),
});

export type StepCommand = z.infer<typeof StepCommandSchema>;

export const ExecutionInfoSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
});

export type ExecutionInfo = z.infer<typeof ExecutionInfoSchema>;

export const TaskReadyResponseSchema = z.object({
  status: TaskStatusEnum,
  execution: ExecutionInfoSchema.optional(),
  step: StepCommandSchema.optional(),
  queued: z.boolean().optional(),
  message: z.string().optional(),
});

export type TaskReadyResponse = z.infer<typeof TaskReadyResponseSchema>;

const StepErrorSchema = z.object({
  code: ErrorCodeEnum,
  message: z.string(),
  reason: AbortReasonEnum.optional(),
});

export type StepError = z.infer<typeof StepErrorSchema>;

export const StepCompleteRequestSchema = z.object({
  executionId: z.string(),
  attempt: z.number().int().positive(),
  status: z.enum(["success", "failure"]),
  signal: z.string().optional(),
  error: StepErrorSchema.optional(),
  durationMs: z.number().int().nonnegative(),
  pauseContext: z.string().optional(),
});

export type StepCompleteRequest = z.infer<typeof StepCompleteRequestSchema>;

export const StepResumeRequestSchema = z.object({
  input: z.string(),
});

export type StepResumeRequest = z.infer<typeof StepResumeRequestSchema>;

export const StepCompleteResponseSchema = z.object({
  taskStatus: TaskStatusEnum,
  step: StepCommandSchema.nullable(),
  execution: ExecutionInfoSchema.optional(),
  error: StepErrorSchema.optional(),
});

export type StepCompleteResponse = z.infer<typeof StepCompleteResponseSchema>;

const TaskExecutionStatusSchema = z.object({
  id: z.string(),
  currentStepId: z.string().optional(),
  awaitingResult: z.boolean(),
});

export const TaskStatusResponseSchema = z.object({
  status: TaskStatusEnum,
  execution: TaskExecutionStatusSchema.optional(),
});

export type TaskStatusResponse = z.infer<typeof TaskStatusResponseSchema>;
