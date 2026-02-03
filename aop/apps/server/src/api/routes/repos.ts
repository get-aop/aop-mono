import { SyncRepoRequestSchema } from "@aop/common/protocol";
import { Hono } from "hono";
import type { AuthenticatedContext } from "../middleware/auth.ts";
import { getAppContext } from "../server.ts";

const repos = new Hono<AuthenticatedContext>();

repos.post("/repos/:repoId/sync", async (c) => {
  const repoId = c.req.param("repoId");
  const client = c.get("client");

  const body = await c.req.json();
  const parseResult = SyncRepoRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json({ error: "Invalid request", details: parseResult.error.issues }, 400);
  }

  const { repoService } = getAppContext();
  await repoService.syncRepo(client.id, repoId, new Date(parseResult.data.syncedAt));

  return c.json({ ok: true });
});

export { repos };
