import { getLogger, injectTraceHeaders } from "@aop/infra";
import type { SettingsRepository } from "../settings/repository.ts";
import { SettingKey } from "../settings/types.ts";

const logger = getLogger("workflow");

export interface WorkflowListResult {
  workflows: string[];
}

export const listWorkflows = async (
  settingsRepository: SettingsRepository,
): Promise<WorkflowListResult> => {
  const serverUrl = await settingsRepository.get(SettingKey.SERVER_URL);
  const apiKey = await settingsRepository.get(SettingKey.API_KEY);

  if (!serverUrl || !apiKey) {
    logger.debug("Skipping workflow fetch: server not configured");
    return { workflows: [] };
  }

  try {
    const headers = injectTraceHeaders({
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    });

    const response = await fetch(`${serverUrl}/workflows`, { headers });

    if (!response.ok) {
      logger.warn("Failed to fetch workflows: {status} from {url}", {
        status: response.status,
        url: serverUrl,
      });
      return { workflows: [] };
    }

    const data = (await response.json()) as WorkflowListResult;
    return data;
  } catch (err) {
    logger.warn("Failed to fetch workflows from {url}: {error}", {
      url: serverUrl,
      error: String(err),
    });
    return { workflows: [] };
  }
};
