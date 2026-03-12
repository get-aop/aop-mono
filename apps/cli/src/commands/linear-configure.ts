import { getLogger } from "@aop/infra";
import { fetchServer, requireServer } from "./client.ts";

const logger = getLogger("cli", "linear-configure");

interface LinearConfigureOptions {
  clientId?: string;
  callbackUrl?: string;
}

interface SettingEntry {
  key: string;
  value: string;
}

interface SetSettingsResponse {
  ok: boolean;
  settings: SettingEntry[];
}

export const linearConfigureCommand = async (options: LinearConfigureOptions): Promise<void> => {
  await requireServer();

  const settings: SettingEntry[] = [];
  if (options.clientId !== undefined) {
    settings.push({ key: "linear_client_id", value: options.clientId });
  }
  if (options.callbackUrl !== undefined) {
    settings.push({ key: "linear_callback_url", value: options.callbackUrl });
  }

  if (settings.length === 0) {
    logger.error("Provide --client-id, --callback-url, or both.");
    process.exit(1);
  }

  const result = await fetchServer<SetSettingsResponse>("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  });

  if (!result.ok) {
    logger.error("Failed to update Linear OAuth settings: {error}", {
      error: result.error.error,
    });
    process.exit(1);
  }

  logger.info("Linear OAuth settings updated");
};
