import { Hono } from "hono";
import { getHealth, type HealthDeps } from "./handlers.ts";

export const createHealthRoutes = (deps: HealthDeps) => {
  const app = new Hono();

  app.get("/", async (c) => {
    return c.json(await getHealth(deps));
  });

  return app;
};
