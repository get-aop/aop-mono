import { describe, expect, test } from "bun:test";
import { createProvider } from "./provider-factory";
import { ClaudeCodeProvider } from "./providers/claude-code";
import { CursorCliProvider } from "./providers/cursor-cli";
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

  test("returns CursorCliProvider for 'cursor-cli:composer-1.5'", () => {
    const provider = createProvider("cursor-cli:composer-1.5");
    expect(provider).toBeInstanceOf(CursorCliProvider);
    expect(provider.name).toBe("cursor-cli");
    expect((provider as CursorCliProvider).model).toBe("Composer 1.5");
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

  test("throws for 'cursor-cli' without model", () => {
    expect(() => createProvider("cursor-cli")).toThrow("Unknown provider: cursor-cli");
  });

  test("throws for 'cursor-cli:' with empty model", () => {
    expect(() => createProvider("cursor-cli:")).toThrow("Unknown provider: cursor-cli:");
  });

  test("throws for unknown cursor model mapping", () => {
    expect(() => createProvider("cursor-cli:composer-1")).toThrow(
      "Unknown provider: cursor-cli:composer-1",
    );
  });
});
