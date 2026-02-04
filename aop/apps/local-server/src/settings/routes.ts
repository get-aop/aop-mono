import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import { getAllSettings, getSetting, setSetting } from "./handlers.ts";

export const createSettingsRoutes = (ctx: LocalServerContext) => {
  const routes = new Hono();

  routes.get("/", async (c) => {
    const result = await getAllSettings(ctx);
    return c.json({ settings: result.settings });
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
      return c.json({ error: "Invalid key", key, validKeys: result.error.validKeys }, 400);
    }

    return c.json({ ok: true, key: result.key, value: result.value });
  });

  return routes;
};
