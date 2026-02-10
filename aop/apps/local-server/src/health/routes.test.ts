import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb } from "../db/test-utils.ts";
import { createHealthRoutes } from "./routes.ts";

describe("health routes", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: ReturnType<typeof createHealthRoutes>;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    app = createHealthRoutes({ ctx, startTimeMs: Date.now() - 1000 });
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("GET /", () => {
    test("returns ok status with service info", async () => {
      const res = await app.request("/");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.service).toBe("aop");
      expect(body.db).toEqual({ connected: true });
    });
  });
});
