import { Database as BunDatabase } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Generated } from "kysely";
import { Kysely, sql } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { createCrudHelpers } from "./repository-helpers.ts";

interface ItemsTable {
  id: string;
  name: string;
  value: Generated<number>;
  created_at: Generated<string>;
}

interface TestDatabase {
  items: ItemsTable;
}

const createTestDb = (): Kysely<TestDatabase> => {
  const bunDb = new BunDatabase(":memory:");
  const db = new Kysely<TestDatabase>({
    dialect: new BunSqliteDialect({ database: bunDb }),
  });
  return db;
};

const setupSchema = async (db: Kysely<TestDatabase>) => {
  await sql`
    CREATE TABLE items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `.execute(db);
};

describe("createCrudHelpers", () => {
  let db: Kysely<TestDatabase>;
  let crud: ReturnType<typeof createCrudHelpers<TestDatabase, "items">>;

  beforeEach(async () => {
    db = createTestDb();
    await setupSchema(db);
    crud = createCrudHelpers(db, "items");
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("findById", () => {
    test("returns item by id", async () => {
      await db.insertInto("items").values({ id: "item-1", name: "Test Item" }).execute();

      const item = await crud.findById("item-1");

      expect(item).not.toBeNull();
      expect(item?.id).toBe("item-1");
      expect(item?.name).toBe("Test Item");
    });

    test("returns null for non-existent id", async () => {
      const item = await crud.findById("non-existent");

      expect(item).toBeNull();
    });
  });

  describe("create", () => {
    test("creates a new item and returns it", async () => {
      const item = await crud.create({
        id: "item-1",
        name: "New Item",
        value: 42,
      });

      expect(item.id).toBe("item-1");
      expect(item.name).toBe("New Item");
      expect(item.value).toBe(42);
      expect(item.created_at).toBeDefined();
    });

    test("uses default values for generated columns", async () => {
      const item = await crud.create({
        id: "item-2",
        name: "Default Value Item",
      });

      expect(item.value).toBe(0);
      expect(item.created_at).toBeDefined();
    });

    test("throws on duplicate id", async () => {
      await crud.create({ id: "item-1", name: "First" });

      await expect(crud.create({ id: "item-1", name: "Duplicate" })).rejects.toThrow();
    });

    test("throws when id is not a string", async () => {
      await expect(
        crud.create({ name: "No ID" } as Parameters<typeof crud.create>[0]),
      ).rejects.toThrow("'id' must be a string");
    });
  });

  describe("update", () => {
    test("updates an existing item and returns the updated version", async () => {
      await crud.create({ id: "item-1", name: "Original" });

      const updated = await crud.update("item-1", { name: "Updated" });

      expect(updated).not.toBeNull();
      expect(updated?.name).toBe("Updated");
      expect(updated?.id).toBe("item-1");
    });

    test("returns null when updating non-existent item", async () => {
      const result = await crud.update("non-existent", { name: "Nope" });

      expect(result).toBeNull();
    });

    test("only updates specified fields", async () => {
      await crud.create({ id: "item-1", name: "Original", value: 10 });

      const updated = await crud.update("item-1", { name: "Changed" });

      expect(updated?.name).toBe("Changed");
      expect(updated?.value).toBe(10);
    });
  });

  describe("listAll", () => {
    test("returns all items", async () => {
      await crud.create({ id: "item-1", name: "First" });
      await crud.create({ id: "item-2", name: "Second" });
      await crud.create({ id: "item-3", name: "Third" });

      const items = await crud.listAll();

      expect(items).toHaveLength(3);
    });

    test("returns empty array when no items exist", async () => {
      const items = await crud.listAll();

      expect(items).toHaveLength(0);
    });
  });

  describe("deleteById", () => {
    test("deletes an existing item and returns true", async () => {
      await crud.create({ id: "item-1", name: "To Delete" });

      const result = await crud.deleteById("item-1");

      expect(result).toBe(true);

      const item = await crud.findById("item-1");
      expect(item).toBeNull();
    });

    test("returns false for non-existent item", async () => {
      const result = await crud.deleteById("non-existent");

      expect(result).toBe(false);
    });

    test("does not affect other items", async () => {
      await crud.create({ id: "item-1", name: "Keep" });
      await crud.create({ id: "item-2", name: "Delete" });

      await crud.deleteById("item-2");

      const remaining = await crud.listAll();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.id).toBe("item-1");
    });
  });
});
