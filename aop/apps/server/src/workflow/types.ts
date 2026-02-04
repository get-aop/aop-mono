import { z } from "zod";

export const StepType = {
  IMPLEMENT: "implement",
  TEST: "test",
  REVIEW: "review",
  DEBUG: "debug",
  ITERATE: "iterate",
} as const;

export type StepType = (typeof StepType)[keyof typeof StepType];

const StepTypeEnum = z.enum(["implement", "test", "review", "debug", "iterate"]);

export const TransitionCondition = {
  SUCCESS: "success",
  FAILURE: "failure",
  NONE: "__none__",
} as const;

export type TransitionCondition = (typeof TransitionCondition)[keyof typeof TransitionCondition];

export const TransitionSchema = z.object({
  condition: z.string(),
  target: z.string(),
  maxIterations: z.number().int().positive().optional(),
  onMaxIterations: z.string().optional(),
  afterIteration: z.number().int().nonnegative().optional(),
  thenTarget: z.string().optional(),
});

export type Transition = z.infer<typeof TransitionSchema>;

export const WorkflowStepSchema = z.object({
  id: z.string(),
  type: StepTypeEnum,
  promptTemplate: z.string(),
  maxAttempts: z.number().int().positive().default(1),
  transitions: z.array(TransitionSchema),
  signals: z.array(z.string()).optional(),
});

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowDefinitionSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  initialStep: z.string(),
  steps: z.record(z.string(), WorkflowStepSchema),
  terminalStates: z.array(z.string()),
});

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

export const TERMINAL_SUCCESS = "__done__" as const;
export const TERMINAL_BLOCKED = "__blocked__" as const;

export const isTerminalState = (target: string): boolean =>
  target === TERMINAL_SUCCESS || target === TERMINAL_BLOCKED;
