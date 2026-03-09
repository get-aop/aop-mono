import { describe, expect, test } from "bun:test";
import {
  extractAssistantTextFromRawEvent,
  isFailureMarker,
  normalizeRawEvent,
  normalizeRawEvents,
} from "./normalize";
import type { NormalizedLogEvent, ParsedRawLogEntry, RawProviderEvent } from "./types";

// Type helpers for tests
type ToolStarted = Extract<NormalizedLogEvent, { kind: "tool_started" }>;
type AssistantText = Extract<NormalizedLogEvent, { kind: "assistant_text" }>;
type ResultSuccess = Extract<NormalizedLogEvent, { kind: "result_success" }>;
type ErrorEvent = Extract<NormalizedLogEvent, { kind: "error" }>;

describe("normalizeRawEvent - claude-code provider", () => {
  const createEntry = (event: RawProviderEvent): ParsedRawLogEntry => ({
    index: 0,
    raw: JSON.stringify(event),
    event,
    provider: "claude-code",
  });

  test("normalizes tool_use event", () => {
    const entry = createEntry({
      type: "tool_use",
      tool_name: "bash",
      input: { command: "ls" },
    });
    const result = normalizeRawEvent(entry);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: "tool_started",
      provider: "claude-code",
      toolName: "Bash",
      primaryInput: "ls",
      description: undefined,
    });
  });

  test("normalizes tool_use with name field", () => {
    const entry = createEntry({
      type: "tool_use",
      name: "bash",
      input: { command: "ls" },
    });
    const result = normalizeRawEvent(entry);
    expect(result).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: test verified length
    const event = result[0]! as ToolStarted;
    expect(event.toolName).toBe("Bash");
  });

  test("normalizes tool_use with description", () => {
    const entry = createEntry({
      type: "tool_use",
      tool_name: "bash",
      input: { command: "ls", description: "List files" },
    });
    const result = normalizeRawEvent(entry);
    expect(result).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: test verified length
    const event = result[0]! as ToolStarted;
    expect(event.description).toBe("List files");
  });

  test("normalizes tool_use with non-record input", () => {
    const entry = createEntry({
      type: "tool_use",
      tool_name: "bash",
      input: "string",
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toMatchObject({
      kind: "tool_started",
      primaryInput: "",
    });
  });

  test("normalizes result success event with string result", () => {
    const entry = createEntry({
      type: "result",
      subtype: "success",
      result: "Operation completed",
    });
    const result = normalizeRawEvent(entry);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: "result_success",
      provider: "claude-code",
      text: "Operation completed",
    });
  });

  test("normalizes result success with empty result", () => {
    const entry = createEntry({
      type: "result",
      subtype: "success",
      result: "",
    });
    const result = normalizeRawEvent(entry);
    expect(result).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: test verified length
    const event = result[0]! as ResultSuccess;
    expect(event.text).toBeUndefined();
  });

  test("normalizes result error event as error", () => {
    const entry = createEntry({
      type: "result",
      subtype: "error",
      result: "Error occurred",
    });
    const result = normalizeRawEvent(entry);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: "error",
      provider: "claude-code",
      text: "Error occurred",
    });
  });

  test("normalizes result failure event as error", () => {
    const entry = createEntry({
      type: "result",
      subtype: "failure",
      result: "Failed",
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toMatchObject({
      kind: "error",
      text: "Failed",
    });
  });

  test("normalizes result error with empty message as error", () => {
    const entry = createEntry({
      type: "result",
      subtype: "error",
      result: "",
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toMatchObject({
      kind: "error",
      text: "Unknown error",
    });
  });

  test("normalizes result with uppercase subtype", () => {
    const entry = createEntry({
      type: "result",
      subtype: "SUCCESS",
      result: "Done",
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]?.kind).toBe("result_success");
  });

  test("normalizes result with non-string result", () => {
    const entry = createEntry({
      type: "result",
      subtype: "success",
      result: { data: "value" },
    });
    const result = normalizeRawEvent(entry);
    // biome-ignore lint/style/noNonNullAssertion: test verified length
    expect((result[0]! as AssistantText | ResultSuccess | ErrorEvent).text).toBeUndefined();
  });

  test("treats result with unknown subtype as result_success", () => {
    const entry = createEntry({
      type: "result",
      subtype: "unknown",
      result: "text",
    });
    const result = normalizeRawEvent(entry);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: "result_success",
      provider: "claude-code",
      text: "text",
    });
  });

  test("normalizes assistant message as string", () => {
    const entry = createEntry({
      type: "assistant",
      message: "Hello world",
    });
    const result = normalizeRawEvent(entry);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: "assistant_text",
      provider: "claude-code",
      text: "Hello world",
    });
  });

  test("normalizes assistant message with content blocks", () => {
    const entry = createEntry({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Line 1" },
          { type: "text", text: "Line 2" },
        ],
      },
    });
    const result = normalizeRawEvent(entry);
    expect(result).toHaveLength(2);
    // biome-ignore lint/style/noNonNullAssertion: test verified length
    expect((result[0]! as AssistantText | ResultSuccess | ErrorEvent).text).toBe("Line 1");
    // biome-ignore lint/style/noNonNullAssertion: test verified length
    expect((result[1]! as AssistantText | ResultSuccess | ErrorEvent).text).toBe("Line 2");
  });

  test("filters non-text content blocks", () => {
    const entry = createEntry({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Valid" },
          { type: "image", data: "..." },
          { type: "text", text: "Also valid" },
        ],
      },
    });
    const result = normalizeRawEvent(entry);
    expect(result).toHaveLength(2);
    // biome-ignore lint/style/noNonNullAssertion: test verified length
    expect((result[0]! as AssistantText | ResultSuccess | ErrorEvent).text).toBe("Valid");
    // biome-ignore lint/style/noNonNullAssertion: test verified length
    expect((result[1]! as AssistantText | ResultSuccess | ErrorEvent).text).toBe("Also valid");
  });

  test("handles assistant message with multiline text", () => {
    const entry = createEntry({
      type: "assistant",
      message: "Line 1\nLine 2\n\nLine 3",
    });
    const result = normalizeRawEvent(entry);
    expect(result).toHaveLength(3);
    expect(result.map((r) => (r as AssistantText).text)).toEqual(["Line 1", "Line 2", "Line 3"]);
  });

  test("trims and filters empty lines", () => {
    const entry = createEntry({
      type: "assistant",
      message: "  Line 1  \n\n  \n  Line 2  ",
    });
    const result = normalizeRawEvent(entry);
    expect(result).toHaveLength(2);
    // biome-ignore lint/style/noNonNullAssertion: test verified length
    expect((result[0]! as AssistantText | ResultSuccess | ErrorEvent).text).toBe("Line 1");
    // biome-ignore lint/style/noNonNullAssertion: test verified length
    expect((result[1]! as AssistantText | ResultSuccess | ErrorEvent).text).toBe("Line 2");
  });

  test("handles assistant with non-record message", () => {
    const entry = createEntry({
      type: "assistant",
      message: 123,
    });
    const result = normalizeRawEvent(entry);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("noise");
  });

  test("handles assistant with missing content", () => {
    const entry = createEntry({
      type: "assistant",
      message: {},
    });
    const result = normalizeRawEvent(entry);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("noise");
  });

  test("returns noise for unhandled event type", () => {
    const entry = createEntry({
      type: "unknown",
    });
    const result = normalizeRawEvent(entry);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: "noise",
      provider: "claude-code",
      reason: "claude-unhandled",
    });
  });
});

