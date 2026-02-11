import { beforeAll, describe, expect, test } from "bun:test";
import { configureLogging, type Logger } from "@aop/infra";
import { createOutputLogger, extractAssistantText, formatToolInput } from "./output-logger";

beforeAll(async () => {
  await configureLogging({ level: "fatal" });
});

interface LogCall {
  level: string;
  message: string;
  props: Record<string, unknown>;
}

const createMockLogger = (): { logger: Logger; calls: LogCall[] } => {
  const calls: LogCall[] = [];
  const createMethod = (level: string) => (message: string, props?: Record<string, unknown>) => {
    calls.push({ level, message, props: props ?? {} });
  };

  const logger = {
    debug: createMethod("debug"),
    info: createMethod("info"),
    warn: createMethod("warn"),
    error: createMethod("error"),
    fatal: createMethod("fatal"),
    with: () => logger,
  } as unknown as Logger;

  return { logger, calls };
};

const getCall = (calls: LogCall[], index: number): LogCall => {
  const call = calls[index];
  if (!call) throw new Error(`Expected call at index ${index} but only ${calls.length} calls`);
  return call;
};

describe("formatToolInput", () => {
  test("formats Bash command", () => {
    expect(formatToolInput("Bash", { command: "ls -la" })).toBe("ls -la");
    expect(formatToolInput("Bash", {})).toBe("");
  });

  test("formats Read file_path", () => {
    expect(formatToolInput("Read", { file_path: "/tmp/test.txt" })).toBe("/tmp/test.txt");
    expect(formatToolInput("Read", {})).toBe("");
  });

  test("formats Write file_path", () => {
    expect(formatToolInput("Write", { file_path: "/tmp/out.txt" })).toBe("/tmp/out.txt");
  });

  test("formats Edit file_path", () => {
    expect(formatToolInput("Edit", { file_path: "/tmp/edit.txt" })).toBe("/tmp/edit.txt");
  });

  test("formats Glob pattern with optional path", () => {
    expect(formatToolInput("Glob", { pattern: "*.ts" })).toBe("*.ts");
    expect(formatToolInput("Glob", { pattern: "*.ts", path: "/src" })).toBe("*.ts in /src");
    expect(formatToolInput("Glob", {})).toBe("");
  });

  test("formats Grep pattern with optional path", () => {
    expect(formatToolInput("Grep", { pattern: "TODO" })).toBe("TODO");
    expect(formatToolInput("Grep", { pattern: "TODO", path: "/src" })).toBe("TODO in /src");
  });

  test("formats Skill with optional args", () => {
    expect(formatToolInput("Skill", { skill: "commit" })).toBe("commit");
    expect(formatToolInput("Skill", { skill: "commit", args: "-m 'test'" })).toBe(
      "commit -m 'test'",
    );
  });

  test("formats Task description", () => {
    expect(formatToolInput("Task", { description: "Run tests" })).toBe("Run tests");
  });

  test("formats WebFetch url", () => {
    expect(formatToolInput("WebFetch", { url: "https://example.com" })).toBe("https://example.com");
  });

  test("formats WebSearch query", () => {
    expect(formatToolInput("WebSearch", { query: "bun test" })).toBe("bun test");
  });

  test("falls back to JSON for unknown tools", () => {
    expect(formatToolInput("UnknownTool", { foo: "bar" })).toBe('{"foo":"bar"}');
  });

  test("truncates long JSON output to 200 chars", () => {
    const longInput = { data: "x".repeat(300) };
    const result = formatToolInput("UnknownTool", longInput);
    expect(result.length).toBe(200);
  });
});

