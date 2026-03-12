import { z } from "zod";

export const StepType = {
  IMPLEMENT: "implement",
  TEST: "test",
  REVIEW: "review",
  DEBUG: "debug",
  ITERATE: "iterate",
  RESEARCH: "research",
} as const;

export type StepType = (typeof StepType)[keyof typeof StepType];

const StepTypeEnum = z.enum(["implement", "test", "review", "debug", "iterate", "research"]);

const StepAgentProviderEnum = z.enum(["openai", "anthropic"]);
const StepAgentReasoningEnum = z.enum(["low", "medium", "high", "extra-high"]);

const OPENAI_WORKFLOW_MODELS = ["gpt-5.4", "gpt-5.3-codex"] as const;
const ANTHROPIC_WORKFLOW_MODELS = ["claude-opus-4-6", "claude-sonnet-4-6"] as const;

const isAllowedStepAgentModel = (provider: "openai" | "anthropic", model: string): boolean => {
  return provider === "openai"
    ? OPENAI_WORKFLOW_MODELS.some((allowedModel) => allowedModel === model)
    : ANTHROPIC_WORKFLOW_MODELS.some((allowedModel) => allowedModel === model);
};

export const StepAgentSchema = z
  .object({
    provider: StepAgentProviderEnum,
    model: z.string(),
    reasoning: StepAgentReasoningEnum,
  })
  .superRefine((agent, ctx) => {
    if (!isAllowedStepAgentModel(agent.provider, agent.model)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Model "${agent.model}" is not allowed for provider "${agent.provider}"`,
        path: ["model"],
      });
    }
  });

export type StepAgent = z.infer<typeof StepAgentSchema>;

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
  agent: StepAgentSchema.optional(),
  transitions: z.array(TransitionSchema),
  signals: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
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
export const TERMINAL_PAUSED = "__paused__" as const;

export const isTerminalState = (target: string): boolean =>
  target === TERMINAL_SUCCESS || target === TERMINAL_BLOCKED || target === TERMINAL_PAUSED;
