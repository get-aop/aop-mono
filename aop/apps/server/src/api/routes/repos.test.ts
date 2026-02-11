import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createClientRepository } from "../../clients/client-repository.ts";
import { createClientService } from "../../clients/client-service.ts";
import type { Database } from "../../db/schema.ts";
import { cleanupTestDb, createTestClient, createTestDb } from "../../db/test-utils.ts";
import { createRepoRepository } from "../../repos/repo-repository.ts";
import { createRepoService } from "../../repos/repo-service.ts";
import { authMiddleware } from "../middleware/auth.ts";
import type { AppContext } from "../server.ts";
import { repos } from "./repos.ts";

describe("POST /repos/:repoId/sync", () => {
  let db: Kysely<Database>;
  let app: Hono;
  let testApiKey: string;

  beforeAll(async () => {
    db = await createTestDb();

    const clientRepo = createClientRepository(db);
    const clientService = createClientService(clientRepo);
    const repoRepo = createRepoRepository(db);
    const repoService = createRepoService(repoRepo);

    mock.module("../server.ts", () => ({
      getAppContext: (): Partial<AppContext> => ({ db, clientService, repoService }),
    }));

    app = new Hono();
    app.use("/repos/*", authMiddleware);
    app.route("/", repos);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const setup = async () => {
    const { apiKey } = await createTestClient(db, { id: "c-1", apiKey: "test-key" });
    testApiKey = apiKey;
  };

  test("syncs a repo successfully", async () => {
    await setup();
    const syncedAt = new Date().toISOString();

    const res = await app.request("/repos/repo-1/sync", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ syncedAt }),
    });
    const body = (await res.json()) as { ok: boolean };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);

    const repo = await db
      .selectFrom("repos")
      .selectAll()
      .where("id", "=", "repo-1")
      .executeTakeFirst();
    expect(repo).not.toBeNull();
    expect(repo?.client_id).toBe("c-1");
  });

  test("returns 400 for invalid body", async () => {
    await setup();

    const res = await app.request("/repos/repo-1/sync", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bad: "data" }),
    });
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid request");
  });

  test("returns 401 without auth", async () => {
    const res = await app.request("/repos/repo-1/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ syncedAt: new Date().toISOString() }),
    });

    expect(res.status).toBe(401);
  });
});
