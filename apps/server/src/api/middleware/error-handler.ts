import { getLogger } from "@aop/infra";
import type { ErrorHandler } from "hono";

const logger = getLogger("error-handler");

export const errorHandler: ErrorHandler = (err, c) => {
  logger.error("Unhandled error: {error}", { error: err.message, stack: err.stack });

  if (err.message === "Unexpected end of JSON input" || err.message.includes("JSON")) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  return c.json({ error: "Internal server error" }, 500);
};
