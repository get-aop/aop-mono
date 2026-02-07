import { getLogger } from "@aop/infra";
import { fetchServer } from "./client.ts";

const logger = getLogger("cli", "config-get");

interface Setting {
  key: string;
  value: string;
}

interface AllSettingsResponse {
  settings: Setting[];
}

interface SingleSettingResponse {
  key: string;
  value: string;
}

export const configGetCommand = async (key?: string): Promise<void> => {
  if (key) {
    await getSingleSetting(key);
  } else {
    await getAllSettings();
  }
};

const getSingleSetting = async (key: string): Promise<void> => {
  const result = await fetchServer<SingleSettingResponse>(`/api/settings/${key}`);
  if (!result.ok) {
    return handleSettingError(key, result.error);
  }
  logger.info("{key}={value}", { key: result.data.key, value: result.data.value });
};

const getAllSettings = async (): Promise<void> => {
  const result = await fetchServer<AllSettingsResponse>("/api/settings");
  if (!result.ok) {
    logger.error("Error: Failed to fetch settings from server");
    process.exit(1);
  }
  for (const { key, value } of result.data.settings) {
    logger.info("{key}={value}", { key, value });
  }
};

const handleSettingError = (key: string, error: { error: string; validKeys?: string[] }): never => {
  if (error.error === "Invalid key") {
    const validKeys = error.validKeys ?? [];
    logger.error("Error: Unknown setting key: {key}", { key });
    logger.info("Valid keys: {keys}", { keys: validKeys.join(", ") });
  } else {
    logger.error("Error: {error}", { error: error.error });
  }
  process.exit(1);
};
