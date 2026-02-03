import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../context.ts";
import { createDatabase } from "./connection.ts";
import { runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";

export const createTestContext = async (): Promise<CommandContext> => {
  const db = await createTestDb();
  return createCommandContext(db);
};

export const createTestDb = async (): Promise<Kysely<Database>> => {
  const db = createDatabase(":memory:");
  await runMigrations(db);
  return db;
};

export const createTestRepo = async (
  db: Kysely<Database>,
  id: string,
  path: string,
): Promise<void> => {
  await db
    .insertInto("repos")
    .values({
      id,
      path,
      name: path.split("/").pop() ?? null,
      remote_origin: null,
    })
    .execute();
};

export const createTestTask = async (
  db: Kysely<Database>,
  id: string,
  repoId: string,
  changePath: string,
  status: "DRAFT" | "READY" | "WORKING" | "BLOCKED" | "DONE" | "REMOVED" = "WORKING",
): Promise<void> => {
  await db
    .insertInto("tasks")
    .values({
      id,
      repo_id: repoId,
      change_path: changePath,
      status,
    })
    .execute();
};
