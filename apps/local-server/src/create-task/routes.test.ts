import { describe, expect, test } from "bun:test";
import { type Hono, Hono as HonoApp } from "hono";
import type { LocalServerContext } from "../context.ts";
import { createCreateTaskRoutes } from "./routes.ts";
import type {
  CreateTaskCancelResult,
  CreateTaskFinalizeResponse,
  CreateTaskStepResponse,
} from "./service.ts";

type CreateTaskService = {
  start: (_input: {
    description: string;
    cwd: string;
    maxQuestions?: number;
  }) => Promise<CreateTaskStepResponse>;
  answer: (_input: { sessionId: string; answer: string }) => Promise<CreateTaskStepResponse>;
  finalize: (_input: {
    sessionId: string;
    createChange: boolean;
  }) => Promise<CreateTaskFinalizeResponse>;
  cancel: (_input: { sessionId: string }) => Promise<CreateTaskCancelResult>;
};

interface JsonValue {
  [key: string]: unknown;
}

interface ServiceOverrides {
  start?: CreateTaskService["start"];
  answer?: CreateTaskService["answer"];
  finalize?: CreateTaskService["finalize"];
  cancel?: CreateTaskService["cancel"];
}

const createApp = (overrides: ServiceOverrides = {}): Hono => {
  const service: CreateTaskService = {
    start: async () => ({
      status: "completed",
      sessionId: "sess-1",
      requirements: {
        title: "Feature",
        description: "Desc",
        requirements: ["R1"],
        acceptanceCriteria: ["A1"],
      },
    }),
    answer: async () => ({
      status: "completed",
      sessionId: "sess-1",
      requirements: {
        title: "Feature",
        description: "Desc",
        requirements: ["R1"],
        acceptanceCriteria: ["A1"],
      },
    }),
    finalize: async () => ({
      status: "success",
      sessionId: "sess-1",
      requirements: {
        title: "Feature",
        description: "Desc",
        requirements: ["R1"],
        acceptanceCriteria: ["A1"],
      },
      changeName: "feature",
    }),
    cancel: async () => ({ status: "success", sessionId: "sess-1" }),
    ...overrides,
  };

  const app = new HonoApp();
  app.route(
    "/api/create-task",
    createCreateTaskRoutes({} as LocalServerContext, { service: service as never }),
  );
  return app;
};

const parseBody = async (response: Response): Promise<JsonValue> => {
  return (await response.json()) as JsonValue;
};

