import type { MiddlewareHandler } from "hono";
import { createClientRepository } from "../../clients/client-repository.ts";
import type { Client } from "../../db/schema.ts";
import { getAppContext } from "../server.ts";

export interface AuthenticatedContext {
  Variables: {
    client: Client;
  };
}

export const authMiddleware: MiddlewareHandler<AuthenticatedContext> = async (c, next) => {
  const apiKey = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!apiKey) {
    return c.json({ error: "Missing API key" }, 401);
  }

  const { db } = getAppContext();
  const clientRepo = createClientRepository(db);

  const client = await clientRepo.findByApiKey(apiKey);
  if (!client) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  await clientRepo.updateLastSeen(client.id, new Date());

  c.set("client", client);
  await next();
};
