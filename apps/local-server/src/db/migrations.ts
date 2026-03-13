import type { Kysely } from "kysely";
import { sql } from "kysely";
import { DEFAULT_SETTINGS, type SettingKey } from "../settings/types.ts";
import type { Database } from "./schema.ts";

export const runMigrations = async (db: Kysely<Database>): Promise<void> => {
  await createSettingsTable(db);
  await insertDefaultSettings(db);
  await createWorkflowsTable(db);
  await createReposTable(db);
  await createTasksTable(db);
  await createTaskSourcesTable(db);
  await createTaskDependenciesTable(db);
  await createExecutionsTable(db);
  await createStepExecutionsTable(db);
  await createStepLogsTable(db);
  await createInteractiveSessionsTable(db);
  await createSessionMessagesTable(db);
};

const createSettingsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("settings")
    .ifNotExists()
    .addColumn("key", "text", (col) => col.primaryKey())
    .addColumn("value", "text", (col) => col.notNull())
    .execute();
};

const insertDefaultSettings = async (db: Kysely<Database>): Promise<void> => {
  const entries = Object.entries(DEFAULT_SETTINGS) as [SettingKey, string][];

  for (const [key, value] of entries) {
    await db
      .insertInto("settings")
      .values({ key, value })
      .onConflict((oc) => oc.column("key").doNothing())
      .execute();
  }
};

const createWorkflowsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("workflows")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.notNull().unique())
    .addColumn("definition", "text", (col) => col.notNull())
    .addColumn("version", "integer", (col) => col.notNull().defaultTo(1))
    .addColumn("active", "integer", (col) => col.notNull().defaultTo(1))
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await db.schema
    .createIndex("idx_workflows_name")
    .ifNotExists()
    .on("workflows")
    .column("name")
    .execute();

  await db.schema
    .createIndex("idx_workflows_active")
    .ifNotExists()
    .on("workflows")
    .column("active")
    .execute();
};

const createReposTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("repos")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("path", "text", (col) => col.notNull().unique())
    .addColumn("name", "text")
    .addColumn("remote_origin", "text")
    .addColumn("max_concurrent_tasks", "integer", (col) => col.defaultTo(3))
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();
};

const createTasksTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("tasks")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("repo_id", "text", (col) => col.notNull().references("repos.id").onDelete("cascade"))
    .addColumn("change_path", "text", (col) => col.notNull())
    .addColumn("worktree_path", "text")
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("ready_at", "text")
    .addColumn("preferred_workflow", "text")
    .addColumn("base_branch", "text")
    .addColumn("preferred_provider", "text")
    .addColumn("retry_from_step", "text")
    .addColumn("resume_input", "text")
    .addColumn("created_at", "text", (col) => col.notNull())
    .addColumn("updated_at", "text", (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex("idx_tasks_repo_change_path")
    .ifNotExists()
    .on("tasks")
    .columns(["repo_id", "change_path"])
    .unique()
    .execute();
};

const createTaskSourcesTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("task_sources")
    .ifNotExists()
    .addColumn("task_id", "text", (col) => col.notNull())
    .addColumn("repo_id", "text", (col) => col.notNull().references("repos.id").onDelete("cascade"))
    .addColumn("provider", "text", (col) => col.notNull())
    .addColumn("external_id", "text", (col) => col.notNull())
    .addColumn("external_ref", "text", (col) => col.notNull())
    .addColumn("external_url", "text", (col) => col.notNull())
    .addColumn("title_snapshot", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await db.schema
    .createIndex("idx_task_sources_repo_external_id")
    .ifNotExists()
    .on("task_sources")
    .columns(["repo_id", "provider", "external_id"])
    .unique()
    .execute();

  await db.schema
    .createIndex("idx_task_sources_task_provider")
    .ifNotExists()
    .on("task_sources")
    .columns(["task_id", "provider"])
    .unique()
    .execute();

  await db.schema
    .createIndex("idx_task_sources_repo_external_ref")
    .ifNotExists()
    .on("task_sources")
    .columns(["repo_id", "provider", "external_ref"])
    .execute();
};

const createTaskDependenciesTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("task_dependencies")
    .ifNotExists()
    .addColumn("task_id", "text", (col) => col.notNull())
    .addColumn("depends_on_task_id", "text", (col) => col.notNull())
    .addColumn("source", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addCheckConstraint("chk_task_dependencies_not_self", sql`task_id <> depends_on_task_id`)
    .addPrimaryKeyConstraint("pk_task_dependencies", ["task_id", "depends_on_task_id"])
    .execute();

  await db.schema
    .createIndex("idx_task_dependencies_depends_on")
    .ifNotExists()
    .on("task_dependencies")
    .column("depends_on_task_id")
    .execute();
};

const createExecutionsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("executions")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("task_id", "text", (col) => col.notNull())
    .addColumn("workflow_id", "text", (col) => col.notNull().defaultTo("aop-default"))
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("visited_steps", "text", (col) => col.notNull().defaultTo("[]"))
    .addColumn("iteration", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("started_at", "text", (col) => col.notNull())
    .addColumn("completed_at", "text")
    .execute();

  await db.schema
    .createIndex("idx_executions_task_id")
    .ifNotExists()
    .on("executions")
    .column("task_id")
    .execute();
};

const createStepExecutionsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("step_executions")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("execution_id", "text", (col) =>
      col.notNull().references("executions.id").onDelete("cascade"),
    )
    .addColumn("step_id", "text")
    .addColumn("step_type", "text")
    .addColumn("agent_pid", "integer")
    .addColumn("session_id", "text")
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("exit_code", "integer")
    .addColumn("signal", "text")
    .addColumn("pause_context", "text")
    .addColumn("error", "text")
    .addColumn("attempt", "integer")
    .addColumn("iteration", "integer")
    .addColumn("signals_json", "text")
    .addColumn("started_at", "text", (col) => col.notNull())
    .addColumn("ended_at", "text")
    .execute();

  await db.schema
    .createIndex("idx_step_executions_execution_id")
    .ifNotExists()
    .on("step_executions")
    .column("execution_id")
    .execute();
};

const createStepLogsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("step_logs")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("step_execution_id", "text", (col) =>
      col.notNull().references("step_executions.id").onDelete("cascade"),
    )
    .addColumn("content", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex("idx_step_logs_step_execution_id")
    .ifNotExists()
    .on("step_logs")
    .column("step_execution_id")
    .execute();
};

const createInteractiveSessionsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("interactive_sessions")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("repo_id", "text", (col) => col.references("repos.id"))
    .addColumn("change_path", "text")
    .addColumn("claude_session_id", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull().defaultTo("active"))
    .addColumn("question_count", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("continuation_count", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await db.schema
    .createIndex("idx_interactive_sessions_status")
    .ifNotExists()
    .on("interactive_sessions")
    .column("status")
    .execute();
};

const createSessionMessagesTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("session_messages")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("session_id", "text", (col) =>
      col.notNull().references("interactive_sessions.id").onDelete("cascade"),
    )
    .addColumn("role", "text", (col) => col.notNull())
    .addColumn("content", "text", (col) => col.notNull())
    .addColumn("tool_use_id", "text")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await db.schema
    .createIndex("idx_session_messages_session_id")
    .ifNotExists()
    .on("session_messages")
    .column("session_id")
    .execute();
};
