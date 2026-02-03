export type { Setting } from "../db/schema.ts";

export const SettingKey = {
  MAX_CONCURRENT_TASKS: "max_concurrent_tasks",
  WATCHER_POLL_INTERVAL_SECS: "watcher_poll_interval_secs",
  QUEUE_POLL_INTERVAL_SECS: "queue_poll_interval_secs",
  AGENT_TIMEOUT_SECS: "agent_timeout_secs",
  SERVER_URL: "server_url",
  API_KEY: "api_key",
} as const;

export type SettingKey = (typeof SettingKey)[keyof typeof SettingKey];

export const DEFAULT_SETTINGS: Record<SettingKey, string> = {
  [SettingKey.MAX_CONCURRENT_TASKS]: "1",
  [SettingKey.WATCHER_POLL_INTERVAL_SECS]: "30",
  [SettingKey.QUEUE_POLL_INTERVAL_SECS]: "1",
  [SettingKey.AGENT_TIMEOUT_SECS]: "1800",
  [SettingKey.SERVER_URL]: "",
  [SettingKey.API_KEY]: "",
};

export const VALID_KEYS: SettingKey[] = Object.values(SettingKey);

export const isValidSettingKey = (key: string): key is SettingKey => {
  return VALID_KEYS.includes(key as SettingKey);
};
