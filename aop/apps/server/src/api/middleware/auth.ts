import { getLogger } from "@aop/infra";
import type { MiddlewareHandler } from "hono";
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

  const { clientService } = getAppContext();
  const result = await clientService.authenticate(apiKey);

  if (!result.success) {
    const path = new URL(c.req.url).pathname;
    if (result.error === "missing_api_key") {
      logger.warn("Auth rejected: missing API key for {path}", { path });
      return c.json({ error: "Missing API key" }, 401);
    }
    logger.warn("Auth rejected: invalid API key for {path}", { path });
    return c.json({ error: "Invalid API key" }, 401);
  }

  c.set("client", result.response.client);
  await next();
};
