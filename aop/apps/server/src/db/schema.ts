import type { TaskStatus } from "@aop/common";
import type { ExecutionStatus, StepExecutionStatus } from "@aop/common/protocol";
import type { Generated, Insertable, Selectable, Updateable } from "kysely";

export type { ExecutionStatus, StepExecutionStatus, TaskStatus };

export type StepStatus = StepExecutionStatus | "pending";

export interface ClientsTable {
  id: string;
  api_key: string;
  max_concurrent_tasks: Generated<number>;
  created_at: Generated<Date>;
  last_seen_at: Date | null;
}

export interface WorkflowsTable {
  id: string;
  name: string;
  definition: string;
  version: Generated<number>;
  created_at: Generated<Date>;
}

export interface ReposTable {
  id: string;
  client_id: string;
  synced_at: Date;
}

export interface TasksTable {
  id: string;
  client_id: string;
  repo_id: string;
  status: TaskStatus;
  synced_at: Date;
}

export interface ExecutionsTable {
  id: string;
  client_id: string;
  task_id: string;
  workflow_id: string;
  status: ExecutionStatus;
  started_at: Generated<Date>;
  completed_at: Date | null;
}

export interface StepExecutionsTable {
  id: string;
  client_id: string;
  execution_id: string;
  step_type: string;
  prompt_template: string;
  status: StepStatus;
  error_code: string | null;
  signal: string | null;
  started_at: Generated<Date>;
  ended_at: Date | null;
}

export interface Database {
  clients: ClientsTable;
  workflows: WorkflowsTable;
  repos: ReposTable;
  tasks: TasksTable;
  executions: ExecutionsTable;
  step_executions: StepExecutionsTable;
}

export type Client = Selectable<ClientsTable>;
export type NewClient = Insertable<ClientsTable>;
export type ClientUpdate = Updateable<ClientsTable>;

export type Workflow = Selectable<WorkflowsTable>;
export type NewWorkflow = Insertable<WorkflowsTable>;
export type WorkflowUpdate = Updateable<WorkflowsTable>;

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
