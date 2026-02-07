import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "./error-handler.ts";

describe("errorHandler", () => {
  const createApp = (error: Error) => {
    const app = new Hono();
    app.onError(errorHandler);
    app.get("/fail", () => {
      throw error;
    });
    return app;
  };

  test("returns 400 for JSON parse errors", async () => {
    const app = createApp(new Error("Unexpected end of JSON input"));
    const res = await app.request("/fail");
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid JSON body");
  });

  test("returns 400 for errors containing JSON in message", async () => {
    const app = createApp(new Error("Invalid JSON at position 0"));
    const res = await app.request("/fail");
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid JSON body");
  });

  test("returns 500 for generic errors", async () => {
    const app = createApp(new Error("Something went wrong"));
    const res = await app.request("/fail");
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(body.error).toBe("Internal server error");
  });
});
