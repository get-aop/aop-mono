import { describe, expect, test } from "bun:test";
import {
  extractToolDescription,
  formatToolInput,
  getCursorToolContext,
  getOpenCodeToolContext,
  normalizeToolName,
  summarizeToolArguments,
} from "./tools";
import type { RawProviderEvent } from "./types";

describe("normalizeToolName", () => {
  test("returns Tool for empty string", () => {
    expect(normalizeToolName("")).toBe("Tool");
    expect(normalizeToolName("  ")).toBe("Tool");
  });

  test("normalizes known tool names", () => {
    expect(normalizeToolName("bash")).toBe("Bash");
    expect(normalizeToolName("BASH")).toBe("Bash");
    expect(normalizeToolName("read")).toBe("Read");
    expect(normalizeToolName("grep")).toBe("Grep");
  });

  test("capitalizes first letter of unknown tools", () => {
    expect(normalizeToolName("custom")).toBe("Custom");
    expect(normalizeToolName("myTool")).toBe("MyTool");
  });
});

describe("summarizeToolArguments", () => {
  test("formats Bash commands", () => {
    expect(summarizeToolArguments("bash", { command: "ls -la" })).toBe("ls -la");
    expect(summarizeToolArguments("bash", { cmd: "echo test" })).toBe("echo test");
  });

  test("formats Read file paths", () => {
    expect(summarizeToolArguments("read", { file_path: "/path/to/file.txt" })).toBe(
      "/path/to/file.txt",
    );
    expect(summarizeToolArguments("read", { path: "/other/path" })).toBe("/other/path");
  });

  test("formats Write file paths", () => {
    expect(summarizeToolArguments("write", { file_path: "/path/file.txt" })).toBe("/path/file.txt");
  });

  test("formats Edit file paths", () => {
    expect(summarizeToolArguments("edit", { file_path: "/path/file.txt" })).toBe("/path/file.txt");
  });

  test("formats Glob patterns", () => {
    expect(summarizeToolArguments("glob", { pattern: "*.ts" })).toBe("*.ts");
    expect(summarizeToolArguments("glob", { pattern: "*.ts", path: "/src" })).toBe("*.ts in /src");
  });

  test("formats Grep patterns", () => {
    expect(summarizeToolArguments("grep", { pattern: "TODO" })).toBe("TODO");
    expect(summarizeToolArguments("grep", { pattern: "FIXME", path: "/app" })).toBe(
      "FIXME in /app",
    );
  });

  test("formats Skill invocations", () => {
    expect(summarizeToolArguments("skill", { skill: "commit" })).toBe("commit");
    expect(summarizeToolArguments("skill", { skill: "test", args: "-v" })).toBe("test -v");
  });

  test("formats Task descriptions", () => {
    expect(summarizeToolArguments("task", { description: "Run tests" })).toBe("Run tests");
    expect(summarizeToolArguments("task", { title: "Build app" })).toBe("Build app");
  });

  test("formats WebFetch URLs", () => {
    expect(summarizeToolArguments("webfetch", { url: "https://example.com" })).toBe(
      "https://example.com",
    );
  });

  test("formats WebSearch queries", () => {
    expect(summarizeToolArguments("websearch", { query: "bun test coverage" })).toBe(
      "bun test coverage",
    );
  });

  test("formats Question headers", () => {
    expect(summarizeToolArguments("question", { header: "Approach" })).toBe("Approach");
    expect(summarizeToolArguments("question", { question: "Which option?" })).toBe("Which option?");
  });

  test("handles string values in unknown tool", () => {
    const input = { key: "value" };
    const result = summarizeToolArguments("unknown", input);
    expect(result).toBe('{"key":"value"}');
  });

  test("handles number values in unknown tool", () => {
    const input = { count: 42, ratio: 3.14 };
    const result = summarizeToolArguments("unknown", input);
    expect(result).toBe('{"count":42,"ratio":3.14}');
  });

  test("handles boolean values in unknown tool", () => {
    const input = { enabled: true, disabled: false };
    const result = summarizeToolArguments("unknown", input);
    expect(result).toBe('{"enabled":true,"disabled":false}');
  });

  test("handles array values in unknown tool", () => {
    const input = { items: ["a", "b", "c"] };
    const result = summarizeToolArguments("unknown", input);
    expect(result).toBe('{"items":["a","b","c"]}');
  });

  test("handles nested objects in unknown tool", () => {
    const input = { config: { a: 1, b: 2 } };
    const result = summarizeToolArguments("unknown", input);
    expect(result).toBe('{"config":{"a":1,"b":2}}');
  });

  test("handles circular references in JSON.stringify fallback", () => {
    const circular: Record<string, unknown> = { a: 1, name: "test" };
    circular.self = circular;
    const result = summarizeToolArguments("unknown", circular);
    // Should fall back to manual serialization
    expect(result).toContain("a=1");
    expect(result).toContain("name=test");
    expect(result).toContain("self={");
  });

  test("handles input with many keys in fallback", () => {
    const circular: Record<string, unknown> = { a: 1, b: 2, c: 3, d: 4, e: 5 };
    circular.self = circular;
    const result = summarizeToolArguments("unknown", circular);
    // 6 keys total, shows first 3, so "+3 keys"
    expect(result).toContain("+3 keys");
  });

  test("handles empty input", () => {
    const result = summarizeToolArguments("unknown", {});
    expect(result).toBe("{}");
  });

  test("sanitizes whitespace", () => {
    expect(summarizeToolArguments("bash", { command: "ls   -la\n\t" })).toBe("ls -la");
  });

  test("truncates long values", () => {
    const longCommand = "a".repeat(300);
    const result = summarizeToolArguments("bash", { command: longCommand });
    expect(result.length).toBeLessThanOrEqual(181); // 180 + ellipsis
    expect(result).toMatch(/…$/);
  });
});

