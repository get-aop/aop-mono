import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { cleanupTestDb, createTestClient, createTestDb } from "../db/test-utils.ts";
import { createRepoRepository, type RepoRepository } from "./repo-repository.ts";

describe("RepoRepository", () => {
  let db: Kysely<Database>;
  let repository: RepoRepository;
  let clientId: string;

  beforeAll(async () => {
    db = await createTestDb();
    repository = createRepoRepository(db);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const setupClient = async () => {
    const result = await createTestClient(db);
    clientId = result.id;
    return clientId;
  };

  describe("upsert", () => {
    test("creates a new repo", async () => {
      await setupClient();
      const now = new Date();

      const repo = await repository.upsert({
        id: "repo-1",
        client_id: clientId,
        synced_at: now,
      });

      expect(repo.id).toBe("repo-1");
      expect(repo.client_id).toBe(clientId);
      expect(repo.synced_at).toEqual(now);
    });

    test("updates existing repo synced_at on conflict", async () => {
      await setupClient();
      const firstSync = new Date("2026-01-01");
      const secondSync = new Date("2026-02-01");

      await repository.upsert({
        id: "repo-1",
        client_id: clientId,
        synced_at: firstSync,
      });

      const updated = await repository.upsert({
        id: "repo-1",
        client_id: clientId,
        synced_at: secondSync,
      });

      expect(updated.synced_at).toEqual(secondSync);
    });
  });

  describe("findById", () => {
    test("returns repo by ID", async () => {
      await setupClient();
      await repository.upsert({
        id: "repo-1",
        client_id: clientId,
        synced_at: new Date(),
      });

      const repo = await repository.findById("repo-1");

      expect(repo).not.toBeNull();
      expect(repo?.client_id).toBe(clientId);
    });

    test("returns null for non-existent ID", async () => {
      const repo = await repository.findById("non-existent");

      expect(repo).toBeNull();
    });
  });
});
