import type { Kysely } from "kysely";
import { sql } from "kysely";
import { DEFAULT_SETTINGS, type SettingKey } from "../settings/types.ts";
import type { Database } from "./schema.ts";

export const runMigrations = async (db: Kysely<Database>): Promise<void> => {
  await createSettingsTable(db);
  await insertDefaultSettings(db);
  await createReposTable(db);
  await createTasksTable(db);
  await addTaskSyncColumns(db);
  await addTaskPreferredWorkflow(db);
  await createExecutionsTable(db);
  await createStepExecutionsTable(db);
  await addStepExecutionSignalColumns(db);
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

const createReposTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("repos")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("path", "text", (col) => col.notNull().unique())
    .addColumn("name", "text")
    .addColumn("remote_origin", "text")
    .addColumn("max_concurrent_tasks", "integer", (col) => col.defaultTo(1))
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();
};

const createTasksTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("tasks")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("repo_id", "text", (col) => col.notNull().references("repos.id"))
    .addColumn("change_path", "text", (col) => col.notNull())
    .addColumn("worktree_path", "text")
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("ready_at", "text")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
    .execute();

  await db.schema
    .createIndex("idx_tasks_repo_id")
    .ifNotExists()
    .on("tasks")
    .column("repo_id")
    .execute();

  await db.schema
    .createIndex("idx_tasks_status")
    .ifNotExists()
    .on("tasks")
    .column("status")
    .execute();

  await db.schema
    .createIndex("idx_tasks_repo_change")
    .ifNotExists()
    .on("tasks")
    .columns(["repo_id", "change_path"])
    .unique()
    .execute();
};

const addTaskSyncColumns = async (db: Kysely<Database>): Promise<void> => {
  const tableInfo = await sql<{ name: string }>`PRAGMA table_info(tasks)`.execute(db);
  const columns = tableInfo.rows.map((row) => row.name);

  if (!columns.includes("remote_id")) {
    await sql`ALTER TABLE tasks ADD COLUMN remote_id TEXT`.execute(db);
  }

  if (!columns.includes("synced_at")) {
    await sql`ALTER TABLE tasks ADD COLUMN synced_at TEXT`.execute(db);
  }
};

const addTaskPreferredWorkflow = async (db: Kysely<Database>): Promise<void> => {
  const tableInfo = await sql<{ name: string }>`PRAGMA table_info(tasks)`.execute(db);
  const columns = tableInfo.rows.map((row) => row.name);

  if (!columns.includes("preferred_workflow")) {
    await sql`ALTER TABLE tasks ADD COLUMN preferred_workflow TEXT`.execute(db);
  }
};

const createExecutionsTable = async (db: Kysely<Database>): Promise<void> => {
  await db.schema
    .createTable("executions")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("task_id", "text", (col) => col.notNull().references("tasks.id"))
    .addColumn("status", "text", (col) => col.notNull())
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
    .addColumn("execution_id", "text", (col) => col.notNull().references("executions.id"))
    .addColumn("agent_pid", "integer")
    .addColumn("session_id", "text")
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("exit_code", "integer")
    .addColumn("error", "text")
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

const addStepExecutionSignalColumns = async (db: Kysely<Database>): Promise<void> => {
  const tableInfo = await sql<{ name: string }>`PRAGMA table_info(step_executions)`.execute(db);
  const columns = tableInfo.rows.map((row) => row.name);

  if (!columns.includes("step_type")) {
    await sql`ALTER TABLE step_executions ADD COLUMN step_type TEXT`.execute(db);
  }

  if (!columns.includes("signal")) {
    await sql`ALTER TABLE step_executions ADD COLUMN signal TEXT`.execute(db);
  }
};
