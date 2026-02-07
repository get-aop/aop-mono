import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { SettingKey } from "../settings/types.ts";
import { listWorkflows } from "./handlers.ts";

describe("listWorkflows", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    delete process.env.AOP_SERVER_URL;
    delete process.env.AOP_API_KEY;
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await db.destroy();
  });

  test("returns empty workflows when settings not configured", async () => {
    const result = await listWorkflows(ctx.settingsRepository);
    expect(result.workflows).toEqual([]);
  });

  test("returns empty workflows when only server URL is set", async () => {
    await ctx.settingsRepository.set(SettingKey.SERVER_URL, "http://localhost:9999");
    const result = await listWorkflows(ctx.settingsRepository);
    expect(result.workflows).toEqual([]);
  });

  test("returns empty workflows when only API key is set", async () => {
    await ctx.settingsRepository.set(SettingKey.API_KEY, "test-key");
    const result = await listWorkflows(ctx.settingsRepository);
    expect(result.workflows).toEqual([]);
  });

  test("fetches workflows from remote server", async () => {
    await ctx.settingsRepository.set(SettingKey.SERVER_URL, "http://localhost:9999");
    await ctx.settingsRepository.set(SettingKey.API_KEY, "test-key");

    const mockFetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ workflows: ["aop-default", "custom"] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await listWorkflows(ctx.settingsRepository);

    expect(result.workflows).toEqual(["aop-default", "custom"]);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:9999/workflows",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      }),
    );
  });

  test("returns empty workflows when fetch throws (network error)", async () => {
    await ctx.settingsRepository.set(SettingKey.SERVER_URL, "http://localhost:9999");
    await ctx.settingsRepository.set(SettingKey.API_KEY, "test-key");

    const mockFetch = mock(() => Promise.reject(new TypeError("fetch failed")));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await listWorkflows(ctx.settingsRepository);
    expect(result.workflows).toEqual([]);
  });

  test("returns empty workflows when remote server fails", async () => {
    await ctx.settingsRepository.set(SettingKey.SERVER_URL, "http://localhost:9999");
    await ctx.settingsRepository.set(SettingKey.API_KEY, "test-key");

    const mockFetch = mock(() =>
      Promise.resolve(new Response("Internal Server Error", { status: 500 })),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await listWorkflows(ctx.settingsRepository);
    expect(result.workflows).toEqual([]);
  });
});
