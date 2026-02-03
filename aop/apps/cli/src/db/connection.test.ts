import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { closeDatabase, createDatabase, getDatabase } from "./connection";

const TEST_DIR = "tmp/db-connection-test";
const TEST_DB_PATH = `${TEST_DIR}/test.db`;

describe("connection", () => {
  afterEach(async () => {
    await closeDatabase();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("createDatabase", () => {
    test("creates a new database instance", () => {
      mkdirSync(TEST_DIR, { recursive: true });
      const db = createDatabase(TEST_DB_PATH);
      expect(db).toBeDefined();
    });
  });

  describe("getDatabase", () => {
    test("returns a singleton database instance", () => {
      mkdirSync(TEST_DIR, { recursive: true });
      process.env.AOP_DB_PATH = TEST_DB_PATH;

      const db1 = getDatabase();
      const db2 = getDatabase();

      expect(db1).toBe(db2);

      delete process.env.AOP_DB_PATH;
    });
  });

  describe("closeDatabase", () => {
    test("closes the database connection", async () => {
      mkdirSync(TEST_DIR, { recursive: true });
      process.env.AOP_DB_PATH = TEST_DB_PATH;

      getDatabase();
      await closeDatabase();

      // After closing, getDatabase should create a new instance
      const newDb = getDatabase();
      expect(newDb).toBeDefined();

      delete process.env.AOP_DB_PATH;
    });

    test("handles closing when no database is open", async () => {
      // Should not throw
      await closeDatabase();
    });
  });
});
