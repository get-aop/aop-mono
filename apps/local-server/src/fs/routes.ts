import { Hono } from "hono";
import { listDirectories } from "./handlers.ts";

export const createFsRoutes = () => {
  const routes = new Hono();

  routes.get("/directories", async (c) => {
    const pathParam = c.req.query("path");
    const hidden = c.req.query("hidden") === "true";

    const result = await listDirectories(pathParam, { hidden });

    if (!result.success) {
      switch (result.error.code) {
        case "NOT_FOUND":
          return c.json({ error: "Path not found" }, 404);
        case "NOT_A_DIRECTORY":
          return c.json({ error: "Path is not a directory" }, 400);
        case "PERMISSION_DENIED":
          return c.json({ error: "Permission denied" }, 403);
      }
    }

    return c.json(result.data);
  });

  return routes;
};