describe("extractToolDescription", () => {
  test("extracts description from first source", () => {
    expect(extractToolDescription({ description: "Test task" })).toBe("Test task");
  });

  test("extracts title as description", () => {
    expect(extractToolDescription({ title: "Main title" })).toBe("Main title");
  });

  test("prefers description over title", () => {
    expect(extractToolDescription({ description: "Desc", title: "Title" })).toBe("Desc");
  });

  test("searches multiple sources", () => {
    expect(extractToolDescription({}, { description: "Found" })).toBe("Found");
    expect(extractToolDescription(undefined, { title: "Found" })).toBe("Found");
  });

  test("searches nested objects with depth 2", () => {
    expect(
      extractToolDescription({
        nested: { deep: { description: "Deep desc" } },
      }),
    ).toBe("Deep desc");
  });

  test("falls back to summary, reason, or goal", () => {
    expect(extractToolDescription({ summary: "Summary text" })).toBe("Summary text");
    expect(extractToolDescription({ reason: "Because" })).toBe("Because");
    expect(extractToolDescription({ goal: "Goal text" })).toBe("Goal text");
  });

  test("searches nested for fallback keys", () => {
    expect(
      extractToolDescription({
        nested: { summary: "Nested summary" },
      }),
    ).toBe("Nested summary");
  });

  test("returns undefined when no description found", () => {
    expect(extractToolDescription({})).toBeUndefined();
    expect(extractToolDescription(undefined)).toBeUndefined();
    expect(extractToolDescription({ other: "value" })).toBeUndefined();
  });

  test("sanitizes whitespace in descriptions", () => {
    expect(extractToolDescription({ description: "  Multi   space  " })).toBe("Multi space");
  });

  test("truncates long descriptions to 140 chars", () => {
    const longDesc = "a".repeat(200);
    const result = extractToolDescription({ description: longDesc });
    expect(result?.length).toBeLessThanOrEqual(141);
    expect(result).toMatch(/…$/);
  });
});

describe("formatToolInput", () => {
  test("formats with 200 char limit", () => {
    const longCommand = "a".repeat(300);
    const result = formatToolInput("bash", { command: longCommand });
    expect(result.length).toBeLessThanOrEqual(201);
  });
});

