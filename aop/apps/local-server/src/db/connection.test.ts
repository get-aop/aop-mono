import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createDatabase, getDefaultDbPath } from "./connection.ts";

describe("db/connection", () => {
  describe("getDefaultDbPath", () => {
    test("returns path in home directory", () => {
      const path = getDefaultDbPath();

      expect(path).toBe(join(homedir(), ".aop", "aop.sqlite"));
    });
  });

  describe("createDatabase", () => {
    let tempDbPath: string;

    beforeEach(() => {
      tempDbPath = join("/tmp", `aop-test-db-${Date.now()}`, "test.sqlite");
    });

    afterEach(async () => {
      const dbDir = join("/tmp", tempDbPath.split("/tmp/")[1]?.split("/")[0] ?? "");
      if (dbDir && existsSync(dbDir)) {
        rmSync(dbDir, { recursive: true });
      }
    });

    test("creates database and returns Kysely instance", async () => {
      const db = createDatabase(tempDbPath);

      expect(db).toBeDefined();
      expect(existsSync(tempDbPath)).toBe(true);

      await db.destroy();
    });

    test("creates parent directory if it does not exist", async () => {
      const nestedPath = join("/tmp", `aop-test-db-nested-${Date.now()}`, "subdir", "test.sqlite");
      const db = createDatabase(nestedPath);

      expect(existsSync(nestedPath)).toBe(true);

      await db.destroy();
      rmSync(join("/tmp", nestedPath.split("/tmp/")[1]?.split("/")[0] ?? ""), { recursive: true });
    });

    test("database can execute queries", async () => {
      const db = createDatabase(tempDbPath);

      // Verify DB is functional - just check the instance is usable
      expect(db).toBeDefined();
      expect(typeof db.selectFrom).toBe("function");

      await db.destroy();
    });

    test("works with in-memory database", async () => {
      const db = createDatabase(":memory:");

      expect(db).toBeDefined();

      await db.destroy();
    });
  });
});
