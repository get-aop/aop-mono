import { getLogger } from "@aop/infra";
import type { CommandContext } from "../context.ts";
import { type GetSettingError, getAllSettings, getSetting } from "../settings/handlers.ts";

const logger = getLogger("aop", "cli", "config:get");

export const configGetCommand = async (ctx: CommandContext, key?: string): Promise<void> => {
  if (key) {
    const result = await getSetting(ctx, key);
    if (!result.success) {
      handleError(result.error);
      return;
    }
    logger.info("{key}={value}", { key: result.key, value: result.value });
  } else {
    const result = await getAllSettings(ctx);
    for (const { key, value } of result.settings) {
      logger.info("{key}={value}", { key, value });
    }
  }
};

const handleError = (error: GetSettingError): void => {
  logger.error("Error: Unknown setting key: {key}", { key: error.key });
  logger.info("Valid keys: {keys}", { keys: error.validKeys.join(", ") });
  process.exit(1);
};
