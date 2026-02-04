import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import { getRepoById } from "../repo/handlers.ts";
import { applyTask, getTaskById, markTaskReady, removeTask } from "./handlers.ts";

export const createTaskRoutes = (ctx: LocalServerContext) => {
  const routes = new Hono();

  routes.get("/:taskId/executions", async (c) => {
    const repoId = c.req.param("repoId") as string;
    const taskId = c.req.param("taskId");

    const repo = await getRepoById(ctx, repoId);
    if (!repo) {
      return c.json({ error: "Repo not found" }, 404);
    }

    const task = await getTaskById(ctx, taskId);
    if (!task || task.repo_id !== repoId) {
      return c.json({ error: "Task not found" }, 404);
    }

    const executions = await ctx.executionRepository.getExecutionsByTaskId(taskId);

    const transformedExecutions = executions.map((e) => ({
      id: e.id,
      taskId: e.task_id,
      status: e.status === "aborted" || e.status === "cancelled" ? "failed" : e.status,
      startedAt: e.started_at,
      finishedAt: e.completed_at ?? undefined,
    }));

    return c.json({ executions: transformedExecutions });
  });

  routes.post("/:taskId/ready", async (c) => {
    const repoId = c.req.param("repoId") as string;
    const taskId = c.req.param("taskId");

    const repo = await getRepoById(ctx, repoId);
    if (!repo) {
      return c.json({ error: "Repo not found" }, 404);
    }

    const task = await getTaskById(ctx, taskId);
    if (!task || task.repo_id !== repoId) {
      return c.json({ error: "Task not found" }, 404);
    }

    const body = await c.req.json<{ workflow?: string }>().catch(() => ({ workflow: undefined }));
    const result = await markTaskReady(ctx, taskId, {
      workflow: body.workflow,
    });

    if (!result.success) {
      switch (result.error.code) {
        case "NOT_FOUND":
          return c.json({ error: "Task not found" }, 404);
        case "ALREADY_READY":
          return c.json({
            ok: true,
            taskId: result.error.taskId,
            alreadyReady: true,
          });
        case "INVALID_STATUS":
          return c.json({ error: "Invalid task status", status: result.error.status }, 409);
        case "UPDATE_FAILED":
          return c.json({ error: "Failed to update task" }, 500);
      }
    }

    return c.json({ ok: true, taskId: result.task.id });
  });

  routes.post("/:taskId/apply", async (c) => {
    const repoId = c.req.param("repoId") as string;
    const taskId = c.req.param("taskId");

    const repo = await getRepoById(ctx, repoId);
    if (!repo) {
      return c.json({ error: "Repo not found" }, 404);
    }

    const task = await getTaskById(ctx, taskId);
    if (!task || task.repo_id !== repoId) {
      return c.json({ error: "Task not found" }, 404);
    }

    const result = await applyTask(ctx, taskId);

    if (!result.success) {
      switch (result.error.code) {
        case "NOT_FOUND":
          return c.json({ error: "Task not found" }, 404);
        case "INVALID_STATUS":
          return c.json({ error: "Invalid task status", status: result.error.status }, 409);
        case "REPO_NOT_FOUND":
          return c.json({ error: "Repository not found" }, 404);
        case "DIRTY_WORKING_DIRECTORY":
          return c.json({ error: "Main repository has uncommitted changes" }, 409);
        case "CONFLICT":
          return c.json(
            {
              error: "Conflicts detected",
              conflictingFiles: result.error.conflictingFiles,
            },
            409,
          );
        case "NO_CHANGES":
          return c.json({ ok: true, affectedFiles: [], noChanges: true });
        case "WORKTREE_NOT_FOUND":
          return c.json({ error: "Worktree not found" }, 404);
      }
    }

    return c.json({ ok: true, affectedFiles: result.affectedFiles });
  });

  routes.delete("/:taskId", async (c) => {
    const repoId = c.req.param("repoId") as string;
    const taskId = c.req.param("taskId");
    const force = c.req.query("force") === "true";

    const repo = await getRepoById(ctx, repoId);
    if (!repo) {
      return c.json({ error: "Repo not found" }, 404);
    }

    const task = await getTaskById(ctx, taskId);
    if (!task || task.repo_id !== repoId) {
      return c.json({ error: "Task not found" }, 404);
    }

    const result = await removeTask(ctx, taskId, { force });

    if (!result.success) {
      switch (result.error.code) {
        case "NOT_FOUND":
          return c.json({ error: "Task not found" }, 404);
        case "ALREADY_REMOVED":
          return c.json({
            ok: true,
            taskId: result.error.taskId,
            alreadyRemoved: true,
          });
        case "TASK_WORKING":
          return c.json({ error: "Task is currently working, use force=true to abort" }, 409);
        case "REMOVE_FAILED":
          return c.json({ error: "Failed to remove task" }, 500);
      }
    }

    return c.json({ ok: true, taskId: result.taskId, aborted: result.aborted });
  });

  return routes;
};
