import { AuthRequestSchema } from "@aop/common/protocol";
import { Hono } from "hono";
import { parseRequestBody } from "../route-helpers.ts";
import { getAppContext } from "../server.ts";

const auth = new Hono();

auth.post("/auth", async (c) => {
  const apiKey = c.req.header("Authorization")?.replace("Bearer ", "");

  const parsed = await parseRequestBody(c, AuthRequestSchema);
  if ("error" in parsed) return parsed.error;

  const { clientService } = getAppContext();
  const result = await clientService.authenticate(apiKey, parsed.data.requestedMaxConcurrentTasks);

  if (!result.success) {
    const message = result.error === "missing_api_key" ? "Missing API key" : "Invalid API key";
    return c.json({ error: message }, 401);
  }

  return c.json(result.response.authResponse);
});

export { auth };
