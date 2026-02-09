import type { Generated, Insertable, Selectable, Updateable } from "kysely";

export interface SettingsTable {
  key: string;
  value: string;
}

export interface ReposTable {
  id: string;
  path: string;
  name: string | null;
  remote_origin: string | null;
  max_concurrent_tasks: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface TasksTable {
  id: string;
  repo_id: string;
  change_path: string;
  worktree_path: string | null;
  status: "DRAFT" | "READY" | "WORKING" | "BLOCKED" | "DONE" | "REMOVED";
  ready_at: string | null;
  remote_id: string | null;
  synced_at: string | null;
  preferred_workflow: string | null;
  base_branch: string | null;
  preferred_provider: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface ExecutionsTable {
  id: string;
  task_id: string;
  status: "running" | "completed" | "failed" | "aborted" | "cancelled";
  started_at: string;
  completed_at: string | null;
}

export interface StepExecutionsTable {
  id: string;
  execution_id: string;
  step_type: string | null;
  agent_pid: number | null;
  session_id: string | null;
  status: "running" | "success" | "failure" | "cancelled";
  exit_code: number | null;
  signal: string | null;
  error: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface ExecutionLogsTable {
  id: Generated<number>;
  execution_id: string;
  stream: "stdout" | "stderr";
  content: string;
  timestamp: string;
}

export type InteractiveSessionStatus =
  | "active"
  | "brainstorming"
  | "completed"
  | "cancelled"
  | "error";

export interface InteractiveSessionsTable {
  id: string;
  repo_id: string | null;
  change_path: string | null;
  claude_session_id: string;
  status: InteractiveSessionStatus;
  question_count: Generated<number>;
  continuation_count: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export type SessionMessageRole = "user" | "assistant";

export interface SessionMessagesTable {
  id: string;
  session_id: string;
  role: SessionMessageRole;
  content: string;
  tool_use_id: string | null;
  created_at: Generated<string>;
}

export interface Database {
  settings: SettingsTable;
  repos: ReposTable;
  tasks: TasksTable;
  executions: ExecutionsTable;
  step_executions: StepExecutionsTable;
  execution_logs: ExecutionLogsTable;
  interactive_sessions: InteractiveSessionsTable;
  session_messages: SessionMessagesTable;
}

export type Setting = Selectable<SettingsTable>;
export type NewSetting = Insertable<SettingsTable>;

export type Repo = Selectable<ReposTable>;
export type NewRepo = Insertable<ReposTable>;
export type RepoUpdate = Updateable<ReposTable>;

export type Task = Selectable<TasksTable>;
export type NewTask = Insertable<TasksTable>;
export type TaskUpdate = Updateable<TasksTable>;

export type Execution = Selectable<ExecutionsTable>;
export type NewExecution = Insertable<ExecutionsTable>;
export type ExecutionUpdate = Updateable<ExecutionsTable>;

export type StepExecution = Selectable<StepExecutionsTable>;
export type NewStepExecution = Insertable<StepExecutionsTable>;
export type StepExecutionUpdate = Updateable<StepExecutionsTable>;

export type ExecutionLog = Selectable<ExecutionLogsTable>;
export type NewExecutionLog = Insertable<ExecutionLogsTable>;

export type InteractiveSession = Selectable<InteractiveSessionsTable>;
export type NewInteractiveSession = Insertable<InteractiveSessionsTable>;
export type InteractiveSessionUpdate = Updateable<InteractiveSessionsTable>;

export type SessionMessage = Selectable<SessionMessagesTable>;
export type NewSessionMessage = Insertable<SessionMessagesTable>;