describe("extractAssistantText", () => {
  test("extracts text from assistant message with content blocks", () => {
    const data = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Hello" },
          { type: "tool_use", name: "Read" },
          { type: "text", text: "World" },
        ],
      },
    };

    expect(extractAssistantText(data)).toBe("Hello\nWorld");
  });

  test("extracts text from string message", () => {
    const data = {
      type: "assistant",
      message: "Simple string message",
    };

    expect(extractAssistantText(data)).toBe("Simple string message");
  });

  test("returns empty string for non-assistant type", () => {
    const data = {
      type: "tool_result",
      message: { content: [{ type: "text", text: "Should not extract" }] },
    };

    expect(extractAssistantText(data)).toBe("");
  });

  test("returns empty string for missing content", () => {
    const data = {
      type: "assistant",
      message: {},
    };

    expect(extractAssistantText(data)).toBe("");
  });

  test("returns empty string for null message", () => {
    const data = {
      type: "assistant",
      message: null,
    };

    expect(extractAssistantText(data)).toBe("");
  });

  test("extracts text from successful result event", () => {
    const data = {
      type: "result",
      subtype: "success",
      result: "Final summary with <aop>REVIEW_PASSED</aop>",
    };

    expect(extractAssistantText(data)).toBe("Final summary with <aop>REVIEW_PASSED</aop>");
  });

  test("extracts text from OpenCode text.part.text event", () => {
    const data = {
      type: "text",
      part: { text: "All set <aop>ALL_TASKS_DONE</aop>" },
    };

    expect(extractAssistantText(data)).toBe("All set <aop>ALL_TASKS_DONE</aop>");
  });
});

