import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb } from "../db/test-utils.ts";
import { createSessionRoutes } from "./routes.ts";

const createSession = (app: Hono, body: Record<string, unknown>) =>
  app.request("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const addMessage = (app: Hono, sessionId: string, body: Record<string, unknown>) =>
  app.request(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("session/routes", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: Hono;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    app = new Hono();
    app.route("/api/sessions", createSessionRoutes(ctx));
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("POST /api/sessions", () => {
    test("creates a session and returns 201", async () => {
      const res = await createSession(app, {
        id: "sess-1",
        claude_session_id: "claude-abc",
        status: "active",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(201);
      expect(body.session).toBeDefined();
      expect(body.session.id).toBe("sess-1");
      expect(body.session.claude_session_id).toBe("claude-abc");
      expect(body.session.status).toBe("active");
    });

    test("returns 400 when id is missing", async () => {
      const res = await createSession(app, {
        claude_session_id: "claude-abc",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Missing required fields: id, claude_session_id");
    });

    test("returns 400 when claude_session_id is missing", async () => {
      const res = await createSession(app, {
        id: "sess-1",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Missing required fields: id, claude_session_id");
    });
  });

  describe("GET /api/sessions", () => {
    test("returns active sessions", async () => {
      await createSession(app, {
        id: "sess-active",
        claude_session_id: "claude-1",
        status: "active",
      });
      await createSession(app, {
        id: "sess-brainstorm",
        claude_session_id: "claude-2",
        status: "brainstorming",
      });

      const res = await app.request("/api/sessions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.sessions).toBeInstanceOf(Array);
      expect(body.sessions.length).toBe(2);
    });

    test("returns sessions filtered by status query param", async () => {
      await createSession(app, {
        id: "sess-active",
        claude_session_id: "claude-1",
        status: "active",
      });
      await createSession(app, {
        id: "sess-completed",
        claude_session_id: "claude-2",
        status: "completed",
      });

      const res = await app.request("/api/sessions?status=active,brainstorming");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.sessions).toBeInstanceOf(Array);
      // getActive filters for active and brainstorming only
      expect(
        body.sessions.every(
          (s: { status: string }) => s.status === "active" || s.status === "brainstorming",
        ),
      ).toBe(true);
    });

    test("returns empty array when no sessions exist", async () => {
      const res = await app.request("/api/sessions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.sessions).toEqual([]);
    });
  });

  describe("GET /api/sessions/:id", () => {
    test("returns session by id", async () => {
      await createSession(app, {
        id: "sess-1",
        claude_session_id: "claude-abc",
        status: "active",
      });

      const res = await app.request("/api/sessions/sess-1");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.session).toBeDefined();
      expect(body.session.id).toBe("sess-1");
      expect(body.session.claude_session_id).toBe("claude-abc");
    });

    test("returns 404 for non-existent session", async () => {
      const res = await app.request("/api/sessions/non-existent");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Session not found");
    });
  });

  describe("PATCH /api/sessions/:id", () => {
    test("updates session status", async () => {
      await createSession(app, {
        id: "sess-1",
        claude_session_id: "claude-abc",
        status: "active",
      });

      const res = await app.request("/api/sessions/sess-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.session.status).toBe("completed");
    });

    test("updates continuation_count", async () => {
      await createSession(app, {
        id: "sess-1",
        claude_session_id: "claude-abc",
        status: "active",
      });

      const res = await app.request("/api/sessions/sess-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ continuation_count: 3 }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.session.continuation_count).toBe(3);
    });

    test("returns 404 for non-existent session", async () => {
      const res = await app.request("/api/sessions/non-existent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Session not found");
    });
  });

  describe("POST /api/sessions/:id/messages", () => {
    test("adds a message and returns 201", async () => {
      await createSession(app, {
        id: "sess-1",
        claude_session_id: "claude-abc",
        status: "active",
      });

      const res = await addMessage(app, "sess-1", {
        id: "msg-1",
        role: "user",
        content: "Hello, Claude!",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(201);
      expect(body.message).toBeDefined();
      expect(body.message.id).toBe("msg-1");
      expect(body.message.role).toBe("user");
      expect(body.message.content).toBe("Hello, Claude!");
      expect(body.message.session_id).toBe("sess-1");
    });

    test("returns 400 when required fields are missing", async () => {
      await createSession(app, {
        id: "sess-1",
        claude_session_id: "claude-abc",
        status: "active",
      });

      const res = await addMessage(app, "sess-1", {
        id: "msg-1",
        role: "user",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Missing required fields: id, role, content");
    });

    test("returns 404 when session does not exist", async () => {
      const res = await addMessage(app, "non-existent", {
        id: "msg-1",
        role: "user",
        content: "Hello",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Session not found");
    });
  });

  describe("GET /api/sessions/:id/messages", () => {
    test("returns messages for a session", async () => {
      await createSession(app, {
        id: "sess-1",
        claude_session_id: "claude-abc",
        status: "active",
      });
      await addMessage(app, "sess-1", {
        id: "msg-1",
        role: "user",
        content: "Hello",
      });
      await addMessage(app, "sess-1", {
        id: "msg-2",
        role: "assistant",
        content: "Hi there!",
      });

      const res = await app.request("/api/sessions/sess-1/messages");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.messages).toBeInstanceOf(Array);
      expect(body.messages.length).toBe(2);
      expect(body.messages[0].id).toBe("msg-1");
      expect(body.messages[0].role).toBe("user");
      expect(body.messages[1].id).toBe("msg-2");
      expect(body.messages[1].role).toBe("assistant");
    });

    test("returns empty array when session has no messages", async () => {
      await createSession(app, {
        id: "sess-1",
        claude_session_id: "claude-abc",
        status: "active",
      });

      const res = await app.request("/api/sessions/sess-1/messages");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.messages).toEqual([]);
    });

    test("returns 404 when session does not exist", async () => {
      const res = await app.request("/api/sessions/non-existent/messages");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Session not found");
    });
  });
});
