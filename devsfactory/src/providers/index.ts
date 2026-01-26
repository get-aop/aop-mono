import { ClaudeProvider } from "./claude";
import { GeminiProvider } from "./gemini";
import { OpenCodeProvider } from "./opencode";
import type { LLMProvider } from "./types";

export type ProviderName = "claude" | "opencode" | "gemini";

const providers: Record<ProviderName, () => LLMProvider> = {
  claude: () => new ClaudeProvider(),
  opencode: () => new OpenCodeProvider(),
  gemini: () => new GeminiProvider()
};

export function createProvider(name: ProviderName): LLMProvider {
  const factory = providers[name];
  if (!factory) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return factory();
}

export { ClaudeProvider } from "./claude";
export { GeminiProvider } from "./gemini";
export { OpenCodeProvider } from "./opencode";
export type { CommandOptions, LLMProvider } from "./types";
