import { describe, expect, test } from "bun:test";
import { createParserState, flushBuffer, parseLine, processChunk } from "./stream-parser";

describe("parseLine", () => {
  test("parses assistant event", () => {
    const result = parseLine('{"type":"assistant","message":{"content":"Hello"}}');
    expect(result).toEqual({
      type: "assistant",
      session_id: undefined,
      message: { content: "Hello" },
    });
  });

  test("parses assistant event with session_id", () => {
    const result = parseLine(
      '{"type":"assistant","session_id":"abc-123","message":{"content":"Hi"}}',
    );
    expect(result).toEqual({
      type: "assistant",
      session_id: "abc-123",
      message: { content: "Hi" },
    });
  });

  test("parses assistant event with array content", () => {
    const result = parseLine(
      '{"type":"assistant","session_id":"abc-123","message":{"content":[{"type":"text","text":"Hello world"}]}}',
    );
    expect(result).toEqual({
      type: "assistant",
      session_id: "abc-123",
      message: { content: "Hello world" },
    });
  });

  test("parses assistant event with multiple text blocks", () => {
    const result = parseLine(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Part 1"},{"type":"text","text":" Part 2"}]}}',
    );
    expect(result).toEqual({
      type: "assistant",
      session_id: undefined,
      message: { content: "Part 1 Part 2" },
    });
  });

  test("returns null for assistant event with empty array content", () => {
    const result = parseLine('{"type":"assistant","message":{"content":[]}}');
    expect(result).toBeNull();
  });

  test("parses tool_use event", () => {
    const result = parseLine(
      '{"type":"tool_use","tool_use":{"name":"Read","id":"tu_1","input":{"path":"/foo"}}}',
    );
    expect(result).toEqual({
      type: "tool_use",
      session_id: undefined,
      tool_use: { name: "Read", id: "tu_1", input: { path: "/foo" } },
    });
  });

  test("parses tool_result event", () => {
    const result = parseLine(
      '{"type":"tool_result","tool_result":{"tool_use_id":"tu_1","content":"file contents"}}',
    );
    expect(result).toEqual({
      type: "tool_result",
      session_id: undefined,
      tool_result: { tool_use_id: "tu_1", content: "file contents" },
    });
  });

  test("parses system event", () => {
    const result = parseLine('{"type":"system","message":"Starting...","subtype":"init"}');
    expect(result).toEqual({
      type: "system",
      session_id: undefined,
      message: "Starting...",
      subtype: "init",
    });
  });

  test("parses result event", () => {
    const result = parseLine(
      '{"type":"result","result":"Done","cost_usd":0.05,"duration_ms":1500,"num_turns":3}',
    );
    expect(result).toEqual({
      type: "result",
      session_id: undefined,
      result: "Done",
      cost_usd: 0.05,
      duration_ms: 1500,
      num_turns: 3,
    });
  });

  test("returns null for empty line", () => {
    expect(parseLine("")).toBeNull();
  });

  test("returns null for whitespace-only line", () => {
    expect(parseLine("   \t  ")).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    expect(parseLine("not json")).toBeNull();
  });

  test("returns null for unknown event type", () => {
    expect(parseLine('{"type":"unknown","data":"foo"}')).toBeNull();
  });

  test("returns null for missing message content in assistant event", () => {
    expect(parseLine('{"type":"assistant","message":{}}')).toBeNull();
  });

  test("returns null for missing tool_use fields", () => {
    expect(parseLine('{"type":"tool_use","tool_use":{"name":"Read"}}')).toBeNull();
  });
});

describe("processChunk", () => {
  test("processes single complete line", () => {
    const state = createParserState();
    const { events, sessionId } = processChunk('{"type":"system","message":"hi"}\n', state);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("system");
    expect(sessionId).toBeUndefined();
  });

  test("buffers incomplete line", () => {
    const state = createParserState();
    const { events } = processChunk('{"type":"system"', state);
    expect(events).toHaveLength(0);
    expect(state.buffer).toBe('{"type":"system"');
  });

  test("completes buffered line on next chunk", () => {
    const state = createParserState();
    processChunk('{"type":"system"', state);
    const { events } = processChunk(',"message":"done"}\n', state);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("system");
  });

  test("processes multiple lines in single chunk", () => {
    const state = createParserState();
    const chunk = '{"type":"system","message":"a"}\n{"type":"system","message":"b"}\n';
    const { events } = processChunk(chunk, state);
    expect(events).toHaveLength(2);
  });

  test("extracts and tracks session_id", () => {
    const state = createParserState();
    const { sessionId } = processChunk('{"type":"system","session_id":"s123"}\n', state);
    expect(sessionId).toBe("s123");
    expect(state.sessionId).toBe("s123");
  });
});

