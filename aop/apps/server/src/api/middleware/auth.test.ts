import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { Database } from "../../db/schema.ts";
import { cleanupTestDb, createTestClient, createTestDb } from "../../db/test-utils.ts";
import type { AppContext } from "../server.ts";
import { authMiddleware } from "./auth.ts";

describe("authMiddleware", () => {
  let db: Kysely<Database>;
  let app: Hono;

  beforeAll(async () => {
    db = await createTestDb();

    mock.module("../server.ts", () => ({
      getAppContext: (): Partial<AppContext> => ({ db }),
    }));

    app = new Hono();
    app.use("/*", authMiddleware);
    app.get("/protected", (c) => c.json({ ok: true }));
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  test("returns 401 when Authorization header is missing", async () => {
    const res = await app.request("/protected");
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("Missing API key");
  });

  test("returns 401 when Authorization header has no Bearer token", async () => {
    const res = await app.request("/protected", {
      headers: { Authorization: "" },
    });
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("Missing API key");
  });

  test("returns 401 when API key is unknown", async () => {
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer unknown-key" },
    });
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("Invalid API key");
  });

  test("passes through and sets client for valid API key", async () => {
    const { apiKey } = await createTestClient(db, { id: "c-1", apiKey: "valid-key" });

    const res = await app.request("/protected", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const body = (await res.json()) as { ok: boolean };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  test("updates last_seen_at on successful auth", async () => {
    const { id, apiKey } = await createTestClient(db, { id: "c-2", apiKey: "seen-key" });

    await app.request("/protected", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const client = await db
      .selectFrom("clients")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();

    expect(client.last_seen_at).not.toBeNull();
  });
});
