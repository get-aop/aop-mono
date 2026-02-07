import { describe, expect, test } from "bun:test";
import { Hono as HonoApp } from "hono";
import type { LocalServerContext } from "../context.ts";
import { createRunTaskRoutes } from "./routes.ts";
import type { RunTaskResponse } from "./service.ts";

type RunTaskService = {
  run: (_input: { changeName: string; cwd: string }) => Promise<RunTaskResponse>;
};

interface JsonValue {
  [key: string]: unknown;
}

const createApp = (overrides: Partial<RunTaskService> = {}) => {
  const service: RunTaskService = {
    run: async () => ({
      status: "success",
      changeName: "my-change",
      sessionId: "sess-1",
    }),
    ...overrides,
  };

  const app = new HonoApp();
  app.route(
    "/api/run-task",
    createRunTaskRoutes({} as LocalServerContext, { service: service as never }),
  );
  return app;
};

const parseBody = async (response: Response): Promise<JsonValue> => {
  return (await response.json()) as JsonValue;
};

describe("run-task/routes", () => {
  test("POST /start returns 400 for missing fields", async () => {
    const app = createApp();
    const response = await app.request("/api/run-task/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const body = await parseBody(response);
    expect(response.status).toBe(400);
    expect(body.error).toBe("Missing required fields: changeName, cwd");
  });

  test("POST /start returns 400 for missing changeName", async () => {
    const app = createApp();
    const response = await app.request("/api/run-task/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: "/repo" }),
    });

    const body = await parseBody(response);
    expect(response.status).toBe(400);
    expect(body.error).toBe("Missing required fields: changeName, cwd");
  });

  test("POST /start returns 400 for missing cwd", async () => {
    const app = createApp();
    const response = await app.request("/api/run-task/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changeName: "my-change" }),
    });

    const body = await parseBody(response);
    expect(response.status).toBe(400);
    expect(body.error).toBe("Missing required fields: changeName, cwd");
  });

  test("POST /start returns success response", async () => {
    const app = createApp({
      run: async ({ changeName }) => ({
        status: "success",
        changeName,
        sessionId: "sess-42",
      }),
    });

    const response = await app.request("/api/run-task/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changeName: "my-feature", cwd: "/repo" }),
    });

    const body = await parseBody(response);
    expect(response.status).toBe(200);
    expect(body.status).toBe("success");
    expect(body.changeName).toBe("my-feature");
    expect(body.sessionId).toBe("sess-42");
  });

  test("POST /start maps error to 400", async () => {
    const app = createApp({
      run: async () => ({
        status: "error",
        code: "internal",
        error: "Something went wrong",
        sessionId: "sess-x",
      }),
    });

    const response = await app.request("/api/run-task/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changeName: "my-feature", cwd: "/repo" }),
    });

    const body = await parseBody(response);
    expect(response.status).toBe(400);
    expect(body.error).toBe("Something went wrong");
    expect(body.sessionId).toBe("sess-x");
  });

  test("POST /start passes through success with warning", async () => {
    const app = createApp({
      run: async () => ({
        status: "success",
        changeName: "my-feature",
        sessionId: "sess-1",
        warning: "Change created, but artifact generation failed.",
      }),
    });

    const response = await app.request("/api/run-task/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changeName: "my-feature", cwd: "/repo" }),
    });

    const body = await parseBody(response);
    expect(response.status).toBe(200);
    expect(body.status).toBe("success");
    expect(body.warning).toBe("Change created, but artifact generation failed.");
  });
});
