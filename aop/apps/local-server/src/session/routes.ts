import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";

export const createSessionRoutes = (ctx: LocalServerContext) => {
  const routes = new Hono();

  routes.post("/", async (c) => {
    const body = await c.req.json();
    if (!body.id || !body.claude_session_id) {
      return c.json({ error: "Missing required fields: id, claude_session_id" }, 400);
    }

    const session = await ctx.sessionRepository.create(body);
    return c.json({ session }, 201);
  });

  routes.get("/", async (c) => {
    const status = c.req.query("status");
    if (status) {
      const sessions = await ctx.sessionRepository.getActive();
      return c.json({ sessions });
    }
    const sessions = await ctx.sessionRepository.getActive();
    return c.json({ sessions });
  });

  routes.get("/:id", async (c) => {
    const id = c.req.param("id");
    const session = await ctx.sessionRepository.get(id);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json({ session });
  });

  routes.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const session = await ctx.sessionRepository.update(id, body);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json({ session });
  });

  routes.post("/:id/messages", async (c) => {
    const sessionId = c.req.param("id");
    const body = await c.req.json();
    if (!body.id || !body.role || !body.content) {
      return c.json({ error: "Missing required fields: id, role, content" }, 400);
    }

    const session = await ctx.sessionRepository.get(sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const message = await ctx.sessionRepository.addMessage({
      ...body,
      session_id: sessionId,
    });
    return c.json({ message }, 201);
  });

  routes.get("/:id/messages", async (c) => {
    const sessionId = c.req.param("id");

    const session = await ctx.sessionRepository.get(sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const messages = await ctx.sessionRepository.getMessages(sessionId);
    return c.json({ messages });
  });

  return routes;
};
