import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { cleanupTestDb, createTestDb } from "../db/test-utils.ts";
import { type ClientRepository, createClientRepository } from "./client-repository.ts";

describe("ClientRepository", () => {
  let db: Kysely<Database>;
  let repository: ClientRepository;

  beforeAll(async () => {
    db = await createTestDb();
    repository = createClientRepository(db);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("create", () => {
    test("creates a new client", async () => {
      const client = await repository.create({
        id: "client-1",
        api_key: "test-api-key",
        max_concurrent_tasks: 3,
      });

      expect(client.id).toBe("client-1");
      expect(client.api_key).toBe("test-api-key");
      expect(client.max_concurrent_tasks).toBe(3);
      expect(client.created_at).toBeDefined();
      expect(client.last_seen_at).toBeNull();
    });

    test("uses default max_concurrent_tasks", async () => {
      const client = await repository.create({
        id: "client-2",
        api_key: "test-api-key-2",
      });

      expect(client.max_concurrent_tasks).toBe(5);
    });
  });

  describe("findByApiKey", () => {
    test("returns client by API key", async () => {
      await repository.create({
        id: "client-1",
        api_key: "find-me-key",
      });

      const client = await repository.findByApiKey("find-me-key");

      expect(client).not.toBeNull();
      expect(client?.id).toBe("client-1");
    });

    test("returns null for non-existent API key", async () => {
      const client = await repository.findByApiKey("non-existent");

      expect(client).toBeNull();
    });
  });

  describe("updateLastSeen", () => {
    test("updates last_seen_at timestamp", async () => {
      await repository.create({
        id: "client-1",
        api_key: "test-key",
      });

      const now = new Date();
      const updated = await repository.updateLastSeen("client-1", now);

      expect(updated).not.toBeNull();
      expect(updated?.last_seen_at).toEqual(now);
    });

    test("returns null for non-existent client", async () => {
      const updated = await repository.updateLastSeen("non-existent", new Date());

      expect(updated).toBeNull();
    });
  });
});
