import type { Kysely } from "kysely";
import { sql } from "kysely";
import { DEFAULT_SETTINGS, type SettingKey } from "../settings/types.ts";
import type { Database } from "./schema.ts";

export const runMigrations = async (db: Kysely<Database>): Promise<void> => {
  await createSettingsTable(db);
  await insertDefaultSettings(db);
  await createReposTable(db);
  await dropLegacyTaskTables(db);
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

const dropLegacyTaskTables = async (db: Kysely<Database>): Promise<void> => {
  await sql`DROP TABLE IF EXISTS step_logs`.execute(db);
  await sql`DROP TABLE IF EXISTS execution_logs`.execute(db);
  await sql`DROP TABLE IF EXISTS step_executions`.execute(db);
  await sql`DROP TABLE IF EXISTS executions`.execute(db);
  await sql`DROP TABLE IF EXISTS tasks`.execute(db);
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
