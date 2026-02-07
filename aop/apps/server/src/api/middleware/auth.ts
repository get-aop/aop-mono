import { getLogger } from "@aop/infra";
import type { MiddlewareHandler } from "hono";
import { createClientRepository } from "../../clients/client-repository.ts";
import type { Client } from "../../db/schema.ts";
import { getAppContext } from "../server.ts";

const logger = getLogger("auth");

export interface AuthenticatedContext {
  Variables: {
    client: Client;
  };
}

export const authMiddleware: MiddlewareHandler<AuthenticatedContext> = async (c, next) => {
  const apiKey = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!apiKey) {
    logger.warn("Auth rejected: missing API key for {path}", {
      path: new URL(c.req.url).pathname,
    });
    return c.json({ error: "Missing API key" }, 401);
  }

  const { db } = getAppContext();
  const clientRepo = createClientRepository(db);

  const client = await clientRepo.findByApiKey(apiKey);
  if (!client) {
    logger.warn("Auth rejected: invalid API key for {path}", {
      path: new URL(c.req.url).pathname,
    });
    return c.json({ error: "Invalid API key" }, 401);
  }

  await clientRepo.updateLastSeen(client.id, new Date());

  c.set("client", client);
  await next();
};
