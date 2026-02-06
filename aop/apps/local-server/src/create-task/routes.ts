import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import { createCreateTaskService } from "./service.ts";

interface StartBody {
  description?: string;
  maxQuestions?: number;
  cwd?: string;
}

interface AnswerBody {
  answer?: string;
}

interface FinalizeBody {
  createChange?: boolean;
}

interface CreateTaskRoutesDeps {
  service?: ReturnType<typeof createCreateTaskService>;
}

export const createCreateTaskRoutes = (
  ctx: LocalServerContext,
  deps: CreateTaskRoutesDeps = {},
) => {
  const routes = new Hono();
  const service = deps.service ?? createCreateTaskService(ctx);

  routes.post("/start", async (c) => {
    const body = (await c.req.json()) as StartBody;
    if (!body.description || !body.cwd) {
      return c.json({ error: "Missing required fields: description, cwd" }, 400);
    }

    const result = await service.start({
      description: body.description,
      cwd: body.cwd,
      maxQuestions: body.maxQuestions,
    });

    if (result.status === "error") {
      const statusCode = result.code === "not_found" ? 404 : 400;
      return c.json({ error: result.error, sessionId: result.sessionId }, statusCode);
    }

    return c.json(result);
  });

  routes.post("/:sessionId/answer", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body = (await c.req.json()) as AnswerBody;
    if (!body.answer) {
      return c.json({ error: "Missing required field: answer" }, 400);
    }

    const result = await service.answer({ sessionId, answer: body.answer });
    if (result.status === "error") {
      const statusCode = result.code === "not_found" ? 404 : 400;
      return c.json({ error: result.error, sessionId: result.sessionId }, statusCode);
    }

    return c.json(result);
  });

  routes.post("/:sessionId/finalize", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body = (await c.req.json()) as FinalizeBody;
    if (typeof body.createChange !== "boolean") {
      return c.json({ error: "Missing required field: createChange" }, 400);
    }

    const result = await service.finalize({ sessionId, createChange: body.createChange });
    if (result.status === "error") {
      const statusCode = result.code === "not_found" ? 404 : 400;
      return c.json({ error: result.error, sessionId: result.sessionId }, statusCode);
    }

    return c.json(result);
  });

  routes.post("/:sessionId/cancel", async (c) => {
    const sessionId = c.req.param("sessionId");
    const result = await service.cancel({ sessionId });
    if (result.status === "error") {
      const statusCode = result.code === "not_found" ? 404 : 400;
      return c.json({ error: result.error, sessionId: result.sessionId }, statusCode);
    }

    return c.json(result);
  });

  return routes;
};