describe("getOpenCodeToolContext", () => {
  test("returns null for non-tool_use events", () => {
    expect(getOpenCodeToolContext({ type: "text" })).toBeNull();
    expect(getOpenCodeToolContext({ type: "assistant" })).toBeNull();
  });

  test("returns null when part is not a record", () => {
    expect(getOpenCodeToolContext({ type: "tool_use", part: "string" })).toBeNull();
    expect(getOpenCodeToolContext({ type: "tool_use", part: null })).toBeNull();
  });

  test("extracts basic tool context", () => {
    const event: RawProviderEvent = {
      type: "tool_use",
      part: {
        tool: "bash",
        state: {
          input: { command: "ls" },
        },
      },
    };
    const result = getOpenCodeToolContext(event);
    expect(result).toEqual({
      toolName: "bash",
      input: { command: "ls" },
      description: undefined,
      status: undefined,
      message: undefined,
    });
  });

  test("defaults to Tool when tool name missing", () => {
    const event: RawProviderEvent = {
      type: "tool_use",
      part: { state: {} },
    };
    const result = getOpenCodeToolContext(event);
    expect(result?.toolName).toBe("Tool");
  });

  test("extracts description from input and state", () => {
    const event: RawProviderEvent = {
      type: "tool_use",
      part: {
        tool: "bash",
        state: {
          input: { command: "ls", description: "List files" },
        },
      },
    };
    const result = getOpenCodeToolContext(event);
    expect(result?.description).toBe("List files");
  });

  test("extracts status from state", () => {
    const event: RawProviderEvent = {
      type: "tool_use",
      part: {
        tool: "bash",
        state: { status: "completed", input: {} },
      },
    };
    const result = getOpenCodeToolContext(event);
    expect(result?.status).toBe("completed");
  });

  test("extracts error message from state", () => {
    const event: RawProviderEvent = {
      type: "tool_use",
      part: {
        tool: "bash",
        state: { error: "Command failed", input: {} },
      },
    };
    const result = getOpenCodeToolContext(event);
    expect(result?.message).toBe("Command failed");
  });

  test("prefers error over message in state", () => {
    const event: RawProviderEvent = {
      type: "tool_use",
      part: {
        tool: "bash",
        state: {
          error: "Error msg",
          message: "Regular msg",
          input: {},
        },
      },
    };
    const result = getOpenCodeToolContext(event);
    expect(result?.message).toBe("Error msg");
  });

  test("falls back to message when no error", () => {
    const event: RawProviderEvent = {
      type: "tool_use",
      part: {
        tool: "bash",
        state: { message: "Info msg", input: {} },
      },
    };
    const result = getOpenCodeToolContext(event);
    expect(result?.message).toBe("Info msg");
  });

  test("handles missing state", () => {
    const event: RawProviderEvent = {
      type: "tool_use",
      part: { tool: "bash" },
    };
    const result = getOpenCodeToolContext(event);
    expect(result?.input).toEqual({});
    expect(result?.status).toBeUndefined();
  });

  test("handles non-record state", () => {
    const event: RawProviderEvent = {
      type: "tool_use",
      part: { tool: "bash", state: "string" },
    };
    const result = getOpenCodeToolContext(event);
    expect(result?.input).toEqual({});
  });
});

