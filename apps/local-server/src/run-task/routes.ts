import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import { createRunTaskService } from "./service.ts";

interface StartBody {
  changeName?: string;
  cwd?: string;
}

interface RunTaskRoutesDeps {
  service?: ReturnType<typeof createRunTaskService>;
}

export const createRunTaskRoutes = (ctx: LocalServerContext, deps: RunTaskRoutesDeps = {}) => {
  const routes = new Hono();
  const service = deps.service ?? createRunTaskService(ctx);

  routes.post("/start", async (c) => {
    const body = (await c.req.json()) as StartBody;
    if (!body.changeName || !body.cwd) {
      return c.json({ error: "Missing required fields: changeName, cwd" }, 400);
    }

    const result = await service.run({
      changeName: body.changeName,
      cwd: body.cwd,
    });

    if (result.status === "error") {
      return c.json(
        {
          error: result.error,
          sessionId: result.sessionId,
        },
        400,
      );
    }

    return c.json(result);
  });

  return routes;
};
