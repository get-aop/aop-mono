import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import type { LLMProvider } from "../types";
import { ClaudeCodeProvider, createWatchdog } from "./claude-code";

describe("ClaudeCodeProvider", () => {
  test("implements LLMProvider interface", () => {
    const provider: LLMProvider = new ClaudeCodeProvider();
    expect(provider.name).toBe("claude-code");
    expect(typeof provider.run).toBe("function");
  });

  test("has readonly name property", () => {
    const provider = new ClaudeCodeProvider();
    expect(provider.name).toBe("claude-code");
  });
});

describe("buildCommand", () => {
  test("builds base command with required flags", () => {
    const provider = new ClaudeCodeProvider();
    const cmd = provider.buildCommand({ prompt: "test prompt" });
    expect(cmd).toEqual([
      "claude",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "test prompt",
    ]);
  });

  test("adds --resume flag when resumeSessionId provided", () => {
    const provider = new ClaudeCodeProvider();
    const cmd = provider.buildCommand({
      prompt: "test prompt",
      resumeSessionId: "session-123",
    });
    expect(cmd).toEqual([
      "claude",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--resume",
      "session-123",
      "test prompt",
    ]);
  });
});

describe("parseStreamLine", () => {
  test("parses valid JSON line and returns parsed object", () => {
    const provider = new ClaudeCodeProvider();
    const result = provider.parseStreamLine('{"type":"text","content":"hello"}');
    expect(result).toEqual({ type: "text", content: "hello" });
  });

  test("returns null for invalid JSON", () => {
    const provider = new ClaudeCodeProvider();
    const result = provider.parseStreamLine("not json");
    expect(result).toBeNull();
  });

  test("returns null for empty line", () => {
    const provider = new ClaudeCodeProvider();
    const result = provider.parseStreamLine("");
    expect(result).toBeNull();
  });

  test("returns null for whitespace-only line", () => {
    const provider = new ClaudeCodeProvider();
    const result = provider.parseStreamLine("   ");
    expect(result).toBeNull();
  });
});

describe("extractSessionId", () => {
  test("extracts session_id from message", () => {
    const provider = new ClaudeCodeProvider();
    const sessionId = provider.extractSessionId({ session_id: "abc-123", type: "system" });
    expect(sessionId).toBe("abc-123");
  });

  test("returns undefined when no session_id", () => {
    const provider = new ClaudeCodeProvider();
    const sessionId = provider.extractSessionId({ type: "text" });
    expect(sessionId).toBeUndefined();
  });
});

describe("createWatchdog", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("does not trigger callback when activity is within timeout", () => {
    let onTimeoutCalled = false;
    const lastActivity = Date.now();

    createWatchdog(
      1000,
      () => lastActivity,
      () => {
        onTimeoutCalled = true;
      },
      100,
    );

    jest.advanceTimersByTime(500);
    expect(onTimeoutCalled).toBe(false);
  });

  test("triggers callback when inactivity exceeds timeout", () => {
    let onTimeoutCalled = false;
    const startTime = Date.now();

    createWatchdog(
      1000,
      () => startTime - 2000, // simulate 2 seconds of inactivity
      () => {
        onTimeoutCalled = true;
      },
      100,
    );

    jest.advanceTimersByTime(100);
    expect(onTimeoutCalled).toBe(true);
  });

  test("stop() clears the interval and prevents callback", () => {
    let onTimeoutCalled = false;
    const startTime = Date.now();

    const watchdog = createWatchdog(
      1000,
      () => startTime - 2000,
      () => {
        onTimeoutCalled = true;
      },
      100,
    );

    watchdog.stop();
    jest.advanceTimersByTime(200);
    expect(onTimeoutCalled).toBe(false);
  });
});