describe("createOutputLogger", () => {
  test("logs text content from assistant messages", () => {
    const { logger, calls } = createMockLogger();
    const handler = createOutputLogger({ categories: ["test"], logger });

    handler({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello world" }] },
    });

    expect(calls).toHaveLength(1);
    expect(getCall(calls, 0).level).toBe("info");
    expect(getCall(calls, 0).message).toBe("message: {line}");
    expect(getCall(calls, 0).props.line).toBe("Hello world");
  });

  test("logs tool_use content blocks with formatted input", () => {
    const { logger, calls } = createMockLogger();
    const handler = createOutputLogger({ categories: ["test"], logger });

    handler({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
      },
    });

    expect(calls).toHaveLength(1);
    expect(getCall(calls, 0).level).toBe("debug");
    expect(getCall(calls, 0).message).toBe("tool: {tool} {input}");
    expect(getCall(calls, 0).props.tool).toBe("Bash");
    expect(getCall(calls, 0).props.input).toBe("ls -la");
  });

  test("handles tool_use with missing name and input", () => {
    const { logger, calls } = createMockLogger();
    const handler = createOutputLogger({ categories: ["test"], logger });

    handler({
      type: "assistant",
      message: { content: [{ type: "tool_use" }] },
    });

    expect(calls).toHaveLength(1);
    expect(getCall(calls, 0).props.tool).toBe("unknown");
    expect(getCall(calls, 0).props.input).toBe("");
  });

  test("logs string assistant messages line by line", () => {
    const { logger, calls } = createMockLogger();
    const handler = createOutputLogger({ categories: ["test"], logger });

    handler({
      type: "assistant",
      message: "Line one\nLine two\nLine three",
    });

    expect(calls).toHaveLength(3);
    expect(getCall(calls, 0).props.line).toBe("Line one");
    expect(getCall(calls, 1).props.line).toBe("Line two");
    expect(getCall(calls, 2).props.line).toBe("Line three");
  });

  test("skips empty lines in text content", () => {
    const { logger, calls } = createMockLogger();
    const handler = createOutputLogger({ categories: ["test"], logger });

    handler({
      type: "assistant",
      message: "Line one\n\n  \nLine two",
    });

    expect(calls).toHaveLength(2);
    expect(getCall(calls, 0).props.line).toBe("Line one");
    expect(getCall(calls, 1).props.line).toBe("Line two");
  });

  test("includes iteration number in log properties", () => {
    const { logger, calls } = createMockLogger();
    const handler = createOutputLogger({ categories: ["test"], logger, iter: 5 });

    handler({
      type: "assistant",
      message: { content: [{ type: "text", text: "Test" }] },
    });

    expect(getCall(calls, 0).props.iter).toBe(5);
  });

  test("logs tool_use event type", () => {
    const { logger, calls } = createMockLogger();
    const handler = createOutputLogger({ categories: ["test"], logger });

    handler({ type: "tool_use", tool_name: "Read" });

    expect(calls).toHaveLength(1);
    expect(getCall(calls, 0).level).toBe("debug");
    expect(getCall(calls, 0).message).toBe("tool: {name}");
    expect(getCall(calls, 0).props.name).toBe("Read");
  });

  test("logs tool_result with preview", () => {
    const { logger, calls } = createMockLogger();
    const handler = createOutputLogger({ categories: ["test"], logger });

    handler({ type: "tool_result", result: "File contents here" });

    expect(calls).toHaveLength(1);
    expect(getCall(calls, 0).level).toBe("debug");
    expect(getCall(calls, 0).message).toBe("result: {preview}");
    expect(getCall(calls, 0).props.preview).toBe("File contents here");
  });

  test("truncates long tool_result", () => {
    const { logger, calls } = createMockLogger();
    const handler = createOutputLogger({ categories: ["test"], logger });

    handler({ type: "tool_result", result: "x".repeat(150) });

    expect(getCall(calls, 0).props.preview).toBe(`${"x".repeat(100)}...`);
  });

  test("skips tool_result with no result", () => {
    const { logger, calls } = createMockLogger();
    const handler = createOutputLogger({ categories: ["test"], logger });

    handler({ type: "tool_result" });

    expect(calls).toHaveLength(0);
  });

  test("logs result success with result text", () => {
    const { logger, calls } = createMockLogger();
    const handler = createOutputLogger({ categories: ["test"], logger });

    handler({ type: "result", subtype: "success", result: "Task completed successfully" });

    expect(calls).toHaveLength(1);
    expect(getCall(calls, 0).level).toBe("info");
    expect(getCall(calls, 0).message).toBe("session complete: {result}");
    expect(getCall(calls, 0).props.result).toBe("Task completed successfully");
  });

  test("logs result error", () => {
    const { logger, calls } = createMockLogger();
    const handler = createOutputLogger({ categories: ["test"], logger });

    handler({ type: "result", subtype: "error", result: "Something failed" });

    expect(calls).toHaveLength(1);
    expect(getCall(calls, 0).level).toBe("error");
    expect(getCall(calls, 0).message).toBe("error: {result}");
    expect(getCall(calls, 0).props.result).toBe("Something failed");
  });

  test("logs system messages", () => {
    const { logger, calls } = createMockLogger();
    const handler = createOutputLogger({ categories: ["test"], logger });

    handler({ type: "system", message: "Initializing..." });

    expect(calls).toHaveLength(1);
    expect(getCall(calls, 0).level).toBe("debug");
    expect(getCall(calls, 0).message).toBe("system: {msg}");
    expect(getCall(calls, 0).props.msg).toBe("Initializing...");
  });

  test("logs user messages", () => {
    const { logger, calls } = createMockLogger();
    const handler = createOutputLogger({ categories: ["test"], logger });

    handler({
      type: "user",
      message: { content: [{ type: "text", text: "User input here" }] },
    });

    expect(calls).toHaveLength(1);
    expect(getCall(calls, 0).level).toBe("info");
    expect(getCall(calls, 0).props.line).toBe("User input here");
  });

  test("warns on unknown message types", () => {
    const { logger, calls } = createMockLogger();
    const handler = createOutputLogger({ categories: ["test"], logger });

    handler({ type: "unknown_type", data: "test" });

    expect(calls).toHaveLength(1);
    expect(getCall(calls, 0).level).toBe("warn");
    expect(getCall(calls, 0).message).toBe("unhandled: {type} {data}");
    expect(getCall(calls, 0).props.type).toBe("unknown_type");
  });
});