describe("getCursorToolContext", () => {
  test("returns null for non-tool_call events", () => {
    expect(getCursorToolContext({ type: "text" })).toBeNull();
    expect(getCursorToolContext({ type: "assistant" })).toBeNull();
  });

  test("returns null when tool_call is not a record", () => {
    expect(getCursorToolContext({ type: "tool_call", tool_call: "string" })).toBeNull();
    expect(getCursorToolContext({ type: "tool_call", tool_call: null })).toBeNull();
  });

  test("extracts Read tool from readToolCall", () => {
    const event: RawProviderEvent = {
      type: "tool_call",
      tool_call: {
        readToolCall: {
          args: { path: "/file.txt" },
        },
      },
    };
    const result = getCursorToolContext(event);
    expect(result).toEqual({
      toolName: "Read",
      input: { file_path: "/file.txt" },
    });
  });

  test("extracts Write tool from writeToolCall", () => {
    const event: RawProviderEvent = {
      type: "tool_call",
      tool_call: {
        writeToolCall: {
          args: { file_path: "/output.txt" },
        },
      },
    };
    const result = getCursorToolContext(event);
    expect(result).toEqual({
      toolName: "Write",
      input: { file_path: "/output.txt" },
    });
  });

  test("extracts Edit tool from editToolCall", () => {
    const event: RawProviderEvent = {
      type: "tool_call",
      tool_call: {
        editToolCall: {
          args: { path: "/edit.txt" },
        },
      },
    };
    const result = getCursorToolContext(event);
    expect(result).toEqual({
      toolName: "Edit",
      input: { file_path: "/edit.txt" },
    });
  });

  test("prioritizes path over file_path in args", () => {
    const event: RawProviderEvent = {
      type: "tool_call",
      tool_call: {
        readToolCall: {
          args: { file_path: "/primary.txt", path: "/secondary.txt" },
        },
      },
    };
    const result = getCursorToolContext(event);
    expect(result?.input.file_path).toBe("/secondary.txt");
  });

  test("extracts function tool with JSON string arguments", () => {
    const event: RawProviderEvent = {
      type: "tool_call",
      tool_call: {
        function: {
          name: "bash",
          arguments: '{"command":"ls"}',
        },
      },
    };
    const result = getCursorToolContext(event);
    expect(result).toEqual({
      toolName: "bash",
      input: { command: "ls" },
    });
  });

  test("extracts function tool with object arguments", () => {
    const event: RawProviderEvent = {
      type: "tool_call",
      tool_call: {
        function: {
          name: "bash",
          arguments: { command: "ls" },
        },
      },
    };
    const result = getCursorToolContext(event);
    expect(result).toEqual({
      toolName: "bash",
      input: { command: "ls" },
    });
  });

  test("handles invalid JSON in function arguments", () => {
    const event: RawProviderEvent = {
      type: "tool_call",
      tool_call: {
        function: {
          name: "bash",
          arguments: "{invalid json",
        },
      },
    };
    const result = getCursorToolContext(event);
    expect(result?.input).toEqual({ arguments: "{invalid json" });
  });

  test("handles non-object parsed JSON in function arguments", () => {
    const event: RawProviderEvent = {
      type: "tool_call",
      tool_call: {
        function: {
          name: "bash",
          arguments: '["array"]',
        },
      },
    };
    const result = getCursorToolContext(event);
    expect(result?.input).toEqual({ arguments: '["array"]' });
  });

  test("handles missing function name", () => {
    const event: RawProviderEvent = {
      type: "tool_call",
      tool_call: {
        function: {
          arguments: { command: "ls" },
        },
      },
    };
    const result = getCursorToolContext(event);
    expect(result?.toolName).toBe("Tool");
  });

  test("returns null when function is empty", () => {
    const event: RawProviderEvent = {
      type: "tool_call",
      tool_call: {
        function: {},
      },
    };
    const result = getCursorToolContext(event);
    expect(result).toBeNull();
  });

  test("returns null when tool_call is empty", () => {
    const event: RawProviderEvent = {
      type: "tool_call",
      tool_call: {},
    };
    const result = getCursorToolContext(event);
    expect(result).toBeNull();
  });

  test("handles null or undefined arguments", () => {
    const event1: RawProviderEvent = {
      type: "tool_call",
      tool_call: {
        function: { name: "bash", arguments: null },
      },
    };
    expect(getCursorToolContext(event1)?.input).toEqual({});

    const event2: RawProviderEvent = {
      type: "tool_call",
      tool_call: {
        function: { name: "bash", arguments: undefined },
      },
    };
    expect(getCursorToolContext(event2)?.input).toEqual({});
  });

  test("handles non-string, non-record arguments", () => {
    const event: RawProviderEvent = {
      type: "tool_call",
      tool_call: {
        function: { name: "bash", arguments: 123 },
      },
    };
    expect(getCursorToolContext(event)?.input).toEqual({});
  });
});
