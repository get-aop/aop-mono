import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { cleanupTestDb, createTestClient, createTestDb } from "../db/test-utils.ts";
import { createRepoRepository } from "./repo-repository.ts";
import { createRepoService, type RepoService } from "./repo-service.ts";

describe("RepoService", () => {
  let db: Kysely<Database>;
  let repoService: RepoService;

  beforeAll(async () => {
    db = await createTestDb();
    const repoRepo = createRepoRepository(db);
    repoService = createRepoService(repoRepo);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("syncRepo", () => {
    test("creates a new repo when it does not exist", async () => {
      const { id: clientId } = await createTestClient(db);
      const repoId = "repo-123";
      const syncedAt = new Date("2026-02-02T10:00:00Z");

      await repoService.syncRepo(clientId, repoId, syncedAt);

      const repo = await db
        .selectFrom("repos")
        .selectAll()
        .where("id", "=", repoId)
        .executeTakeFirst();

      expect(repo).toBeDefined();
      expect(repo?.id).toBe(repoId);
      expect(repo?.client_id).toBe(clientId);
      expect(repo?.synced_at?.toISOString()).toBe(syncedAt.toISOString());
    });

    test("updates synced_at when repo already exists", async () => {
      const { id: clientId } = await createTestClient(db);
      const repoId = "repo-123";
      const firstSyncedAt = new Date("2026-02-01T10:00:00Z");
      const secondSyncedAt = new Date("2026-02-02T15:00:00Z");

      await repoService.syncRepo(clientId, repoId, firstSyncedAt);
      await repoService.syncRepo(clientId, repoId, secondSyncedAt);

      const repo = await db
        .selectFrom("repos")
        .selectAll()
        .where("id", "=", repoId)
        .executeTakeFirst();

      expect(repo).toBeDefined();
      expect(repo?.synced_at?.toISOString()).toBe(secondSyncedAt.toISOString());
    });
  });
});
