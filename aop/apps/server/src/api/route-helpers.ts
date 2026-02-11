import { safeParseJson, type ValidationError } from "@aop/common";
import type { Context } from "hono";
import type { ZodSchema } from "zod";

/** Parse and validate JSON request body. Returns parsed data or sends a 400 response. */
export const parseRequestBody = async <T>(
  c: Context,
  schema: ZodSchema<T>,
): Promise<{ data: T } | { error: Response }> => {
  const result = await safeParseJson(schema, c.req);
  if (!result.success) {
    return { error: validationResponse(c, result.error) };
  }
  return { data: result.response };
};

const validationResponse = (c: Context, error: ValidationError): Response =>
  c.json({ error: error.message, details: error.details }, 400);
