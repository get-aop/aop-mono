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

export type ServerEvent =
  | { type: "state"; data: OrchestratorState }
  | { type: "taskChanged"; task: Task }
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
    };
