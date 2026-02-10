import { SyncTaskRequestSchema, TaskReadyRequestSchema } from "@aop/common/protocol";
import { Hono } from "hono";
import type { AuthenticatedContext } from "../middleware/auth.ts";
import { getAppContext } from "../server.ts";

const tasks = new Hono<AuthenticatedContext>();

tasks.post("/tasks/:taskId/sync", async (c) => {
  const taskId = c.req.param("taskId");
  const client = c.get("client");

  const body = await c.req.json();
  const parseResult = SyncTaskRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json({ error: "Invalid request", details: parseResult.error.issues }, 400);
  }

  const { taskService } = getAppContext();
  await taskService.syncTask(
    client.id,
    taskId,
    parseResult.data.repoId,
    parseResult.data.status,
    new Date(parseResult.data.syncedAt),
  );

  return c.json({ ok: true });
});

tasks.post("/tasks/:taskId/ready", async (c) => {
  const taskId = c.req.param("taskId");
  const client = c.get("client");

  const body = await c.req.json();
  const parseResult = TaskReadyRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json({ error: "Invalid request", details: parseResult.error.issues }, 400);
  }

  const { executionService } = getAppContext();
  const response = await executionService.startWorkflow(
    client,
    taskId,
    parseResult.data.repoId,
    parseResult.data.workflowName,
    parseResult.data.retryFromStep,
  );

  return c.json(response);
});

tasks.get("/tasks/:taskId/status", async (c) => {
  const taskId = c.req.param("taskId");
  const client = c.get("client");

  const { taskService } = getAppContext();
  const result = await taskService.getTaskStatus(client.id, taskId);

  if (!result.success) {
    return c.json({ error: "Task not found" }, 404);
  }

  return c.json(result.response);
});

export { tasks };
