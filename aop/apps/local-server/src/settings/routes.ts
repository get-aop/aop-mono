import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import {
  cleanupRemovedWorktrees,
  getAllSettings,
  getSetting,
  setAllSettings,
  setSetting,
} from "./handlers.ts";

export const createSettingsRoutes = (ctx: LocalServerContext) => {
  const routes = new Hono();

  routes.get("/", async (c) => {
    const result = await getAllSettings(ctx);
    return c.json({ settings: result.settings });
  });

  routes.put("/", async (c) => {
    const body = await c.req.json<{ settings: Array<{ key: string; value: string }> }>();

    if (!Array.isArray(body.settings)) {
      return c.json({ error: "Missing required field: settings" }, 400);
    }

    const result = await setAllSettings(ctx, body.settings);
    if (!result.success) {
      if (result.error.code === "INVALID_VALUE") {
        return c.json(
          {
            error: "Invalid value",
            key: result.error.key,
            value: result.error.value,
            validValues: result.error.validValues,
          },
          400,
        );
      }
      return c.json(
        { error: "Invalid key", key: result.error.key, validKeys: result.error.validKeys },
        400,
      );
    }

    return c.json({ ok: true, settings: result.settings });
  });

  routes.post("/cleanup-worktrees", async (c) => {
    const result = await cleanupRemovedWorktrees(ctx);
    return c.json(result);
  });

  routes.get("/:key", async (c) => {
    const key = c.req.param("key");

    const result = await getSetting(ctx, key);
    if (!result.success) {
      return c.json({ error: "Invalid key", key, validKeys: result.error.validKeys }, 400);
    }

    return c.json({ key: result.key, value: result.value });
  });

  routes.put("/:key", async (c) => {
    const key = c.req.param("key");
    const body = await c.req.json<{ value: string }>();

    if (body.value === undefined) {
      return c.json({ error: "Missing required field: value" }, 400);
    }

    const result = await setSetting(ctx, key, body.value);
    if (!result.success) {
      if (result.error.code === "INVALID_VALUE") {
        return c.json(
          { error: "Invalid value", key, value: body.value, validValues: result.error.validValues },
          400,
        );
      }
      return c.json({ error: "Invalid key", key, validKeys: result.error.validKeys }, 400);
    }

    return c.json({ ok: true, key: result.key, value: result.value });
  });

  return routes;
};
