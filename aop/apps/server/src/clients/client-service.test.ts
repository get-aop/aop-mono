import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { cleanupTestDb, createTestClient, createTestDb } from "../db/test-utils.ts";
import { createClientRepository } from "./client-repository.ts";
import { type ClientService, createClientService } from "./client-service.ts";

describe("ClientService", () => {
  let db: Kysely<Database>;
  let clientService: ClientService;

  beforeAll(async () => {
    db = await createTestDb();
    const clientRepo = createClientRepository(db);
    clientService = createClientService(clientRepo);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("authenticate", () => {
    test("returns error when apiKey is undefined", async () => {
      const result = await clientService.authenticate(undefined);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("missing_api_key");
      }
    });

    test("returns error when apiKey is invalid", async () => {
      const result = await clientService.authenticate("invalid-key");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("invalid_api_key");
      }
    });

    test("returns client info for valid apiKey", async () => {
      const { id, apiKey } = await createTestClient(db, { maxConcurrentTasks: 5 });

      const result = await clientService.authenticate(apiKey);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.response.clientId).toBe(id);
        expect(result.response.effectiveMaxConcurrentTasks).toBe(5);
      }
    });

    test("uses client max when no requested max is provided", async () => {
      const { apiKey } = await createTestClient(db, { maxConcurrentTasks: 10 });

      const result = await clientService.authenticate(apiKey);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.response.effectiveMaxConcurrentTasks).toBe(10);
      }
    });

    test("uses requested max when lower than client max", async () => {
      const { apiKey } = await createTestClient(db, { maxConcurrentTasks: 10 });

      const result = await clientService.authenticate(apiKey, 3);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.response.effectiveMaxConcurrentTasks).toBe(3);
      }
    });

    test("uses client max when requested max is higher", async () => {
      const { apiKey } = await createTestClient(db, { maxConcurrentTasks: 5 });

      const result = await clientService.authenticate(apiKey, 10);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.response.effectiveMaxConcurrentTasks).toBe(5);
      }
    });

    test("updates last seen timestamp on successful auth", async () => {
      const { id, apiKey } = await createTestClient(db);

      const beforeAuth = await db
        .selectFrom("clients")
        .select("last_seen_at")
        .where("id", "=", id)
        .executeTakeFirstOrThrow();

      await clientService.authenticate(apiKey);

      const afterAuth = await db
        .selectFrom("clients")
        .select("last_seen_at")
        .where("id", "=", id)
        .executeTakeFirstOrThrow();

      expect(afterAuth.last_seen_at).not.toEqual(beforeAuth.last_seen_at);
      expect(afterAuth.last_seen_at).not.toBeNull();
    });
  });
});
