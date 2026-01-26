import { z } from "zod";

// Status Enums
export const TaskStatusSchema = z.enum([
  "DRAFT",
  "BACKLOG",
  "PENDING",
  "INPROGRESS",
  "BLOCKED",
  "REVIEW",
  "DONE"
]);

export const SubtaskStatusSchema = z.enum([
  "PENDING",
  "INPROGRESS",
  "AGENT_REVIEW",
  "DONE",
  "BLOCKED"
]);

export const PlanStatusSchema = z.enum(["INPROGRESS", "BLOCKED", "REVIEW"]);

export const PrioritySchema = z.enum(["high", "medium", "low"]);

export const AgentTypeSchema = z.enum(["planning", "implementation", "review"]);

// Frontmatter Schemas
export const TaskFrontmatterSchema = z.object({
  title: z.string(),
  status: TaskStatusSchema,
  created: z.coerce.date(),
  priority: PrioritySchema,
  tags: z.array(z.string()).default([]),
  assignee: z.string().nullable().default(null),
  dependencies: z.array(z.string()).default([])
});

export const PlanFrontmatterSchema = z.object({
  status: PlanStatusSchema,
  task: z.string(),
  created: z.coerce.date()
});

export const SubtaskFrontmatterSchema = z.object({
  title: z.string(),
  status: SubtaskStatusSchema,
  dependencies: z.array(z.number()).default([])
});

// Entity Schemas
export const SubtaskReferenceSchema = z.object({
  number: z.number(),
  slug: z.string(),
  title: z.string(),
  dependencies: z.array(z.number())
});

export const TaskSchema = z.object({
  folder: z.string(),
  frontmatter: TaskFrontmatterSchema,
  description: z.string(),
  requirements: z.string(),
  acceptanceCriteria: z.array(
    z.object({
      text: z.string(),
      checked: z.boolean()
    })
  ),
  notes: z.string().optional()
});

export const PlanSchema = z.object({
  folder: z.string(),
  frontmatter: PlanFrontmatterSchema,
  subtasks: z.array(SubtaskReferenceSchema)
});

export const SubtaskSchema = z.object({
  filename: z.string(),
  number: z.number(),
  slug: z.string(),
  frontmatter: SubtaskFrontmatterSchema,
  description: z.string(),
  context: z.string().optional(),
  result: z.string().optional(),
  review: z.string().optional(),
  blockers: z.string().optional()
});

// Config Schemas
export const AgentProcessSchema = z.object({
  id: z.string(),
  type: AgentTypeSchema,
  taskFolder: z.string(),
  subtaskFile: z.string().optional(),
  pid: z.number(),
  startedAt: z.coerce.date()
});

export const ConfigSchema = z.object({
  maxConcurrentAgents: z.number().default(3),
  devsfactoryDir: z.string().default(".devsfactory"),
  worktreesDir: z.string().default(".worktrees")
});

// Inferred Types
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type SubtaskStatus = z.infer<typeof SubtaskStatusSchema>;
export type PlanStatus = z.infer<typeof PlanStatusSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type AgentType = z.infer<typeof AgentTypeSchema>;

export type TaskFrontmatter = z.output<typeof TaskFrontmatterSchema>;
export type PlanFrontmatter = z.output<typeof PlanFrontmatterSchema>;
export type SubtaskFrontmatter = z.output<typeof SubtaskFrontmatterSchema>;

export type Task = z.infer<typeof TaskSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Subtask = z.infer<typeof SubtaskSchema>;
export type SubtaskReference = z.infer<typeof SubtaskReferenceSchema>;

export type AgentProcess = z.infer<typeof AgentProcessSchema>;
export type Config = z.infer<typeof ConfigSchema>;
