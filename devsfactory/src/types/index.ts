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
  "PENDING_MERGE",
  "MERGE_CONFLICT",
  "DONE",
  "BLOCKED"
]);

export const PlanStatusSchema = z.enum([
  "INPROGRESS",
  "AGENT_REVIEW",
  "BLOCKED",
  "REVIEW"
]);

export const PrioritySchema = z.enum(["high", "medium", "low"]);

export const AgentTypeSchema = z.enum([
  "planning",
  "implementation",
  "review",
  "completing-task",
  "completion-review",
  "conflict-solver"
]);

// Timing Schemas
export const PhaseTimingsSchema = z.object({
  implementation: z.number().nullable().default(null),
  review: z.number().nullable().default(null),
  merge: z.number().nullable().default(null),
  conflictSolver: z.number().nullable().default(null)
});

export const SubtaskTimingSchema = z.object({
  startedAt: z.coerce.date().nullable().default(null),
  completedAt: z.coerce.date().nullable().default(null),
  durationMs: z.number().nullable().default(null),
  phases: PhaseTimingsSchema.default({
    implementation: null,
    review: null,
    merge: null,
    conflictSolver: null
  })
});

export const TaskTimingSchema = z.object({
  startedAt: z.coerce.date().nullable().default(null),
  completedAt: z.coerce.date().nullable().default(null),
  durationMs: z.number().nullable().default(null)
});

// Frontmatter Schemas
export const TaskFrontmatterSchema = z.object({
  title: z.string(),
  status: TaskStatusSchema,
  created: z.coerce.date(),
  priority: PrioritySchema,
  tags: z.array(z.string()).default([]),
  assignee: z.string().nullable().default(null),
  dependencies: z.array(z.string()).default([]),
  branch: z.string().optional(),
  startedAt: z.coerce.date().nullable().default(null),
  completedAt: z.coerce.date().nullable().default(null),
  durationMs: z.number().nullable().default(null)
});

export const PlanFrontmatterSchema = z.object({
  status: PlanStatusSchema,
  task: z.string(),
  created: z.coerce.date()
});

