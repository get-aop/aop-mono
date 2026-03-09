import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createClientRepository } from "../../clients/client-repository.ts";
import { createClientService } from "../../clients/client-service.ts";
import type { Database } from "../../db/schema.ts";
import { cleanupTestDb, createTestClient, createTestDb } from "../../db/test-utils.ts";
import type { AppContext } from "../server.ts";
import { auth } from "./auth.ts";

describe("POST /auth", () => {
  let db: Kysely<Database>;
  let app: Hono;

  beforeAll(async () => {
    db = await createTestDb();

    const clientRepo = createClientRepository(db);
    const clientService = createClientService(clientRepo);

    mock.module("../server.ts", () => ({
      getAppContext: (): Partial<AppContext> => ({ clientService }),
    }));

    app = new Hono();
    app.route("/", auth);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  test("authenticates with valid API key", async () => {
    const { id, apiKey } = await createTestClient(db, { id: "c-1", apiKey: "key-1" });

    const res = await app.request("/auth", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as { clientId: string; effectiveMaxConcurrentTasks: number };

    expect(res.status).toBe(200);
    expect(body.clientId).toBe(id);
    expect(body.effectiveMaxConcurrentTasks).toBe(5);
  });

  test("returns 401 when API key is missing", async () => {
    const res = await app.request("/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("Missing API key");
  });

  test("returns 401 when API key is invalid", async () => {
    const res = await app.request("/auth", {
      method: "POST",
      headers: {
        Authorization: "Bearer bad-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("Invalid API key");
  });

  test("respects requestedMaxConcurrentTasks", async () => {
    await createTestClient(db, { id: "c-2", apiKey: "key-2", maxConcurrentTasks: 10 });

    const res = await app.request("/auth", {
      method: "POST",
      headers: {
        Authorization: "Bearer key-2",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requestedMaxConcurrentTasks: 3 }),
    });
    const body = (await res.json()) as { clientId: string; effectiveMaxConcurrentTasks: number };

    expect(res.status).toBe(200);
    expect(body.effectiveMaxConcurrentTasks).toBe(3);
  });
});
