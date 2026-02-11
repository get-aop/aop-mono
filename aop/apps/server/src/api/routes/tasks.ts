import { SyncTaskRequestSchema, TaskReadyRequestSchema } from "@aop/common/protocol";
import { Hono } from "hono";
import type { AuthenticatedContext } from "../middleware/auth.ts";
import { parseRequestBody } from "../route-helpers.ts";
import { getAppContext } from "../server.ts";

const tasks = new Hono<AuthenticatedContext>();

tasks.post("/tasks/:taskId/sync", async (c) => {
  const taskId = c.req.param("taskId");
  const client = c.get("client");

  const parsed = await parseRequestBody(c, SyncTaskRequestSchema);
  if ("error" in parsed) return parsed.error;

  const { taskService } = getAppContext();
  await taskService.syncTask(
    client.id,
    taskId,
    parsed.data.repoId,
    parsed.data.status,
    new Date(parsed.data.syncedAt),
  );

  return c.json({ ok: true });
});

tasks.post("/tasks/:taskId/ready", async (c) => {
  const taskId = c.req.param("taskId");
  const client = c.get("client");

  const parsed = await parseRequestBody(c, TaskReadyRequestSchema);
  if ("error" in parsed) return parsed.error;

  const { executionService } = getAppContext();
  const response = await executionService.startWorkflow(
    client,
    taskId,
    parsed.data.repoId,
    parsed.data.workflowName,
    parsed.data.retryFromStep,
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
