import type { ZodIssue, ZodSchema } from "zod";

// --- Result discriminated union ---

export type Result<T, E = string> = { success: true; response: T } | { success: false; error: E };

export const ok = <T>(response: T): Result<T, never> => ({ success: true, response });

export const err = <E = string>(error: E): Result<never, E> => ({ success: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is { success: true; response: T } =>
  result.success;

export const isErr = <T, E>(result: Result<T, E>): result is { success: false; error: E } =>
  !result.success;

// --- Zod validation helper ---

export interface ValidationError {
  message: string;
  details: ZodIssue[];
}

export const parseBody = <T>(schema: ZodSchema<T>, body: unknown): Result<T, ValidationError> => {
  const result = schema.safeParse(body);
  if (!result.success) {
    return err({ message: "Invalid request", details: result.error.issues });
  }
  return ok(result.data);
};

/** Safely parse a JSON request body and validate against a Zod schema. Handles malformed JSON. */
export const safeParseJson = async <T>(
  schema: ZodSchema<T>,
  request: { json: () => Promise<unknown> },
): Promise<Result<T, ValidationError>> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err({ message: "Invalid JSON", details: [] });
  }
  return parseBody(schema, body);
};