export const SubtaskFrontmatterSchema = z.object({
  title: z.string(),
  status: SubtaskStatusSchema,
  dependencies: z.array(z.number()).default([]),
  timing: SubtaskTimingSchema.optional()
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

export const RetryBackoffSchema = z.object({
  initialMs: z.number().default(2000),
  maxMs: z.number().default(300000),
  maxAttempts: z.number().default(5)
});

export const ConfigSchema = z.object({
  maxConcurrentAgents: z.number().default(2),
  devsfactoryDir: z.string().default(".devsfactory"),
  worktreesDir: z.string().default(".worktrees"),
  projectRoot: z.string().optional(),
  projectName: z.string().optional(),
  dashboardPort: z.number().default(3001),
  debounceMs: z.number().default(100),
  retryBackoff: RetryBackoffSchema.default({
    initialMs: 2000,
    maxMs: 300000,
    maxAttempts: 5
  }),
  ignorePatterns: z
    .array(z.string())
    .default([".git", "*.swp", "*.tmp", "*~", ".DS_Store"])
});

export const OrchestratorStateSchema = z.object({
  tasks: z.array(TaskSchema),
  plans: z.record(z.string(), PlanSchema),
  subtasks: z.record(z.string(), z.array(SubtaskSchema))
});

export const WatcherEventTypeSchema = z.enum([
  "taskChanged",
  "planChanged",
  "subtaskChanged",
  "reviewChanged"
]);

export const WatcherEventSchema = z.object({
  type: WatcherEventTypeSchema,
  taskFolder: z.string(),
  filename: z.string().optional()
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

export type PhaseTimings = z.output<typeof PhaseTimingsSchema>;
export type SubtaskTiming = z.output<typeof SubtaskTimingSchema>;
export type TaskTiming = z.output<typeof TaskTimingSchema>;

export type Task = z.infer<typeof TaskSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Subtask = z.infer<typeof SubtaskSchema>;
export type SubtaskReference = z.infer<typeof SubtaskReferenceSchema>;

export type AgentProcess = z.infer<typeof AgentProcessSchema>;
export type Config = z.infer<typeof ConfigSchema>;
export type RetryBackoff = z.infer<typeof RetryBackoffSchema>;
export type OrchestratorState = z.infer<typeof OrchestratorStateSchema>;
export type WatcherEventType = z.infer<typeof WatcherEventTypeSchema>;
export type WatcherEvent = z.infer<typeof WatcherEventSchema>;

// Brainstorm Session Schemas
export const BrainstormSessionStatusSchema = z.enum([
  "active",
  "brainstorming",
  "waiting",
  "planning",
  "review",
  "completed",
  "cancelled"
]);

export const BrainstormMessageRoleSchema = z.enum(["user", "assistant"]);

export const BrainstormMessageSchema = z.object({
  id: z.string(),
  role: BrainstormMessageRoleSchema,
  content: z.string(),
  timestamp: z.coerce.date()
});

export const TaskPreviewSchema = z.object({
  title: z.string(),
  description: z.string(),
  requirements: z.string(),
  acceptanceCriteria: z.array(z.string())
});

export const SubtaskPreviewSchema = z.object({
  number: z.number(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  context: z.string().optional(),
  dependencies: z.array(z.number()).default([])
});

export const BrainstormQuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string()
});

export const BrainstormQuestionItemSchema = z.object({
  question: z.string(),
  header: z.string(),
  options: z.array(BrainstormQuestionOptionSchema),
  multiSelect: z.boolean()
});

export const BrainstormQuestionSchema = z.object({
  toolUseId: z.string(),
  questions: z.array(BrainstormQuestionItemSchema)
});

export const BrainstormSessionSchema = z.object({
  id: z.string(),
  status: BrainstormSessionStatusSchema,
  messages: z.array(BrainstormMessageSchema),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  taskPreview: TaskPreviewSchema.optional(),
  subtaskPreviews: z.array(SubtaskPreviewSchema).optional(),
  claudeSessionId: z.string().optional(),
  pendingQuestion: BrainstormQuestionSchema.optional()
});

export const BrainstormDraftSchema = z.object({
  sessionId: z.string(),
  messages: z.array(BrainstormMessageSchema),
  partialTaskData: TaskPreviewSchema.partial(),
  status: BrainstormSessionStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date()
});

// Brainstorm Inferred Types
export type BrainstormSessionStatus = z.infer<
  typeof BrainstormSessionStatusSchema
>;
export type BrainstormMessageRole = z.infer<typeof BrainstormMessageRoleSchema>;
export type BrainstormMessage = z.infer<typeof BrainstormMessageSchema>;
export type TaskPreview = z.infer<typeof TaskPreviewSchema>;
export type SubtaskPreview = z.infer<typeof SubtaskPreviewSchema>;
export type BrainstormQuestionOption = z.infer<
  typeof BrainstormQuestionOptionSchema
>;
export type BrainstormQuestionItem = z.infer<
  typeof BrainstormQuestionItemSchema
>;
export type BrainstormQuestion = z.infer<typeof BrainstormQuestionSchema>;
export type BrainstormSession = z.infer<typeof BrainstormSessionSchema>;
export type BrainstormDraft = z.infer<typeof BrainstormDraftSchema>;

// Global Configuration Schemas
export const OperationModeSchema = z.enum(["global"]);

export const ProviderConfigSchema = z.object({
  model: z.string().optional(),
  apiKey: z.string().optional(),
  env: z.record(z.string(), z.string()).optional()
});

export const ServerConfigSchema = z.object({
  url: z.string().url().default("http://localhost:3001")
});

export const AgentConfigFileSchema = z.object({
  serverUrl: z.string().url(),
  secret: z.string().min(16),
  clientId: z.string().optional(),
  machineId: z.string().optional(),
  model: z.enum(["opus", "sonnet", "haiku"]).optional(),
  maxConcurrentJobs: z.number().min(1).max(10).optional(),
  reconnect: z.boolean().optional(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).optional(),
  projectName: z.string(),
  devsfactoryDir: z.string()
});

export const GlobalConfigSchema = z.object({
  version: z.number().default(1),
  defaults: ConfigSchema.partial().default({}),
  providers: z.record(z.string(), ProviderConfigSchema).default({}),
  server: ServerConfigSchema.default({ url: "http://localhost:3001" }),
  agent: AgentConfigFileSchema.optional()
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type AgentConfigFile = z.infer<typeof AgentConfigFileSchema>;

export const ProjectConfigSchema = z.object({
  name: z.string(),
  path: z.string(),
  gitRemote: z.string().nullable(),
  registered: z.coerce.date(),
  settings: ConfigSchema.partial().optional(),
  providers: z.record(z.string(), ProviderConfigSchema).optional()
});

export const ResolvedPathsSchema = z.object({
  mode: OperationModeSchema,
  projectName: z.string(),
  projectRoot: z.string(),
  devsfactoryDir: z.string(),
  worktreesDir: z.string()
});

// Global Configuration Inferred Types
export type OperationMode = z.infer<typeof OperationModeSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type ResolvedPaths = z.infer<typeof ResolvedPathsSchema>;

// Orchestrator interfaces (previously in dashboard-server.ts)
import type { EventEmitter } from "node:events";

export interface ProjectScanResult {
  tasks: Task[];
  plans: Record<string, Plan>;
  subtasks: Record<string, Subtask[]>;
}

export interface OrchestratorLike extends EventEmitter {
  getState(): OrchestratorState;
  getActiveAgents(): Promise<unknown[]>;
}

export interface BrainstormManagerLike extends EventEmitter {
  startSession(initialMessage?: string): Promise<BrainstormSession>;
  sendMessage(sessionId: string, message: string): Promise<void>;
  endSession(sessionId: string): Promise<void>;
  getSession(sessionId: string): BrainstormSession | undefined;
}

// Content interfaces for SQLite single source of truth
export interface TaskWithContent {
  folder: string;
  frontmatter: TaskFrontmatter;
  description: string;
  requirements?: string;
  acceptanceCriteria?: string[];
  notes?: string;
}

export interface SubtaskWithContent {
  filename: string;
  frontmatter: SubtaskFrontmatter;
  objective: string;
  acceptanceCriteria?: string;
  tasksChecklist?: string;
  result?: string;
}

export interface TaskContentUpdate {
  description?: string;
  requirements?: string;
  acceptanceCriteria?: string[];
  notes?: string;
}

export interface SubtaskContentUpdate {
  objective?: string;
  acceptanceCriteria?: string;
  tasksChecklist?: string;
  result?: string;
}
