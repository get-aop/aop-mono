import { Hono, type Context } from "hono";
import type { LinearRoutesDeps } from "./types.ts";
import { LinearHandlersError } from "./handlers.ts";

export const createLinearRoutes = (deps: LinearRoutesDeps) => {
  const app = new Hono();

  app.post("/connect", async (c) => {
    try {
      return c.json(await deps.handlers.connect());
    } catch (error) {
      return toErrorResponse(c, error);
    }
  });

  app.get("/callback", async (c) => {
    try {
      return c.json(
        await deps.handlers.callback({
          code: c.req.query("code") ?? null,
          error: c.req.query("error") ?? null,
          errorDescription: c.req.query("error_description") ?? null,
          state: c.req.query("state") ?? null,
        }),
      );
    } catch (error) {
      return toErrorResponse(c, error);
    }
  });

  app.get("/status", async (c) => {
    return c.json(await deps.handlers.getStatus());
  });

  app.post("/unlock", async (c) => {
    try {
      await deps.handlers.unlock();
      return c.json({ ok: true });
    } catch (error) {
      return toErrorResponse(c, error);
    }
  });

  app.post("/disconnect", async (c) => {
    try {
      await deps.handlers.disconnect();
      return c.json({ ok: true });
    } catch (error) {
      return toErrorResponse(c, error);
    }
  });

  app.post("/test-connection", async (c) => {
    try {
      return c.json(await deps.handlers.testConnection());
    } catch (error) {
      return toErrorResponse(c, error);
    }
  });

  return app;
};

const toErrorResponse = (c: Context, error: unknown) => {
  if (error instanceof LinearHandlersError) {
    return c.json({ error: error.message }, error.status);
  }

  const message = error instanceof Error ? error.message : "Unknown Linear integration error";
  return c.json({ error: message }, 500);
};
