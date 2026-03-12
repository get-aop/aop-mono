import { ClaudeCodeProvider } from "./providers/claude-code";
import { CodexProvider } from "./providers/codex";
import { CursorCliProvider } from "./providers/cursor-cli";
import { E2EFixtureProvider } from "./providers/e2e-fixture";
import { OpenCodeProvider } from "./providers/opencode";
import type { LLMProvider } from "./types";

const CURSOR_MODEL_MAP: Record<string, string> = {
  "composer-1.5": "Composer 1.5",
};

export const createProvider = (key: string): LLMProvider => {
  if (key === "claude-code") return new ClaudeCodeProvider();
  if (key === "codex") return new CodexProvider();
  if (key === "e2e-fixture") return new E2EFixtureProvider();

  if (key.startsWith("opencode:")) {
    const model = key.slice("opencode:".length);
    if (!model) throw new Error(`Unknown provider: ${key}`);
    return new OpenCodeProvider(model);
  }

  if (key.startsWith("cursor-cli:")) {
    const modelKey = key.slice("cursor-cli:".length);
    const mappedModel = CURSOR_MODEL_MAP[modelKey];
    if (!mappedModel) throw new Error(`Unknown provider: ${key}`);
    return new CursorCliProvider(mappedModel);
  }

  throw new Error(`Unknown provider: ${key}`);
};
