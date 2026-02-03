import { describe, expect, it } from "bun:test";
import { ClaudeCodeRunner } from "./claude-code-runner";

describe("ClaudeCodeRunner", () => {
  describe("constructor", () => {
    it("should create a runner instance", () => {
      const runner = new ClaudeCodeRunner();
      expect(runner).toBeDefined();
      expect(runner.getActive()).toEqual([]);
    });
  });

  describe("getActive", () => {
    it("should return empty array when no agents running", () => {
      const runner = new ClaudeCodeRunner();
      expect(runner.getActive()).toEqual([]);
    });
  });

  describe("getCountByType", () => {
    it("should return 0 when no agents running", () => {
      const runner = new ClaudeCodeRunner();
      expect(runner.getCountByType("implementation")).toBe(0);
      expect(runner.getCountByType("review")).toBe(0);
      expect(runner.getCountByType("planning")).toBe(0);
    });
  });

  describe("formatOutputLine", () => {
    it("should format Read tool use", () => {
      const runner = new ClaudeCodeRunner();
      const formatOutputLine = (
        runner as unknown as {
          formatOutputLine: (parsed: unknown, raw: string) => string | null;
        }
      ).formatOutputLine.bind(runner);

      const parsed = {
        type: "assistant" as const,
        content: [
          {
            type: "tool_use" as const,
            name: "Read",
            input: { file_path: "/home/user/project/src/file.ts" }
          }
        ]
      };

      const result = formatOutputLine(parsed, "");
      expect(result).toBe("[Read: src/file.ts]");
    });

    it("should format Write tool use", () => {
      const runner = new ClaudeCodeRunner();
      const formatOutputLine = (
        runner as unknown as {
          formatOutputLine: (parsed: unknown, raw: string) => string | null;
        }
      ).formatOutputLine.bind(runner);

      const parsed = {
        type: "assistant" as const,
        content: [
          {
            type: "tool_use" as const,
            name: "Write",
            input: { file_path: "/project/src/new-file.ts" }
          }
        ]
      };

      const result = formatOutputLine(parsed, "");
      expect(result).toBe("[Write: src/new-file.ts]");
    });

    it("should format Bash tool use with truncation", () => {
      const runner = new ClaudeCodeRunner();
      const formatOutputLine = (
        runner as unknown as {
          formatOutputLine: (parsed: unknown, raw: string) => string | null;
        }
      ).formatOutputLine.bind(runner);

      const longCommand =
        "npm run build:production:minified:optimized:with-sourcemaps:and-more";
      const parsed = {
        type: "assistant" as const,
        content: [
          {
            type: "tool_use" as const,
            name: "Bash",
            input: { command: longCommand }
          }
        ]
      };

      const result = formatOutputLine(parsed, "");
      expect(result).toContain("[Bash:");
      expect(result).toContain("...");
      expect(result!.length).toBeLessThan(longCommand.length + 20);
    });

    it("should format Glob tool use", () => {
      const runner = new ClaudeCodeRunner();
      const formatOutputLine = (
        runner as unknown as {
          formatOutputLine: (parsed: unknown, raw: string) => string | null;
        }
      ).formatOutputLine.bind(runner);

      const parsed = {
        type: "assistant" as const,
        content: [
          {
            type: "tool_use" as const,
            name: "Glob",
            input: { pattern: "**/*.ts" }
          }
        ]
      };

      const result = formatOutputLine(parsed, "");
      expect(result).toBe("[Glob: **/*.ts]");
    });

    it("should format text content", () => {
      const runner = new ClaudeCodeRunner();
      const formatOutputLine = (
        runner as unknown as {
          formatOutputLine: (parsed: unknown, raw: string) => string | null;
        }
      ).formatOutputLine.bind(runner);

      const parsed = {
        type: "assistant" as const,
        content: [{ type: "text" as const, text: "I'm analyzing the code..." }]
      };

      const result = formatOutputLine(parsed, "");
      expect(result).toBe("I'm analyzing the code...");
    });

    it("should format result message", () => {
      const runner = new ClaudeCodeRunner();
      const formatOutputLine = (
        runner as unknown as {
          formatOutputLine: (parsed: unknown, raw: string) => string | null;
        }
      ).formatOutputLine.bind(runner);

      const parsed = {
        type: "result" as const,
        subtype: "success",
        sessionId: "abc",
        isError: false,
        result: "done",
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalCostUsd: 0.0234
        }
      };

      const result = formatOutputLine(parsed, "");
      expect(result).toBe("── Result: success ($0.0234)");
    });

    it("should skip system messages", () => {
      const runner = new ClaudeCodeRunner();
      const formatOutputLine = (
        runner as unknown as {
          formatOutputLine: (parsed: unknown, raw: string) => string | null;
        }
      ).formatOutputLine.bind(runner);

      const parsed = {
        type: "system" as const,
        subtype: "init",
        sessionId: "abc",
        tools: ["Read"]
      };

      const result = formatOutputLine(parsed, "");
      expect(result).toBeNull();
    });

    it("should skip user messages", () => {
      const runner = new ClaudeCodeRunner();
      const formatOutputLine = (
        runner as unknown as {
          formatOutputLine: (parsed: unknown, raw: string) => string | null;
        }
      ).formatOutputLine.bind(runner);

      const parsed = {
        type: "user" as const,
        content: [{ type: "tool_result", content: "file contents" }]
      };

      const result = formatOutputLine(parsed, "");
      expect(result).toBeNull();
    });

    it("should return raw line when not parsed", () => {
      const runner = new ClaudeCodeRunner();
      const formatOutputLine = (
        runner as unknown as {
          formatOutputLine: (parsed: unknown, raw: string) => string | null;
        }
      ).formatOutputLine.bind(runner);

      const result = formatOutputLine(null, "plain text output");
      expect(result).toBe("plain text output");
    });

    it("should return null for empty raw line when not parsed", () => {
      const runner = new ClaudeCodeRunner();
      const formatOutputLine = (
        runner as unknown as {
          formatOutputLine: (parsed: unknown, raw: string) => string | null;
        }
      ).formatOutputLine.bind(runner);

      const result = formatOutputLine(null, "   ");
      expect(result).toBeNull();
    });

    it("should combine multiple content items", () => {
      const runner = new ClaudeCodeRunner();
      const formatOutputLine = (
        runner as unknown as {
          formatOutputLine: (parsed: unknown, raw: string) => string | null;
        }
      ).formatOutputLine.bind(runner);

      const parsed = {
        type: "assistant" as const,
        content: [
          { type: "text" as const, text: "Let me read the file" },
          {
            type: "tool_use" as const,
            name: "Read",
            input: { file_path: "/project/src/main.ts" }
          }
        ]
      };

      const result = formatOutputLine(parsed, "");
      expect(result).toBe("Let me read the file [Read: src/main.ts]");
    });

    it("should handle unknown tool names", () => {
      const runner = new ClaudeCodeRunner();
      const formatOutputLine = (
        runner as unknown as {
          formatOutputLine: (parsed: unknown, raw: string) => string | null;
        }
      ).formatOutputLine.bind(runner);

      const parsed = {
        type: "assistant" as const,
        content: [
          {
            type: "tool_use" as const,
            name: "CustomTool",
            input: { data: "something" }
          }
        ]
      };

      const result = formatOutputLine(parsed, "");
      expect(result).toBe("[CustomTool]");
    });
  });

  describe("event emission", () => {
    it("should be an EventEmitter", () => {
      const runner = new ClaudeCodeRunner();
      expect(typeof runner.on).toBe("function");
      expect(typeof runner.emit).toBe("function");
      expect(typeof runner.removeListener).toBe("function");
    });
  });

  describe("kill", () => {
    it("should handle killing non-existent agent gracefully", async () => {
      const runner = new ClaudeCodeRunner();
      // Should not throw
      await runner.kill("non-existent-id");
    });
  });
});
