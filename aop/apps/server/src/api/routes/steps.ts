import { StepCompleteRequestSchema } from "@aop/common/protocol";
import { Hono } from "hono";
import type { AuthenticatedContext } from "../middleware/auth.ts";
import { getAppContext } from "../server.ts";

const steps = new Hono<AuthenticatedContext>();

steps.post("/steps/:stepId/complete", async (c) => {
  const stepId = c.req.param("stepId");
  const client = c.get("client");

  const body = await c.req.json();
  const parseResult = StepCompleteRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json({ error: "Invalid request", details: parseResult.error.issues }, 400);
  }

  const { executionService } = getAppContext();
  const response = await executionService.processStepResult(client, {
    stepId,
    executionId: parseResult.data.executionId,
    attempt: parseResult.data.attempt,
    status: parseResult.data.status,
    signal: parseResult.data.signal,
    errorCode: parseResult.data.error?.code,
    durationMs: parseResult.data.durationMs,
  });

  return c.json(response);
});

export { steps };