describe("create-task/routes", () => {
  test("POST /start returns 400 for missing fields", async () => {
    const app = createApp();
    const response = await app.request("/api/create-task/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const body = await parseBody(response);
    expect(response.status).toBe(400);
    expect(body.error).toBe("Missing required fields: description, cwd");
  });

  test("POST /start returns service success", async () => {
    const app = createApp({
      start: async ({ maxQuestions }) => ({
        status: "question",
        sessionId: "sess-42",
        question: { question: "Which stack?" },
        questionCount: maxQuestions ?? 0,
        maxQuestions: maxQuestions ?? 0,
      }),
    });

    const response = await app.request("/api/create-task/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Build dashboard", cwd: "/repo", maxQuestions: 7 }),
    });

    const body = await parseBody(response);
    expect(response.status).toBe(200);
    expect(body.status).toBe("question");
    expect(body.maxQuestions).toBe(7);
  });

  test("POST /start maps not_found errors to 404", async () => {
    const app = createApp({
      start: async () => ({
        status: "error",
        code: "not_found",
        error: "Not found",
        sessionId: "sess-x",
      }),
    });

    const response = await app.request("/api/create-task/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Build dashboard", cwd: "/repo" }),
    });

    const body = await parseBody(response);
    expect(response.status).toBe(404);
    expect(body.error).toBe("Not found");
    expect(body.sessionId).toBe("sess-x");
  });

  test("POST /start maps non-not_found errors to 400", async () => {
    const app = createApp({
      start: async () => ({
        status: "error",
        code: "internal",
        error: "Bad request",
        sessionId: "sess-x",
      }),
    });

    const response = await app.request("/api/create-task/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Build dashboard", cwd: "/repo" }),
    });

    const body = await parseBody(response);
    expect(response.status).toBe(400);
    expect(body.error).toBe("Bad request");
  });

  test("POST /:sessionId/answer returns 400 for missing answer", async () => {
    const app = createApp();
    const response = await app.request("/api/create-task/sess-1/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const body = await parseBody(response);
    expect(response.status).toBe(400);
    expect(body.error).toBe("Missing required field: answer");
  });

  test("POST /:sessionId/answer returns success", async () => {
    const app = createApp({
      answer: async ({ sessionId, answer }) => ({
        status: "question",
        sessionId,
        question: { question: `Why ${answer}?` },
        questionCount: 2,
        maxQuestions: 5,
      }),
    });

    const response = await app.request("/api/create-task/sess-1/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "React" }),
    });

    const body = await parseBody(response);
    expect(response.status).toBe(200);
    expect(body.status).toBe("question");
    expect(body.questionCount).toBe(2);
  });

  test("POST /:sessionId/answer maps not_found errors to 404", async () => {
    const app = createApp({
      answer: async () => ({
        status: "error",
        code: "not_found",
        error: "Session not found",
        sessionId: "sess-missing",
      }),
    });

    const response = await app.request("/api/create-task/sess-missing/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "React" }),
    });

    const body = await parseBody(response);
    expect(response.status).toBe(404);
    expect(body.error).toBe("Session not found");
  });

  test("POST /:sessionId/answer maps invalid_state errors to 400", async () => {
    const app = createApp({
      answer: async () => ({
        status: "error",
        code: "invalid_state",
        error: "Session is not waiting for an answer",
        sessionId: "sess-1",
      }),
    });

    const response = await app.request("/api/create-task/sess-1/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "React" }),
    });

    const body = await parseBody(response);
    expect(response.status).toBe(400);
    expect(body.error).toBe("Session is not waiting for an answer");
  });

  test("POST /:sessionId/finalize returns 400 for missing createChange", async () => {
    const app = createApp();
    const response = await app.request("/api/create-task/sess-1/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const body = await parseBody(response);
    expect(response.status).toBe(400);
    expect(body.error).toBe("Missing required field: createChange");
  });

  test("POST /:sessionId/finalize returns success", async () => {
    const app = createApp({
      finalize: async ({ sessionId, createChange }) => ({
        status: "success",
        sessionId,
        requirements: {
          title: "Feature",
          description: "Desc",
          requirements: ["R1"],
          acceptanceCriteria: ["A1"],
        },
        changeName: createChange ? "feature" : undefined,
      }),
    });

    const response = await app.request("/api/create-task/sess-1/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ createChange: true }),
    });

    const body = await parseBody(response);
    expect(response.status).toBe(200);
    expect(body.status).toBe("success");
    expect(body.changeName).toBe("feature");
  });

  test("POST /:sessionId/finalize maps not_found errors to 404", async () => {
    const app = createApp({
      finalize: async () => ({
        status: "error",
        code: "not_found",
        error: "Session not found",
        sessionId: "sess-missing",
      }),
    });

    const response = await app.request("/api/create-task/sess-missing/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ createChange: false }),
    });

    const body = await parseBody(response);
    expect(response.status).toBe(404);
    expect(body.error).toBe("Session not found");
  });

  test("POST /:sessionId/finalize maps invalid_state errors to 400", async () => {
    const app = createApp({
      finalize: async () => ({
        status: "error",
        code: "invalid_state",
        error: "No requirements gathered",
        sessionId: "sess-1",
      }),
    });

    const response = await app.request("/api/create-task/sess-1/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ createChange: false }),
    });

    const body = await parseBody(response);
    expect(response.status).toBe(400);
    expect(body.error).toBe("No requirements gathered");
  });

  test("POST /:sessionId/cancel returns success", async () => {
    const app = createApp();
    const response = await app.request("/api/create-task/sess-1/cancel", {
      method: "POST",
    });

    const body = await parseBody(response);
    expect(response.status).toBe(200);
    expect(body.status).toBe("success");
  });

  test("POST /:sessionId/cancel maps not_found errors to 404", async () => {
    const app = createApp({
      cancel: async () => ({
        status: "error",
        code: "not_found",
        error: "Session not found",
        sessionId: "sess-missing",
      }),
    });

    const response = await app.request("/api/create-task/sess-missing/cancel", {
      method: "POST",
    });

    const body = await parseBody(response);
    expect(response.status).toBe(404);
    expect(body.error).toBe("Session not found");
  });

  test("POST /:sessionId/cancel maps internal errors to 400", async () => {
    const app = createApp({
      cancel: async () => ({
        status: "error",
        code: "internal",
        error: "Cannot cancel",
        sessionId: "sess-1",
      }),
    });

    const response = await app.request("/api/create-task/sess-1/cancel", {
      method: "POST",
    });

    const body = await parseBody(response);
    expect(response.status).toBe(400);
    expect(body.error).toBe("Cannot cancel");
  });
});
