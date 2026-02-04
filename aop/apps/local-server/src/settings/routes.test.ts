import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb } from "../db/test-utils.ts";
import { createSettingsRoutes } from "./routes.ts";
import { VALID_KEYS } from "./types.ts";

describe("settings/routes", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: Hono;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    app = new Hono();
    app.route("/api/settings", createSettingsRoutes(ctx));
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("GET /api/settings", () => {
    test("returns all settings with defaults", async () => {
      const res = await app.request("/api/settings");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.settings).toBeInstanceOf(Array);
      expect(body.settings.length).toBe(VALID_KEYS.length);

      const maxConcurrent = body.settings.find(
        (s: { key: string }) => s.key === "max_concurrent_tasks",
      );
      expect(maxConcurrent).toBeDefined();
      expect(maxConcurrent.value).toBe("1");
    });
  });

  describe("GET /api/settings/:key", () => {
    test("returns setting value for valid key", async () => {
      const res = await app.request("/api/settings/max_concurrent_tasks");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.key).toBe("max_concurrent_tasks");
      expect(body.value).toBe("1");
    });

    test("returns 400 for invalid key", async () => {
      const res = await app.request("/api/settings/invalid_key");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Invalid key");
      expect(body.key).toBe("invalid_key");
      expect(body.validKeys).toEqual(VALID_KEYS);
    });
  });

  describe("PUT /api/settings/:key", () => {
    test("updates setting value for valid key", async () => {
      const res = await app.request("/api/settings/max_concurrent_tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "5" }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.key).toBe("max_concurrent_tasks");
      expect(body.value).toBe("5");

      const getRes = await app.request("/api/settings/max_concurrent_tasks");
      const getBody: AnyJson = await getRes.json();
      expect(getBody.value).toBe("5");
    });

    test("returns 400 for invalid key", async () => {
      const res = await app.request("/api/settings/invalid_key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "test" }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Invalid key");
    });

    test("returns 400 when value is missing", async () => {
      const res = await app.request("/api/settings/max_concurrent_tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Missing required field: value");
    });
  });
});
