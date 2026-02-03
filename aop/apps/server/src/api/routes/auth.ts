import { AuthRequestSchema } from "@aop/common/protocol";
import { Hono } from "hono";
import { getAppContext } from "../server.ts";

const auth = new Hono();

auth.post("/auth", async (c) => {
  const apiKey = c.req.header("Authorization")?.replace("Bearer ", "");

  const body = await c.req.json();
  const parseResult = AuthRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json({ error: "Invalid request", details: parseResult.error.issues }, 400);
  }

  const { clientService } = getAppContext();
  const result = await clientService.authenticate(
    apiKey,
    parseResult.data.requestedMaxConcurrentTasks,
  );

  if (!result.success) {
    const message = result.error === "missing_api_key" ? "Missing API key" : "Invalid API key";
    return c.json({ error: message }, 401);
  }

  return c.json(result.response);
});

export { auth };
