import { Database as BunDatabase } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import type { Database } from "./schema.ts";

export const getDefaultDbPath = (): string => join(homedir(), ".aop", "aop.sqlite");

export const createDatabase = (dbPath: string): Kysely<Database> => {
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }
  const bunDb = new BunDatabase(dbPath);

  // Enable WAL mode for better concurrency (readers don't block writers)
  bunDb.run("PRAGMA journal_mode = WAL");
  // Set busy timeout to 5 seconds - auto-retry on lock instead of failing
  bunDb.run("PRAGMA busy_timeout = 5000");

  return new Kysely<Database>({
    dialect: new BunSqliteDialect({ database: bunDb }),
  });
};

let db: Kysely<Database> | null = null;

export const getDatabase = (): Kysely<Database> => {
  if (!db) {
    const dbPath = process.env.AOP_DB_PATH ?? getDefaultDbPath();
    db = createDatabase(dbPath);
  }
  return db;
};

export const closeDatabase = async (): Promise<void> => {
  if (db) {
    await db.destroy();
    db = null;
  }
};