describe("flushBuffer", () => {
  test("processes remaining buffer content", () => {
    const state = createParserState();
    state.buffer = '{"type":"system","message":"final"}';
    const events = flushBuffer(state);
    expect(events).toHaveLength(1);
    expect(state.buffer).toBe("");
  });

  test("returns empty array for empty buffer", () => {
    const state = createParserState();
    const events = flushBuffer(state);
    expect(events).toHaveLength(0);
  });

  test("returns empty array for whitespace-only buffer", () => {
    const state = createParserState();
    state.buffer = "   ";
    const events = flushBuffer(state);
    expect(events).toHaveLength(0);
  });
});

describe("parseLine edge cases", () => {
  test("handles nested JSON in tool_use input", () => {
    const nestedInput = {
      type: "tool_use",
      tool_use: {
        name: "Write",
        id: "tu_nested",
        input: {
          file_path: "/test.json",
          content: '{"key": "value", "nested": {"deep": true}}',
        },
      },
    };
    const result = parseLine(JSON.stringify(nestedInput));
    expect(result).toEqual({
      type: "tool_use",
      session_id: undefined,
      tool_use: {
        name: "Write",
        id: "tu_nested",
        input: {
          file_path: "/test.json",
          content: '{"key": "value", "nested": {"deep": true}}',
        },
      },
    });
  });

  test("handles unicode in assistant message content", () => {
    const result = parseLine('{"type":"assistant","message":{"content":"Hello 你好 🎉 مرحبا"}}');
    expect(result).toEqual({
      type: "assistant",
      session_id: undefined,
      message: { content: "Hello 你好 🎉 مرحبا" },
    });
  });

  test("handles escaped characters in strings", () => {
    const result = parseLine(
      '{"type":"assistant","message":{"content":"Line 1\\nLine 2\\tTabbed\\r\\nWindows line"}}',
    );
    expect(result).toEqual({
      type: "assistant",
      session_id: undefined,
      message: { content: "Line 1\nLine 2\tTabbed\r\nWindows line" },
    });
  });

  test("handles empty string content in assistant message", () => {
    const result = parseLine('{"type":"assistant","message":{"content":""}}');
    expect(result).toEqual({
      type: "assistant",
      session_id: undefined,
      message: { content: "" },
    });
  });

  test("handles very long content in assistant message", () => {
    const longContent = "x".repeat(10000);
    const result = parseLine(`{"type":"assistant","message":{"content":"${longContent}"}}`);
    expect(result).toEqual({
      type: "assistant",
      session_id: undefined,
      message: { content: longContent },
    });
  });

  test("handles null values in optional fields", () => {
    const result = parseLine('{"type":"result","result":null,"cost_usd":null}');
    expect(result).toEqual({
      type: "result",
      session_id: undefined,
      result: undefined,
      cost_usd: undefined,
      duration_ms: undefined,
      num_turns: undefined,
    });
  });

  test("handles extra unexpected fields gracefully", () => {
    const result = parseLine(
      '{"type":"system","message":"test","extra_field":"ignored","another":123}',
    );
    expect(result).toEqual({
      type: "system",
      session_id: undefined,
      message: "test",
      subtype: undefined,
    });
  });

  test("returns null for truncated JSON", () => {
    expect(parseLine('{"type":"assistant","message":')).toBeNull();
  });

  test("returns null for JSON array instead of object", () => {
    expect(parseLine('[{"type":"assistant"}]')).toBeNull();
  });

  test("returns null for primitive JSON values", () => {
    expect(parseLine('"just a string"')).toBeNull();
    expect(parseLine("123")).toBeNull();
    expect(parseLine("true")).toBeNull();
    expect(parseLine("null")).toBeNull();
  });

  test("handles tool_result with empty content", () => {
    const result = parseLine('{"type":"tool_result","tool_result":{"tool_use_id":"tu_1"}}');
    expect(result).toEqual({
      type: "tool_result",
      session_id: undefined,
      tool_result: {
        tool_use_id: "tu_1",
        content: "",
      },
    });
  });

  test("handles tool_use with undefined input", () => {
    const result = parseLine('{"type":"tool_use","tool_use":{"name":"Bash","id":"tu_1"}}');
    expect(result).toEqual({
      type: "tool_use",
      session_id: undefined,
      tool_use: {
        name: "Bash",
        id: "tu_1",
        input: undefined,
      },
    });
  });

  test("handles tool_use with array input", () => {
    const result = parseLine(
      '{"type":"tool_use","tool_use":{"name":"Multi","id":"tu_1","input":["a","b","c"]}}',
    );
    expect(result).toEqual({
      type: "tool_use",
      session_id: undefined,
      tool_use: {
        name: "Multi",
        id: "tu_1",
        input: ["a", "b", "c"],
      },
    });
  });
});

