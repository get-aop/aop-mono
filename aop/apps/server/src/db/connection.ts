import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { getMigrations } from "./migrations/index.ts";
import type { Database } from "./schema.ts";

export const createDatabase = (connectionString: string): Kysely<Database> => {
  const pg = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  const dialect = new PostgresJSDialect({ postgres: pg });

  return new Kysely<Database>({ dialect });
};

export const runMigrations = async (db: Kysely<Database>): Promise<void> => {
  await ensureMigrationsTable(db);

  const migrations = getMigrations();

  for (const migration of migrations) {
    const exists = await migrationExists(db, migration.name);
    if (!exists) {
      await migration.up(db);
      await recordMigration(db, migration.name);
    }
  }
};

const migrationExists = async (db: Kysely<Database>, name: string): Promise<boolean> => {
  const result = await sql<{ name: string }>`
    SELECT name FROM kysely_migration WHERE name = ${name}
  `.execute(db);
  return result.rows.length > 0;
};

const ensureMigrationsTable = async (db: Kysely<Database>): Promise<void> => {
  await sql`
    CREATE TABLE IF NOT EXISTS kysely_migration (
      name VARCHAR(255) PRIMARY KEY,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.execute(db);
};

const recordMigration = async (db: Kysely<Database>, name: string): Promise<void> => {
  await sql`
    INSERT INTO kysely_migration (name) VALUES (${name})
  `.execute(db);
};
