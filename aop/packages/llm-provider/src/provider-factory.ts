import { ClaudeCodeProvider } from "./providers/claude-code";
import { OpenCodeProvider } from "./providers/opencode";
import type { LLMProvider } from "./types";

export const createProvider = (key: string): LLMProvider => {
  if (key === "claude-code") return new ClaudeCodeProvider();

  if (key.startsWith("opencode:")) {
    const model = key.slice("opencode:".length);
    if (!model) throw new Error(`Unknown provider: ${key}`);
    return new OpenCodeProvider(model);
  }

  throw new Error(`Unknown provider: ${key}`);
};
