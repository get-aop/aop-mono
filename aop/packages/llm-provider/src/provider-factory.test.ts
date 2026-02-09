import { describe, expect, test } from "bun:test";
import { createProvider } from "./provider-factory";
import { ClaudeCodeProvider } from "./providers/claude-code";
import { OpenCodeProvider } from "./providers/opencode";

describe("createProvider", () => {
  test("returns ClaudeCodeProvider for 'claude-code'", () => {
    const provider = createProvider("claude-code");
    expect(provider).toBeInstanceOf(ClaudeCodeProvider);
    expect(provider.name).toBe("claude-code");
  });

  test("returns OpenCodeProvider for 'opencode:opencode/kimi-k2.5-free'", () => {
    const provider = createProvider("opencode:opencode/kimi-k2.5-free");
    expect(provider).toBeInstanceOf(OpenCodeProvider);
    expect(provider.name).toBe("opencode");
    expect((provider as OpenCodeProvider).model).toBe("opencode/kimi-k2.5-free");
  });

  test("returns OpenCodeProvider for 'opencode:openai/gpt-5.3-codex'", () => {
    const provider = createProvider("opencode:openai/gpt-5.3-codex");
    expect(provider).toBeInstanceOf(OpenCodeProvider);
    expect(provider.name).toBe("opencode");
    expect((provider as OpenCodeProvider).model).toBe("openai/gpt-5.3-codex");
  });

  test("throws for unknown provider key", () => {
    expect(() => createProvider("unknown-provider")).toThrow("Unknown provider: unknown-provider");
  });

  test("throws for empty string", () => {
    expect(() => createProvider("")).toThrow("Unknown provider: ");
  });

  test("throws for 'opencode' without model", () => {
    expect(() => createProvider("opencode")).toThrow("Unknown provider: opencode");
  });

  test("throws for 'opencode:' with empty model", () => {
    expect(() => createProvider("opencode:")).toThrow("Unknown provider: opencode:");
  });
});