describe("processChunk edge cases", () => {
  test("handles carriage return line endings", () => {
    const state = createParserState();
    const { events } = processChunk(
      '{"type":"system","message":"a"}\r\n{"type":"system","message":"b"}\r\n',
      state,
    );
    expect(events).toHaveLength(2);
  });

  test("handles mixed valid and invalid lines", () => {
    const state = createParserState();
    const { events } = processChunk(
      '{"type":"system","message":"valid"}\nnot json\n{"type":"system","message":"also valid"}\n',
      state,
    );
    expect(events).toHaveLength(2);
  });

  test("preserves session_id across multiple chunks", () => {
    const state = createParserState();

    const { sessionId: first } = processChunk('{"type":"system","session_id":"sess_1"}\n', state);
    expect(first).toBe("sess_1");
    expect(state.sessionId).toBe("sess_1");

    const { sessionId: second } = processChunk('{"type":"system","message":"no session"}\n', state);
    expect(second).toBe("sess_1");
    expect(state.sessionId).toBe("sess_1");
  });

  test("updates session_id when new one is received", () => {
    const state = createParserState();

    processChunk('{"type":"system","session_id":"sess_1"}\n', state);
    expect(state.sessionId).toBe("sess_1");

    processChunk('{"type":"system","session_id":"sess_2"}\n', state);
    expect(state.sessionId).toBe("sess_2");
  });

  test("handles empty chunks", () => {
    const state = createParserState();
    const { events } = processChunk("", state);
    expect(events).toHaveLength(0);
    expect(state.buffer).toBe("");
  });

  test("handles chunk that is just newlines", () => {
    const state = createParserState();
    const { events } = processChunk("\n\n\n", state);
    expect(events).toHaveLength(0);
  });

  test("handles large number of events in single chunk", () => {
    const state = createParserState();
    const lines = `${Array.from({ length: 100 }, (_, i) => `{"type":"system","message":"msg ${i}"}`).join("\n")}\n`;

    const { events } = processChunk(lines, state);
    expect(events).toHaveLength(100);
  });

  test("handles buffer accumulation across many small chunks", () => {
    const state = createParserState();
    const message = '{"type":"system","message":"complete"}';
    const chars = [...message];

    for (const char of chars) {
      processChunk(char, state);
    }
    expect(state.buffer).toBe(message);

    const { events } = processChunk("\n", state);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("system");
  });
});

describe("session_id extraction", () => {
  test("extracts session_id from assistant event", () => {
    const result = parseLine(
      '{"type":"assistant","session_id":"s_123","message":{"content":"hi"}}',
    );
    expect(result?.session_id).toBe("s_123");
  });

  test("extracts session_id from tool_use event", () => {
    const result = parseLine(
      '{"type":"tool_use","session_id":"s_456","tool_use":{"name":"Read","id":"tu_1","input":{}}}',
    );
    expect(result?.session_id).toBe("s_456");
  });

  test("extracts session_id from tool_result event", () => {
    const result = parseLine(
      '{"type":"tool_result","session_id":"s_789","tool_result":{"tool_use_id":"tu_1","content":"data"}}',
    );
    expect(result?.session_id).toBe("s_789");
  });

  test("extracts session_id from system event", () => {
    const result = parseLine('{"type":"system","session_id":"s_abc","message":"init"}');
    expect(result?.session_id).toBe("s_abc");
  });

  test("extracts session_id from result event", () => {
    const result = parseLine('{"type":"result","session_id":"s_def","result":"done"}');
    expect(result?.session_id).toBe("s_def");
  });

  test("session_id is undefined when not present", () => {
    const result = parseLine('{"type":"system","message":"no session"}');
    expect(result?.session_id).toBeUndefined();
  });

  test("session_id is undefined when not a string", () => {
    const result = parseLine('{"type":"system","session_id":12345,"message":"number session"}');
    expect(result?.session_id).toBeUndefined();
  });
});
