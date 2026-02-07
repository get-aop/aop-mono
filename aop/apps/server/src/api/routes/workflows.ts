import { Hono } from "hono";
import type { AuthenticatedContext } from "../middleware/auth.ts";
import { getAppContext } from "../server.ts";

const workflows = new Hono<AuthenticatedContext>();

workflows.get("/workflows", async (c) => {
  const { workflowRepository } = getAppContext();
  const names = await workflowRepository.listNames();
  return c.json({ workflows: names });
});

export { workflows };
