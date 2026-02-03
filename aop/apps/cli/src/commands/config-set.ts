import { getLogger } from "@aop/infra";
import type { CommandContext } from "../context.ts";
import { type SetSettingError, setSetting } from "../settings/handlers.ts";

const logger = getLogger("aop", "cli", "config:set");

export const configSetCommand = async (
  ctx: CommandContext,
  key: string,
  value: string,
): Promise<void> => {
  const result = await setSetting(ctx, key, value);
  if (!result.success) {
    handleError(result.error);
    return;
  }
  logger.info("Setting updated: {key}={value}", { key: result.key, value: result.value });
};

const handleError = (error: SetSettingError): void => {
  logger.error("Error: Unknown setting key: {key}", { key: error.key });
  logger.info("Valid keys: {keys}", { keys: error.validKeys.join(", ") });
  process.exit(1);
};
