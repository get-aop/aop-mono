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

  bunDb.run("PRAGMA journal_mode = WAL");
  bunDb.run("PRAGMA busy_timeout = 5000");

  return new Kysely<Database>({
    dialect: new BunSqliteDialect({ database: bunDb }),
  });
};
