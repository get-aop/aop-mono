import type { SettingsRepository } from "../settings/repository.ts";
import { SettingKey } from "../settings/types.ts";

export interface WorkflowListResult {
  workflows: string[];
}

export const listWorkflows = async (
  settingsRepository: SettingsRepository,
): Promise<WorkflowListResult> => {
  const serverUrl = await settingsRepository.get(SettingKey.SERVER_URL);
  const apiKey = await settingsRepository.get(SettingKey.API_KEY);

  if (!serverUrl || !apiKey) {
    return { workflows: [] };
  }

  try {
    const response = await fetch(`${serverUrl}/workflows`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      return { workflows: [] };
    }

    const data = (await response.json()) as WorkflowListResult;
    return data;
  } catch {
    return { workflows: [] };
  }
};
