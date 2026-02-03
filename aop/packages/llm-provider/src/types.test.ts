import { describe, expect, test } from "bun:test";
import type { LLMProvider, RunOptions, RunResult } from "./types";

describe("types", () => {
  describe("RunOptions", () => {
    test("requires prompt", () => {
      const options: RunOptions = { prompt: "test prompt" };
      expect(options.prompt).toBe("test prompt");
    });

    test("allows optional cwd", () => {
      const options: RunOptions = { prompt: "test", cwd: "/some/path" };
      expect(options.cwd).toBe("/some/path");
    });

    test("allows optional resumeSessionId", () => {
      const options: RunOptions = { prompt: "test", resumeSessionId: "session-123" };
      expect(options.resumeSessionId).toBe("session-123");
    });

    test("allows optional onOutput callback", () => {
      const output: Record<string, unknown>[] = [];
      const options: RunOptions = {
        prompt: "test",
        onOutput: (data) => output.push(data),
      };
      options.onOutput?.({ type: "text", content: "hello" });
      expect(output).toEqual([{ type: "text", content: "hello" }]);
    });
  });

  describe("RunResult", () => {
    test("has required exitCode", () => {
      const result: RunResult = { exitCode: 0 };
      expect(result.exitCode).toBe(0);
    });

    test("allows optional sessionId", () => {
      const result: RunResult = { exitCode: 0, sessionId: "session-456" };
      expect(result.sessionId).toBe("session-456");
    });
  });

  describe("LLMProvider", () => {
    test("has name property and run method", () => {
      const mockProvider: LLMProvider = {
        name: "test-provider",
        run: async () => ({ exitCode: 0 }),
      };
      expect(mockProvider.name).toBe("test-provider");
      expect(typeof mockProvider.run).toBe("function");
    });
  });
});
