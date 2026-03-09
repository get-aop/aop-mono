import type { Setting } from "../db/schema.ts";

export type { Setting };

export const SettingKey = {
  MAX_CONCURRENT_TASKS: "max_concurrent_tasks",
  WATCHER_POLL_INTERVAL_SECS: "watcher_poll_interval_secs",
  QUEUE_POLL_INTERVAL_SECS: "queue_poll_interval_secs",
  AGENT_TIMEOUT_SECS: "agent_timeout_secs",
  AGENT_PROVIDER: "agent_provider",
  FAST_MODE: "fast_mode",
} as const;

export type SettingKey = (typeof SettingKey)[keyof typeof SettingKey];

export const DEFAULT_SETTINGS: Record<SettingKey, string> = {
  [SettingKey.MAX_CONCURRENT_TASKS]: "3",
  [SettingKey.WATCHER_POLL_INTERVAL_SECS]: "30",
  [SettingKey.QUEUE_POLL_INTERVAL_SECS]: "1",
  [SettingKey.AGENT_TIMEOUT_SECS]: "1800",
  [SettingKey.AGENT_PROVIDER]: "claude-code",
  [SettingKey.FAST_MODE]: "false",
};

export const VALID_KEYS: SettingKey[] = Object.values(SettingKey);

export const isValidSettingKey = (key: string): key is SettingKey => {
  return VALID_KEYS.includes(key as SettingKey);
};

export const VALID_PROVIDER_VALUES = [
  "claude-code",
  "opencode:opencode/kimi-k2.5",
  "opencode:opencode/kimi-k2.5-free",
  "opencode:openai/gpt-5.3-codex/medium",
  "opencode:openai/gpt-5.3-codex/high",
  "opencode:openai/gpt-5.3-codex/xhigh",
  "opencode:openai/gpt-5.3-codex/low",
  "cursor-cli:composer-1.5",
] as const;

export type ProviderValue = (typeof VALID_PROVIDER_VALUES)[number];

export const isValidProviderValue = (value: string): value is ProviderValue => {
  return (VALID_PROVIDER_VALUES as readonly string[]).includes(value);
};
