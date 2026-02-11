import { SyncRepoRequestSchema } from "@aop/common/protocol";
import { Hono } from "hono";
import type { AuthenticatedContext } from "../middleware/auth.ts";
import { parseRequestBody } from "../route-helpers.ts";
import { getAppContext } from "../server.ts";

const repos = new Hono<AuthenticatedContext>();

repos.post("/repos/:repoId/sync", async (c) => {
  const repoId = c.req.param("repoId");
  const client = c.get("client");

  const parsed = await parseRequestBody(c, SyncRepoRequestSchema);
  if ("error" in parsed) return parsed.error;

  const { repoService } = getAppContext();
  await repoService.syncRepo(client.id, repoId, new Date(parsed.data.syncedAt));

  return c.json({ ok: true });
});

export { repos };
