import { getLogger } from "@aop/infra";
import { fetchServer } from "./client.ts";

const logger = getLogger("aop", "cli", "config:set");

interface SetSettingResponse {
  ok: boolean;
  key: string;
  value: string;
}

export const configSetCommand = async (key: string, value: string): Promise<void> => {
  const result = await fetchServer<SetSettingResponse>(`/api/settings/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });

  if (!result.ok) {
    if (result.error.error === "Invalid key") {
      const validKeys = (result.error as { validKeys?: string[] }).validKeys ?? [];
      logger.error("Error: Unknown setting key: {key}", { key });
      logger.info("Valid keys: {keys}", { keys: validKeys.join(", ") });
    } else {
      logger.error("Error: {error}", { error: result.error.error });
    }
    process.exit(1);
  }

  logger.info("Setting updated: {key}={value}", { key: result.data.key, value: result.data.value });
};
