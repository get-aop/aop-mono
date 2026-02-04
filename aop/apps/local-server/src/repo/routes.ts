import { Hono } from "hono";
import type { CommandContext } from "../context.ts";
import { createTaskRoutes } from "../task/routes";
import { getRepoById, getRepoTasks, initRepo, removeRepo } from "./handlers.ts";

export const createRepoRoutes = (ctx: CommandContext) => {
  const routes = new Hono();

  routes.post("/", async (c) => {
    const body = await c.req.json<{ path: string }>();

    if (!body.path) {
      return c.json({ error: "Missing required field: path" }, 400);
    }

    const result = await initRepo(ctx, body.path);
    if (!result.success) {
      if (result.error.code === "NOT_A_GIT_REPO") {
        return c.json({ error: "Not a git repository", path: result.error.path }, 400);
      }
      return c.json({ error: "Failed to register repo" }, 500);
    }

    return c.json({
      ok: true,
      repoId: result.repoId,
      alreadyExists: result.alreadyExists,
    });
  });

  routes.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const force = c.req.query("force") === "true";

    const repo = await getRepoById(ctx, id);
    if (!repo) {
      return c.json({ error: "Repo not found" }, 404);
    }

    const result = await removeRepo(ctx, repo.path, { force });
    if (!result.success) {
      if (result.error.code === "HAS_WORKING_TASKS") {
        return c.json(
          { error: "Cannot remove repo with working tasks", count: result.error.count },
          409,
        );
      }
      return c.json({ error: "Failed to remove repo" }, 500);
    }

    return c.json({
      ok: true,
      repoId: result.repoId,
      abortedTasks: result.abortedTasks,
    });
  });

  routes.get("/:id/tasks", async (c) => {
    const id = c.req.param("id");

    const repo = await getRepoById(ctx, id);
    if (!repo) {
      return c.json({ error: "Repo not found" }, 404);
    }

    const tasks = await getRepoTasks(ctx, id);
    return c.json({ tasks });
  });

  routes.route("/:repoId/tasks", createTaskRoutes(ctx));

  return routes;
};
