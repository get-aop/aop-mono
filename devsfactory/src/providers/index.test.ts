import { describe, expect, test } from "bun:test";
import {
  ClaudeProvider,
  createProvider,
  GeminiProvider,
  OpenCodeProvider
} from "./index";
import type { CommandOptions } from "./types";

const testOptions: CommandOptions = {
  prompt: "test prompt",
  cwd: "/test/dir"
};

describe("ClaudeProvider", () => {
  test("has correct name", () => {
    const provider = new ClaudeProvider();
    expect(provider.name).toBe("claude");
  });

  test("builds command with --output-format stream-json and --verbose flags", () => {
    const provider = new ClaudeProvider();
    const command = provider.buildCommand(testOptions);
    expect(command).toEqual([
      "claude",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "test prompt"
    ]);
  });

  test("includes extraArgs before prompt", () => {
    const provider = new ClaudeProvider();
    const command = provider.buildCommand({
      ...testOptions,
      extraArgs: ["--model", "opus"]
    });
    expect(command).toEqual([
      "claude",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--model",
      "opus",
      "test prompt"
    ]);
  });
});

describe("OpenCodeProvider", () => {
  test("has correct name", () => {
    const provider = new OpenCodeProvider();
    expect(provider.name).toBe("opencode");
  });

  test("builds command with run subcommand", () => {
    const provider = new OpenCodeProvider();
    const command = provider.buildCommand(testOptions);
    expect(command).toEqual(["opencode", "run", "test prompt"]);
  });

  test("includes extraArgs before run subcommand", () => {
    const provider = new OpenCodeProvider();
    const command = provider.buildCommand({
      ...testOptions,
      extraArgs: ["--verbose"]
    });
    expect(command).toEqual(["opencode", "--verbose", "run", "test prompt"]);
  });
});

describe("GeminiProvider", () => {
  test("has correct name", () => {
    const provider = new GeminiProvider();
    expect(provider.name).toBe("gemini");
  });

  test("builds command with -p flag", () => {
    const provider = new GeminiProvider();
    const command = provider.buildCommand(testOptions);
    expect(command).toEqual(["gemini", "-p", "test prompt"]);
  });

  test("includes extraArgs before -p flag", () => {
    const provider = new GeminiProvider();
    const command = provider.buildCommand({
      ...testOptions,
      extraArgs: ["--verbose"]
    });
    expect(command).toEqual(["gemini", "--verbose", "-p", "test prompt"]);
  });
});

describe("createProvider", () => {
  test("creates ClaudeProvider for 'claude'", () => {
    const provider = createProvider("claude");
    expect(provider.name).toBe("claude");
    expect(provider).toBeInstanceOf(ClaudeProvider);
  });

  test("creates OpenCodeProvider for 'opencode'", () => {
    const provider = createProvider("opencode");
    expect(provider.name).toBe("opencode");
    expect(provider).toBeInstanceOf(OpenCodeProvider);
  });

  test("creates GeminiProvider for 'gemini'", () => {
    const provider = createProvider("gemini");
    expect(provider.name).toBe("gemini");
    expect(provider).toBeInstanceOf(GeminiProvider);
  });
});
