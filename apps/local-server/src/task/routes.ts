import type { Context } from "hono";
import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import { getRepoById } from "../repo/handlers.ts";
import { handleListFiles, handleReadFile } from "./change-files.ts";
import {
  blockTask,
  getTaskById,
  markTaskReady,
  type ResumeTaskError,
  removeTask,
  resumeTask,
} from "./handlers.ts";

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

    const transformedExecutions = await Promise.all(
      executions.map(async (e) => {
        const stepExecutions = await ctx.executionRepository.getStepExecutionsByExecutionId(e.id);
        return {
          id: e.id,
          taskId: e.task_id,
          status: e.status === "aborted" || e.status === "cancelled" ? "failed" : e.status,
          startedAt: e.started_at,
          finishedAt: e.completed_at ?? undefined,
          steps: stepExecutions.map((s) => ({
            id: s.id,
            stepId: s.step_id ?? undefined,
            stepType: s.step_type,
            status: s.status,
            startedAt: s.started_at,
            endedAt: s.ended_at ?? undefined,
            error: s.error ?? undefined,
          })),
        };
      }),
    );

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

    const body = await c.req.json<{ retryFromStep?: string }>().catch(() => ({
      retryFromStep: undefined,
    }));
    const result = await markTaskReady(ctx, taskId, {
      retryFromStep: body.retryFromStep,
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
        case "MISSING_PROMPT_FILE":
          return c.json(
            {
              error: "Change has no .md files — add at least one to serve as the prompt",
              changePath: result.error.changePath,
            },
            422,
          );
        case "UPDATE_FAILED":
          return c.json({ error: "Failed to update task" }, 500);
      }
    }

    return c.json({ ok: true, taskId: result.task.id });
  });

  routes.post("/:taskId/block", async (c) => {
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

    const result = await blockTask(ctx, taskId);

    if (!result.success) {
      switch (result.error.code) {
        case "NOT_FOUND":
          return c.json({ error: "Task not found" }, 404);
        case "INVALID_STATUS":
          return c.json(
            { error: "Task is not currently working", status: result.error.status },
            409,
          );
      }
    }

    return c.json({ ok: true, taskId: result.taskId, agentKilled: result.agentKilled });
  });

  routes.get("/:taskId/pause-context", async (c) => {
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

    if (task.status !== "PAUSED") {
      return c.json({ error: "Task is not paused" }, 409);
    }

    const latestStep = await ctx.executionRepository.getLatestStepExecution(taskId);
    return c.json({
      pauseContext: latestStep?.pause_context ?? null,
      signal: latestStep?.signal ?? null,
    });
  });

  routes.post("/:taskId/resume", async (c) => {
    const repoId = c.req.param("repoId") as string;
    const taskId = c.req.param("taskId");

    const repo = await getRepoById(ctx, repoId);
    if (!repo) return c.json({ error: "Repo not found" }, 404);

    const task = await getTaskById(ctx, taskId);
    if (!task || task.repo_id !== repoId) return c.json({ error: "Task not found" }, 404);

    const body = await c.req.json<{ input?: string }>().catch(() => ({}) as { input?: string });
    if (!body.input) return c.json({ error: "Missing required field: input" }, 400);

    const result = await resumeTask(ctx, taskId, body.input);
    if (result.success)
      return c.json({ ok: true, taskId: result.taskId, message: "Resume initiated" });

    return mapResumeError(c, result.error);
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

  routes.get("/:taskId/files", (c) => handleListFiles(ctx, c));
  routes.get("/:taskId/files/*", (c) => handleReadFile(ctx, c));

  return routes;
};

const RESUME_ERROR_MAP: Record<ResumeTaskError["code"], { status: number; message?: string }> = {
  NOT_FOUND: { status: 404, message: "Task not found" },
  NOT_PAUSED: { status: 409, message: "Task is not paused" },
  NO_STEP_EXECUTION: { status: 404, message: "No step execution found" },
  RESUME_FAILED: { status: 500 },
};

const mapResumeError = (c: Context, error: ResumeTaskError) => {
  const mapping = RESUME_ERROR_MAP[error.code];
  const message = error.code === "RESUME_FAILED" ? error.message : mapping.message;
  const extra = error.code === "NOT_PAUSED" ? { status: error.status } : {};
  return c.json({ error: message, ...extra }, mapping.status as 400);
};
