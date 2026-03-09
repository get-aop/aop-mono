import { StepCompleteRequestSchema, StepResumeRequestSchema } from "@aop/common/protocol";
import { Hono } from "hono";
import type { AuthenticatedContext } from "../middleware/auth.ts";
import { parseRequestBody } from "../route-helpers.ts";
import { getAppContext } from "../server.ts";

const steps = new Hono<AuthenticatedContext>();

steps.post("/steps/:stepId/complete", async (c) => {
  const stepId = c.req.param("stepId");
  const client = c.get("client");

  const parsed = await parseRequestBody(c, StepCompleteRequestSchema);
  if ("error" in parsed) return parsed.error;

  const { executionService } = getAppContext();
  const response = await executionService.processStepResult(client, {
    stepId,
    executionId: parsed.data.executionId,
    attempt: parsed.data.attempt,
    status: parsed.data.status,
    signal: parsed.data.signal,
    errorCode: parsed.data.error?.code,
    durationMs: parsed.data.durationMs,
    pauseContext: parsed.data.pauseContext,
  });

  return c.json(response);
});

steps.post("/steps/:stepId/resume", async (c) => {
  const stepId = c.req.param("stepId");
  const client = c.get("client");

  const parsed = await parseRequestBody(c, StepResumeRequestSchema);
  if ("error" in parsed) return parsed.error;

  const { executionService } = getAppContext();
  const response = await executionService.resumeStep(client, {
    stepId,
    input: parsed.data.input,
  });

  return c.json(response);
});

export { steps };
