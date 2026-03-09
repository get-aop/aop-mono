import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import { listWorkflows } from "./handlers.ts";

export const createWorkflowRoutes = (ctx: LocalServerContext) => {
  const routes = new Hono();

  routes.get("/", async (c) => {
    const result = await listWorkflows(ctx.workflowService);
    return c.json(result);
  });

  return routes;
};
