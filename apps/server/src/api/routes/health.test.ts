import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { health } from "./health.ts";

describe("GET /health", () => {
  const app = new Hono().route("/", health);

  test("returns ok status and version", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", version: "1.0.0" });
  });
});
