export interface ProjectListItem {
  name: string;
  path: string;
  registered: Date;
  taskCount: number;
}

export type TaskStatus =
  | "DRAFT"
  | "BACKLOG"
  | "PENDING"
  | "INPROGRESS"
  | "BLOCKED"
  | "REVIEW"
  | "DONE";

export type SubtaskStatus =
  | "PENDING"
  | "INPROGRESS"
  | "AGENT_REVIEW"
  | "PENDING_MERGE"
  | "MERGE_CONFLICT"
  | "DONE"
  | "BLOCKED";

export type PlanStatus = "INPROGRESS" | "AGENT_REVIEW" | "BLOCKED" | "REVIEW";

export type Priority = "high" | "medium" | "low";

export type AgentType =
  | "planning"
  | "implementation"
  | "review"
  | "completing-task"
  | "completion-review"
  | "conflict-solver";

export interface TaskFrontmatter {
  title: string;
  status: TaskStatus;
  created: Date;
  priority: Priority;
  tags: string[];
  assignee: string | null;
  dependencies: string[];
}

export interface PlanFrontmatter {
  status: PlanStatus;
  task: string;
  created: Date;
}

export interface SubtaskFrontmatter {
  title: string;
  status: SubtaskStatus;
  dependencies: number[];
}

export interface AcceptanceCriterion {
  text: string;
  checked: boolean;
}

export interface Task {
  folder: string;
  frontmatter: TaskFrontmatter;
  description: string;
  requirements: string;
  acceptanceCriteria: AcceptanceCriterion[];
  notes?: string;
}

export interface SubtaskReference {
  number: number;
  slug: string;
  title: string;
  dependencies: number[];
}

export interface Plan {
  folder: string;
  frontmatter: PlanFrontmatter;
  subtasks: SubtaskReference[];
}

export interface Subtask {
  filename: string;
  number: number;
  slug: string;
  frontmatter: SubtaskFrontmatter;
  description: string;
  context?: string;
  result?: string;
  review?: string;
  blockers?: string;
}

export interface OrchestratorState {
  tasks: Task[];
  plans: Record<string, Plan>;
  subtasks: Record<string, Subtask[]>;
}

export interface ActiveAgent {
  taskFolder: string;
  subtaskFile?: string;
  type: AgentType;
}

// Brainstorm Session Types
export type BrainstormSessionStatus =
  | "active"
  | "brainstorming"
  | "planning"
  | "review"
  | "completed"
  | "cancelled";

export interface BrainstormMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface TaskPreview {
  title: string;
  description: string;
  requirements: string;
  acceptanceCriteria: string[];
}

export interface SubtaskPreview {
  title: string;
  description: string;
  dependencies: number[];
}

export interface BrainstormSession {
  id: string;
  status: BrainstormSessionStatus;
  messages: BrainstormMessage[];
  createdAt: Date;
  updatedAt: Date;
  taskPreview?: TaskPreview;
  subtaskPreviews?: SubtaskPreview[];
}

export interface BrainstormDraft {
  sessionId: string;
  messages: BrainstormMessage[];
  partialTaskData: Partial<TaskPreview>;
  status: BrainstormSessionStatus;
  createdAt: Date;
  updatedAt: Date;
}

// MCP Ask User Types
export interface AskUserOption {
  label: string;
  description: string;
}

export interface AskUserQuestion {
  question: string;
  header: string;
  options: AskUserOption[];
  multiSelect?: boolean;
}

export interface AskUserRequest {
  type: "askUser";
  questionId: string;
  questions: AskUserQuestion[];
}

export interface AskUserResponse {
  type: "askUserResponse";
  questionId: string;
  answers: Record<string, string>;
}

export type ServerEvent =
  | { type: "state"; data: OrchestratorState; projectName?: string }
  | { type: "taskChanged"; task: Task; projectName?: string }
  | { type: "subtaskChanged"; taskFolder: string; subtask: Subtask }
  | {
      type: "agentStarted";
      agentId: string;
      taskFolder: string;
      subtaskFile?: string;
      agentType: AgentType;
    }
  | { type: "agentOutput"; agentId: string; chunk: string }
  | { type: "agentCompleted"; agentId: string; exitCode: number }
  | { type: "jobFailed"; jobId: string; error: string; attempt: number }
  | {
      type: "jobRetrying";
      jobId: string;
      attempt: number;
      nextRetryMs: number;
    }
  | { type: "brainstormStarted"; sessionId: string; agentId: string }
  | { type: "brainstormMessage"; sessionId: string; message: BrainstormMessage }
  | { type: "brainstormWaiting"; sessionId: string }
  | { type: "brainstormChunk"; sessionId: string; chunk: string }
  | { type: "brainstormComplete"; sessionId: string; taskPreview: TaskPreview }
  | {
      type: "planGenerated";
      sessionId: string;
      subtaskPreviews: SubtaskPreview[];
    }
  | { type: "taskCreated"; sessionId: string; taskFolder: string }
  | { type: "brainstormError"; sessionId: string; error: string }
  | AskUserRequest;