describe("normalizeRawEvent - opencode provider", () => {
  const createEntry = (event: RawProviderEvent): ParsedRawLogEntry => ({
    index: 0,
    raw: JSON.stringify(event),
    event,
    provider: "opencode",
  });

  test("normalizes text event", () => {
    const entry = createEntry({
      type: "text",
      part: { text: "Processing\nDone" },
    });
    const result = normalizeRawEvent(entry);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      kind: "assistant_text",
      provider: "opencode",
      text: "Processing",
    });
    // biome-ignore lint/style/noNonNullAssertion: test verified length
    expect((result[1]! as AssistantText | ResultSuccess | ErrorEvent).text).toBe("Done");
  });

  test("ignores text event without part.text", () => {
    const entry = createEntry({
      type: "text",
      part: { data: "something" },
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]?.kind).toBe("noise");
  });

  test("normalizes tool_use with success status", () => {
    const entry = createEntry({
      type: "tool_use",
      part: {
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "ls" },
        },
      },
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toMatchObject({
      kind: "tool_started",
      toolName: "Bash",
      primaryInput: "ls",
    });
  });

  test("normalizes tool_use with complete status", () => {
    const entry = createEntry({
      type: "tool_use",
      part: {
        tool: "bash",
        state: { status: "complete", input: {} },
      },
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]?.kind).toBe("tool_started");
  });

  test("normalizes tool_use with done status", () => {
    const entry = createEntry({
      type: "tool_use",
      part: {
        tool: "bash",
        state: { status: "done", input: {} },
      },
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]?.kind).toBe("tool_started");
  });

  test("normalizes tool_use with success status", () => {
    const entry = createEntry({
      type: "tool_use",
      part: {
        tool: "bash",
        state: { status: "success", input: {} },
      },
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]?.kind).toBe("tool_started");
  });

  test("normalizes tool_use with error status as error", () => {
    const entry = createEntry({
      type: "tool_use",
      part: {
        tool: "bash",
        state: {
          status: "error",
          message: "Command failed",
          input: {},
        },
      },
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toMatchObject({
      kind: "error",
      text: "Command failed",
    });
  });

  test("normalizes tool_use with failed status as error", () => {
    const entry = createEntry({
      type: "tool_use",
      part: {
        tool: "bash",
        state: { status: "failed", input: {} },
      },
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toMatchObject({
      kind: "error",
      text: "Unknown error",
    });
  });

  test("normalizes tool_use with failure status as error", () => {
    const entry = createEntry({
      type: "tool_use",
      part: {
        tool: "bash",
        state: { status: "failure", input: {} },
      },
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toMatchObject({
      kind: "error",
      text: "Unknown error",
    });
  });

  test("normalizes tool_use without status as started", () => {
    const entry = createEntry({
      type: "tool_use",
      part: {
        tool: "bash",
        state: { input: { command: "ls" } },
      },
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]?.kind).toBe("tool_started");
  });

  test("returns noise for unhandled opencode event", () => {
    const entry = createEntry({
      type: "unknown",
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toEqual({
      kind: "noise",
      provider: "opencode",
      reason: "opencode-unhandled",
    });
  });
});

describe("normalizeRawEvent - cursor-cli provider", () => {
  const createEntry = (event: RawProviderEvent): ParsedRawLogEntry => ({
    index: 0,
    raw: JSON.stringify(event),
    event,
    provider: "cursor-cli",
  });

  test("normalizes tool_call with completed subtype", () => {
    const entry = createEntry({
      type: "tool_call",
      subtype: "completed",
      tool_call: {
        function: { name: "bash", arguments: { command: "ls" } },
      },
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toMatchObject({
      kind: "tool_completed",
      toolName: "Bash",
      success: true,
    });
  });

  test("normalizes tool_call without completed subtype", () => {
    const entry = createEntry({
      type: "tool_call",
      tool_call: {
        function: { name: "bash", arguments: { command: "ls" } },
      },
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toMatchObject({
      kind: "tool_started",
      toolName: "Bash",
      primaryInput: "ls",
    });
  });

  test("normalizes cursor assistant text", () => {
    const entry = createEntry({
      type: "assistant",
      message: "Processing task",
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toEqual({
      kind: "assistant_text",
      provider: "cursor-cli",
      text: "Processing task",
    });
  });

  test("returns noise for unhandled cursor event", () => {
    const entry = createEntry({
      type: "unknown",
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toEqual({
      kind: "noise",
      provider: "cursor-cli",
      reason: "cursor-unhandled",
    });
  });
});

describe("normalizeRawEvent - unknown provider", () => {
  test("uses claude-code normalization for unknown provider", () => {
    const entry: ParsedRawLogEntry = {
      index: 0,
      raw: "{}",
      event: {
        type: "assistant",
        message: "Test",
      },
      provider: "unknown",
    };
    const result = normalizeRawEvent(entry);
    expect(result[0]).toMatchObject({
      kind: "assistant_text",
      provider: "unknown",
      text: "Test",
    });
  });
});

describe("normalizeRawEvent - failure markers", () => {
  const createEntry = (event: RawProviderEvent): ParsedRawLogEntry => ({
    index: 0,
    raw: JSON.stringify(event),
    event,
    provider: "claude-code",
  });

  test("detects error type as failure", () => {
    const entry = createEntry({
      type: "error",
      message: "Something failed",
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toMatchObject({
      kind: "error",
      text: "Something failed",
    });
  });

  test("detects fatal type as failure", () => {
    const entry = createEntry({
      type: "fatal",
      error: "Critical error",
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toMatchObject({
      kind: "error",
      text: "Critical error",
    });
  });

  test("detects error level as failure", () => {
    const entry = createEntry({
      type: "log",
      level: "error",
      result: "Error message",
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toMatchObject({
      kind: "error",
      text: "Error message",
    });
  });

  test("detects error subtype as failure", () => {
    const entry = createEntry({
      type: "event",
      subtype: "error",
      message: "Failed",
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]?.kind).toBe("error");
  });

  test("detects failure subtype", () => {
    const entry = createEntry({
      type: "event",
      subtype: "failure",
      message: "Failed",
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]?.kind).toBe("error");
  });

  test("detects failed subtype", () => {
    const entry = createEntry({
      type: "event",
      subtype: "failed",
      message: "Failed",
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]?.kind).toBe("error");
  });

  test("detects error status as failure", () => {
    const entry = createEntry({
      type: "event",
      status: "error",
      message: "Failed",
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]?.kind).toBe("error");
  });

  test("detects tool_use with error in state", () => {
    const entry = createEntry({
      type: "tool_use",
      part: {
        state: {
          status: "error",
          error: "Tool failed",
        },
      },
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toMatchObject({
      kind: "error",
      text: "Tool failed",
    });
  });

  test("detects tool_use with error field in state", () => {
    const entry = createEntry({
      type: "tool_use",
      part: {
        state: {
          error: "Tool error",
        },
      },
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toMatchObject({
      kind: "error",
      text: "Tool error",
    });
  });

  test("detects top-level error field", () => {
    const entry = createEntry({
      type: "event",
      error: "Top-level error",
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toMatchObject({
      kind: "error",
      text: "Top-level error",
    });
  });

  test("extracts nested error message", () => {
    const entry = createEntry({
      type: "error",
      details: {
        error: "Nested error",
      },
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toMatchObject({
      kind: "error",
      text: "Nested error",
    });
  });

  test("extracts deeply nested error", () => {
    const entry = createEntry({
      type: "error",
      wrapper: {
        inner: {
          deep: {
            message: "Deep error",
          },
        },
      },
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toMatchObject({
      kind: "error",
      text: "Deep error",
    });
  });

  test("falls back to Unknown error when no message found", () => {
    const entry = createEntry({
      type: "error",
    });
    const result = normalizeRawEvent(entry);
    expect(result[0]).toMatchObject({
      kind: "error",
      text: "Unknown error",
    });
  });

  test("prefers result over error and message", () => {
    const entry = createEntry({
      type: "error",
      result: "Result text",
      error: "Error text",
      message: "Message text",
    });
    const result = normalizeRawEvent(entry);
    // biome-ignore lint/style/noNonNullAssertion: test verified length
    expect((result[0]! as AssistantText | ResultSuccess | ErrorEvent).text).toBe("Result text");
  });

  test("prefers error over message", () => {
    const entry = createEntry({
      type: "error",
      error: "Error text",
      message: "Message text",
    });
    const result = normalizeRawEvent(entry);
    // biome-ignore lint/style/noNonNullAssertion: test verified length
    expect((result[0]! as AssistantText | ResultSuccess | ErrorEvent).text).toBe("Error text");
  });

  test("ignores empty string candidates", () => {
    const entry = createEntry({
      type: "error",
      result: "  ",
      error: "",
      message: "Valid message",
    });
    const result = normalizeRawEvent(entry);
    // biome-ignore lint/style/noNonNullAssertion: test verified length
    expect((result[0]! as AssistantText | ResultSuccess | ErrorEvent).text).toBe("Valid message");
  });
});

describe("normalizeRawEvents", () => {
  test("normalizes multiple entries", () => {
    const entries: ParsedRawLogEntry[] = [
      {
        index: 0,
        raw: "{}",
        event: { type: "assistant", message: "Line 1" },
        provider: "claude-code",
      },
      {
        index: 1,
        raw: "{}",
        event: { type: "assistant", message: "Line 2" },
        provider: "claude-code",
      },
    ];
    const result = normalizeRawEvents(entries);
    expect(result).toHaveLength(2);
    // biome-ignore lint/style/noNonNullAssertion: test verified length
    expect((result[0]! as AssistantText | ResultSuccess | ErrorEvent).text).toBe("Line 1");
    // biome-ignore lint/style/noNonNullAssertion: test verified length
    expect((result[1]! as AssistantText | ResultSuccess | ErrorEvent).text).toBe("Line 2");
  });

  test("flattens multiline results", () => {
    const entries: ParsedRawLogEntry[] = [
      {
        index: 0,
        raw: "{}",
        event: { type: "assistant", message: "Line 1\nLine 2" },
        provider: "claude-code",
      },
    ];
    const result = normalizeRawEvents(entries);
    expect(result).toHaveLength(2);
  });
});

describe("extractAssistantTextFromRawEvent", () => {
  test("extracts text from opencode text event", () => {
    const event: RawProviderEvent = {
      type: "text",
      part: { text: "Hello" },
    };
    expect(extractAssistantTextFromRawEvent(event)).toBe("Hello");
  });

  test("extracts from result success event", () => {
    const event: RawProviderEvent = {
      type: "result",
      subtype: "success",
      result: "Done",
    };
    expect(extractAssistantTextFromRawEvent(event)).toBe("Done");
  });

  test("returns empty for result success with non-string", () => {
    const event: RawProviderEvent = {
      type: "result",
      subtype: "success",
      result: { data: "value" },
    };
    expect(extractAssistantTextFromRawEvent(event)).toBe("");
  });

  test("ignores result without success subtype", () => {
    const event: RawProviderEvent = {
      type: "result",
      subtype: "error",
      result: "Error",
    };
    expect(extractAssistantTextFromRawEvent(event)).toBe("");
  });

  test("extracts from assistant string message", () => {
    const event: RawProviderEvent = {
      type: "assistant",
      message: "Test message",
    };
    expect(extractAssistantTextFromRawEvent(event)).toBe("Test message");
  });

  test("extracts and joins content blocks", () => {
    const event: RawProviderEvent = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Part 1" },
          { type: "text", text: "Part 2" },
        ],
      },
    };
    expect(extractAssistantTextFromRawEvent(event)).toBe("Part 1\nPart 2");
  });

  test("filters non-text blocks", () => {
    const event: RawProviderEvent = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Valid" },
          { type: "image", data: "..." },
        ],
      },
    };
    expect(extractAssistantTextFromRawEvent(event)).toBe("Valid");
  });

  test("returns empty for non-assistant event", () => {
    const event: RawProviderEvent = {
      type: "tool_use",
      tool_name: "bash",
    };
    expect(extractAssistantTextFromRawEvent(event)).toBe("");
  });

  test("returns empty for assistant with non-record message", () => {
    const event: RawProviderEvent = {
      type: "assistant",
      message: 123,
    };
    expect(extractAssistantTextFromRawEvent(event)).toBe("");
  });

  test("handles missing content array", () => {
    const event: RawProviderEvent = {
      type: "assistant",
      message: {},
    };
    expect(extractAssistantTextFromRawEvent(event)).toBe("");
  });
});

describe("normalizeRawEvent - edge cases", () => {
  test("normalizes non-failure result with error subtype directly", () => {
    // Test the normalizeResultEvent path without failure marker detection
    const entry: ParsedRawLogEntry = {
      index: 0,
      raw: "{}",
      event: {
        type: "result",
        subtype: "error",
        result: "not really an error",
      },
      provider: "claude-code",
    };
    const result = normalizeRawEvent(entry);
    // This will be caught by failure marker, so it becomes an error
    expect(result[0]?.kind).toBe("error");
  });

  test("normalizes opencode tool failure status directly", () => {
    // Test the normalizeOpenCodeToolEvent failure path
    const entry: ParsedRawLogEntry = {
      index: 0,
      raw: "{}",
      event: {
        type: "tool_use",
        part: {
          tool: "bash",
          state: {
            status: "error",
            message: "Command failed",
            input: {},
          },
        },
      },
      provider: "opencode",
    };
    const result = normalizeRawEvent(entry);
    // This will be caught by failure marker first
    expect(result[0]?.kind).toBe("error");
  });
});

describe("isFailureMarker", () => {
  test("detects error type", () => {
    expect(isFailureMarker({ type: "error" })).toBe(true);
    expect(isFailureMarker({ type: "Error" })).toBe(true);
  });

  test("detects fatal type", () => {
    expect(isFailureMarker({ type: "fatal" })).toBe(true);
    expect(isFailureMarker({ type: "FATAL" })).toBe(true);
  });

  test("detects error level", () => {
    expect(isFailureMarker({ type: "log", level: "error" })).toBe(true);
    expect(isFailureMarker({ type: "log", level: "ERROR" })).toBe(true);
  });

  test("detects failure subtypes", () => {
    expect(isFailureMarker({ type: "event", subtype: "error" })).toBe(true);
    expect(isFailureMarker({ type: "event", subtype: "failure" })).toBe(true);
    expect(isFailureMarker({ type: "event", subtype: "failed" })).toBe(true);
  });

  test("detects failure status", () => {
    expect(isFailureMarker({ type: "event", status: "error" })).toBe(true);
    expect(isFailureMarker({ type: "event", status: "failure" })).toBe(true);
  });

  test("detects top-level error field", () => {
    expect(isFailureMarker({ type: "event", error: "Something failed" })).toBe(true);
  });

  test("detects tool_use failure", () => {
    expect(
      isFailureMarker({
        type: "tool_use",
        part: {
          state: { status: "error" },
        },
      }),
    ).toBe(true);
  });

  test("detects tool_use with error field", () => {
    expect(
      isFailureMarker({
        type: "tool_use",
        part: {
          state: { error: "Tool failed" },
        },
      }),
    ).toBe(true);
  });

  test("returns false for success events", () => {
    expect(isFailureMarker({ type: "assistant", message: "ok" })).toBe(false);
    expect(isFailureMarker({ type: "result", subtype: "success" })).toBe(false);
    expect(isFailureMarker({ type: "tool_use", tool_name: "bash" })).toBe(false);
  });

  test("returns false for non-failure tool_use", () => {
    expect(
      isFailureMarker({
        type: "tool_use",
        part: {
          state: { status: "success" },
        },
      }),
    ).toBe(false);
  });

  test("handles missing fields gracefully", () => {
    expect(isFailureMarker({})).toBe(false);
    expect(isFailureMarker({ type: "unknown" })).toBe(false);
  });
});
