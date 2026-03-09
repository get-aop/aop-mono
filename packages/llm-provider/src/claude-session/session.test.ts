import { describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { ClaudeCodeSession } from "./session";
import { createParserState } from "./stream-parser";

describe("ClaudeCodeSession", () => {
  describe("initial state", () => {
    test("has correct initial state", () => {
      const session = new ClaudeCodeSession();
      expect(session.sessionId).toBeNull();
      expect(session.isRunning).toBe(false);
    });

    test("accepts options in constructor", () => {
      const session = new ClaudeCodeSession({
        cwd: "/test/dir",
        dangerouslySkipPermissions: true,
        inactivityTimeoutMs: 5000,
      });
      expect(session.sessionId).toBeNull();
      expect(session.isRunning).toBe(false);
    });
  });

  describe("event registration", () => {
    test("supports event registration and removal", () => {
      const session = new ClaudeCodeSession();
      let called = false;
      const handler = () => {
        called = true;
      };

      session.on("message", handler);
      session.off("message", handler);

      expect(called).toBe(false);
    });

    test("supports once() for one-time event handlers", () => {
      const session = new ClaudeCodeSession();
      let callCount = 0;

      session.once("message", () => {
        callCount++;
      });

      expect(callCount).toBe(0);
    });

    test("supports removeAllListeners()", () => {
      const session = new ClaudeCodeSession();
      const handler = () => {};

      session.on("message", handler);
      session.on("toolUse", handler);
      session.removeAllListeners();

      expect(session.isRunning).toBe(false);
    });

    test("supports chaining on event methods", () => {
      const session = new ClaudeCodeSession();
      const handler = () => {};

      const result = session.on("message", handler).on("toolUse", handler).off("message", handler);

      expect(result).toBe(session);
    });

    test("supports registering multiple handlers for same event", () => {
      const session = new ClaudeCodeSession();
      const calls: number[] = [];

      session.on("message", () => calls.push(1));
      session.on("message", () => calls.push(2));

      // @ts-expect-error accessing private emitter
      session.emitter.emit("message", "test");

      expect(calls).toEqual([1, 2]);
    });

    test("removeAllListeners clears specific event type when passed", () => {
      const session = new ClaudeCodeSession();
      const messageCalls: string[] = [];
      const toolCalls: string[] = [];

      session.on("message", (content) => messageCalls.push(content));
      session.on("toolUse", (name) => toolCalls.push(name));

      session.removeAllListeners("message");

      // @ts-expect-error accessing private emitter
      session.emitter.emit("message", "test");
      // @ts-expect-error accessing private emitter
      session.emitter.emit("toolUse", "Read", {});

      expect(messageCalls).toEqual([]);
      expect(toolCalls).toEqual(["Read"]);
    });
  });

  describe("run/resume guards", () => {
    test("run() throws if session is already running", async () => {
      const session = new ClaudeCodeSession();

      // @ts-expect-error accessing private property for test
      session._isRunning = true;

      await expect(session.run("test")).rejects.toThrow("Session is already running");
    });

    test("resume() throws if session is already running", async () => {
      const session = new ClaudeCodeSession();

      // @ts-expect-error accessing private property for test
      session._isRunning = true;

      await expect(session.resume("id", "answer")).rejects.toThrow("Session is already running");
    });
  });

  describe("event emission via internal handlers", () => {
    test("emits message event for assistant stream events", () => {
      const session = new ClaudeCodeSession();
      const messages: string[] = [];

      session.on("message", (content) => messages.push(content));

      // @ts-expect-error accessing private method
      session.handleEvent({
        type: "assistant",
        message: { content: "Hello world" },
      });

      expect(messages).toEqual(["Hello world"]);
    });

    test("emits toolUse event for tool_use stream events", () => {
      const session = new ClaudeCodeSession();
      const toolCalls: Array<{ name: string; input: unknown }> = [];

      session.on("toolUse", (name, input) => toolCalls.push({ name, input }));

      // @ts-expect-error accessing private method
      session.handleEvent({
        type: "tool_use",
        tool_use: { name: "Read", id: "tu_123", input: { path: "/test" } },
      });

      expect(toolCalls).toEqual([{ name: "Read", input: { path: "/test" } }]);
    });

    test("emits question event for AskUserQuestion tool use", () => {
      const session = new ClaudeCodeSession();
      const questions: unknown[] = [];

      session.on("question", (data) => questions.push(data));

      // @ts-expect-error accessing private method
      const killed = session.handleEvent({
        type: "tool_use",
        tool_use: {
          name: "AskUserQuestion",
          id: "tu_456",
          input: {
            questions: [
              {
                question: "What framework?",
                options: [{ label: "React" }, { label: "Vue" }],
              },
            ],
          },
        },
      });

      expect(killed).toBe(true);
      expect(questions).toHaveLength(1);
      expect(questions[0]).toEqual({
        questions: [
          {
            question: "What framework?",
            header: undefined,
            options: [
              { label: "React", description: undefined },
              { label: "Vue", description: undefined },
            ],
            multiSelect: undefined,
          },
        ],
      });
    });

    test("does not emit question for invalid AskUserQuestion input", () => {
      const session = new ClaudeCodeSession();
      const questions: unknown[] = [];

      session.on("question", (data) => questions.push(data));

      // @ts-expect-error accessing private method
      const killed = session.handleEvent({
        type: "tool_use",
        tool_use: {
          name: "AskUserQuestion",
          id: "tu_789",
          input: { invalid: "data" },
        },
      });

      expect(killed).toBe(false);
      expect(questions).toHaveLength(0);
    });

    test("updates lastOutput for result events with result field", () => {
      const session = new ClaudeCodeSession();

      // @ts-expect-error accessing private method
      session.handleEvent({
        type: "result",
        result: "Final output text",
        cost_usd: 0.01,
      });

      // @ts-expect-error accessing private property
      expect(session.lastOutput).toBe("Final output text");
    });

    test("does not update lastOutput for result events without result field", () => {
      const session = new ClaudeCodeSession();

      // @ts-expect-error accessing private property
      session.lastOutput = "previous";

      // @ts-expect-error accessing private method
      session.handleEvent({
        type: "result",
        cost_usd: 0.01,
      });

      // @ts-expect-error accessing private property
      expect(session.lastOutput).toBe("previous");
    });

    test("ignores system events", () => {
      const session = new ClaudeCodeSession();
      const messages: string[] = [];
      const tools: string[] = [];

      session.on("message", (content) => messages.push(content));
      session.on("toolUse", (name) => tools.push(name));

      // @ts-expect-error accessing private method
      const killed = session.handleEvent({
        type: "system",
        message: "Initializing...",
        subtype: "init",
      });

      expect(killed).toBe(false);
      expect(messages).toHaveLength(0);
      expect(tools).toHaveLength(0);
    });

    test("ignores tool_result events", () => {
      const session = new ClaudeCodeSession();
      const messages: string[] = [];
      const tools: string[] = [];

      session.on("message", (content) => messages.push(content));
      session.on("toolUse", (name) => tools.push(name));

      // @ts-expect-error accessing private method
      const killed = session.handleEvent({
        type: "tool_result",
        tool_result: { tool_use_id: "tu_1", content: "result" },
      });

      expect(killed).toBe(false);
      expect(messages).toHaveLength(0);
      expect(tools).toHaveLength(0);
    });
  });

  describe("AskUserQuestion parsing", () => {
    test("parses question with all fields", () => {
      const session = new ClaudeCodeSession();
      const questions: unknown[] = [];

      session.on("question", (data) => questions.push(data));

      // @ts-expect-error accessing private method
      session.handleEvent({
        type: "tool_use",
        tool_use: {
          name: "AskUserQuestion",
          id: "tu_1",
          input: {
            questions: [
              {
                question: "Pick one?",
                header: "Choice",
                options: [
                  { label: "A", description: "Option A" },
                  { label: "B", description: "Option B" },
                ],
                multiSelect: true,
              },
            ],
          },
        },
      });

      expect(questions[0]).toEqual({
        questions: [
          {
            question: "Pick one?",
            header: "Choice",
            options: [
              { label: "A", description: "Option A" },
              { label: "B", description: "Option B" },
            ],
            multiSelect: true,
          },
        ],
      });
    });

    test("parses question without optional fields", () => {
      const session = new ClaudeCodeSession();
      const questions: unknown[] = [];

      session.on("question", (data) => questions.push(data));

      // @ts-expect-error accessing private method
      session.handleEvent({
        type: "tool_use",
        tool_use: {
          name: "AskUserQuestion",
          id: "tu_1",
          input: {
            questions: [{ question: "What is your name?" }],
          },
        },
      });

      expect(questions[0]).toEqual({
        questions: [
          {
            question: "What is your name?",
            header: undefined,
            options: undefined,
            multiSelect: undefined,
          },
        ],
      });
    });

    test("skips questions with invalid structure", () => {
      const session = new ClaudeCodeSession();
      const questions: unknown[] = [];

      session.on("question", (data) => questions.push(data));

      // @ts-expect-error accessing private method
      session.handleEvent({
        type: "tool_use",
        tool_use: {
          name: "AskUserQuestion",
          id: "tu_1",
          input: {
            questions: [
              { question: "Valid?" },
              { notAQuestion: "invalid" },
              { question: "Also valid?" },
            ],
          },
        },
      });

      expect(questions[0]).toEqual({
        questions: [
          { question: "Valid?", header: undefined, options: undefined, multiSelect: undefined },
          {
            question: "Also valid?",
            header: undefined,
            options: undefined,
            multiSelect: undefined,
          },
        ],
      });
    });

    test("filters out options without label", () => {
      const session = new ClaudeCodeSession();
      const questions: unknown[] = [];

      session.on("question", (data) => questions.push(data));

      // @ts-expect-error accessing private method
      session.handleEvent({
        type: "tool_use",
        tool_use: {
          name: "AskUserQuestion",
          id: "tu_1",
          input: {
            questions: [
              {
                question: "Pick?",
                options: [{ label: "Valid" }, { description: "no label" }, { label: "Also valid" }],
              },
            ],
          },
        },
      });

      expect(questions[0]).toEqual({
        questions: [
          {
            question: "Pick?",
            header: undefined,
            options: [
              { label: "Valid", description: undefined },
              { label: "Also valid", description: undefined },
            ],
            multiSelect: undefined,
          },
        ],
      });
    });
  });

  describe("command building", () => {
    test("buildCommand creates correct basic command", () => {
      const session = new ClaudeCodeSession();

      // @ts-expect-error accessing private method
      const cmd = session.buildCommand("test prompt");

      expect(cmd).toEqual([
        "claude",
        "--output-format",
        "stream-json",
        "--print",
        "--verbose",
        "--setting-sources",
        "user,project",
        "--disallowed-tools",
        "AskUserQuestion",
        "test prompt",
      ]);
    });

    test("buildCommand includes dangerouslySkipPermissions flag when set", () => {
      const session = new ClaudeCodeSession({ dangerouslySkipPermissions: true });

      // @ts-expect-error accessing private method
      const cmd = session.buildCommand("test prompt");

      expect(cmd).toContain("--dangerously-skip-permissions");
      expect(cmd).toEqual([
        "claude",
        "--output-format",
        "stream-json",
        "--print",
        "--verbose",
        "--setting-sources",
        "user,project",
        "--disallowed-tools",
        "AskUserQuestion",
        "--dangerously-skip-permissions",
        "test prompt",
      ]);
    });

    test("buildResumeCommand creates correct command", () => {
      const session = new ClaudeCodeSession();

      // @ts-expect-error accessing private method
      const cmd = session.buildResumeCommand("session-id-123", "my answer");

      expect(cmd).toEqual([
        "claude",
        "--output-format",
        "stream-json",
        "--print",
        "--verbose",
        "--setting-sources",
        "user,project",
        "--disallowed-tools",
        "AskUserQuestion",
        "--resume",
        "session-id-123",
        "my answer",
      ]);
    });

    test("buildResumeCommand includes dangerouslySkipPermissions flag when set", () => {
      const session = new ClaudeCodeSession({ dangerouslySkipPermissions: true });

      // @ts-expect-error accessing private method
      const cmd = session.buildResumeCommand("session-id-123", "my answer");

      expect(cmd).toEqual([
        "claude",
        "--output-format",
        "stream-json",
        "--print",
        "--verbose",
        "--setting-sources",
        "user,project",
        "--disallowed-tools",
        "AskUserQuestion",
        "--resume",
        "session-id-123",
        "--dangerously-skip-permissions",
        "my answer",
      ]);
    });

    test("buildCommand supports overriding setting sources", () => {
      const session = new ClaudeCodeSession({ settingSources: "user" });
      // @ts-expect-error accessing private method
      const cmd = session.buildCommand("test prompt");
      expect(cmd).toContain("--setting-sources");
      expect(cmd).toContain("user");
    });
  });

  describe("buildEnvWithNodeModulesBin", () => {
    test("prepends node_modules/.bin to PATH with custom cwd", () => {
      const session = new ClaudeCodeSession({ cwd: "/test/project" });
      // @ts-expect-error accessing private method
      const env = session.buildEnvWithNodeModulesBin();
      expect(env.PATH).toStartWith("/test/project/node_modules/.bin:");
    });

    test("uses process.cwd() when no cwd option set", () => {
      const session = new ClaudeCodeSession();
      // @ts-expect-error accessing private method
      const env = session.buildEnvWithNodeModulesBin();
      expect(env.PATH).toStartWith(`${process.cwd()}/node_modules/.bin:`);
    });

    test("preserves existing PATH entries", () => {
      const session = new ClaudeCodeSession({ cwd: "/test" });
      // @ts-expect-error accessing private method
      const env = session.buildEnvWithNodeModulesBin();
      const originalPath = process.env.PATH || "";
      expect(env.PATH).toContain(originalPath);
    });
  });

  describe("emitFinalEvent", () => {
    test("emits completed with lastOutput on exit code 0", () => {
      const session = new ClaudeCodeSession();
      const events: Array<{ type: string; data: unknown }> = [];
      session.on("completed", (output) => events.push({ type: "completed", data: output }));
      session.on("error", (code) => events.push({ type: "error", data: code }));

      // @ts-expect-error accessing private property
      session.lastOutput = "final output";
      // @ts-expect-error accessing private method
      session.emitFinalEvent(false, 0);

      expect(events).toEqual([{ type: "completed", data: "final output" }]);
    });

    test("emits error on non-zero exit code", () => {
      const session = new ClaudeCodeSession();
      const events: Array<{ type: string; data: unknown }> = [];
      session.on("completed", (output) => events.push({ type: "completed", data: output }));
      session.on("error", (code) => events.push({ type: "error", data: code }));

      // @ts-expect-error accessing private method
      session.emitFinalEvent(false, 1);

      expect(events).toEqual([{ type: "error", data: 1 }]);
    });

    test("skips emission when killed for question", () => {
      const session = new ClaudeCodeSession();
      const events: string[] = [];
      session.on("completed", () => events.push("completed"));
      session.on("error", () => events.push("error"));

      // @ts-expect-error accessing private method
      session.emitFinalEvent(true, 0);

      expect(events).toEqual([]);
    });
  });

  describe("processStreamChunk", () => {
    test("parses assistant event and extracts sessionId", () => {
      const session = new ClaudeCodeSession();
      const messages: string[] = [];
      session.on("message", (content) => messages.push(content));

      const state = createParserState();
      const chunk = `${JSON.stringify({
        type: "assistant",
        session_id: "sess-abc",
        message: { content: [{ type: "text", text: "hello" }] },
      })}\n`;

      // @ts-expect-error accessing private method
      const result = session.processStreamChunk(chunk, state);

      expect(result.killedForQuestion).toBe(false);
      expect(messages).toEqual(["hello"]);
      expect(session.sessionId).toBe("sess-abc");
    });

    test("returns killedForQuestion for AskUserQuestion", () => {
      const session = new ClaudeCodeSession();
      const questions: unknown[] = [];
      session.on("question", (data) => questions.push(data));

      const state = createParserState();
      const chunk = `${JSON.stringify({
        type: "tool_use",
        tool_use: {
          name: "AskUserQuestion",
          id: "tu_1",
          input: { questions: [{ question: "Pick one?" }] },
        },
      })}\n`;

      // @ts-expect-error accessing private method
      const result = session.processStreamChunk(chunk, state);

      expect(result.killedForQuestion).toBe(true);
      expect(questions).toHaveLength(1);
    });

    test("processes multiple events in one chunk", () => {
      const session = new ClaudeCodeSession();
      const messages: string[] = [];
      session.on("message", (content) => messages.push(content));

      const state = createParserState();
      const line1 = JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "first" }] },
      });
      const line2 = JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "second" }] },
      });

      // @ts-expect-error accessing private method
      session.processStreamChunk(`${line1}\n${line2}\n`, state);

      expect(messages).toEqual(["first", "second"]);
    });

    test("does not overwrite sessionId if already set", () => {
      const session = new ClaudeCodeSession();
      // @ts-expect-error accessing private property
      session._sessionId = "original-id";

      const state = createParserState();
      const chunk = `${JSON.stringify({
        type: "assistant",
        session_id: "new-id",
        message: { content: [{ type: "text", text: "hello" }] },
      })}\n`;

      // @ts-expect-error accessing private method
      session.processStreamChunk(chunk, state);

      expect(session.sessionId).toBe("original-id");
    });
  });

  describe("flushRemainingEvents", () => {
    test("skips flushing when killed for question", () => {
      const session = new ClaudeCodeSession();
      const messages: string[] = [];
      session.on("message", (content) => messages.push(content));

      const state = createParserState();
      state.buffer = JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "should not appear" }] },
      });

      // @ts-expect-error accessing private method
      session.flushRemainingEvents(true, state);

      expect(messages).toEqual([]);
    });

    test("flushes remaining buffer events when not killed", () => {
      const session = new ClaudeCodeSession();
      const messages: string[] = [];
      session.on("message", (content) => messages.push(content));

      const state = createParserState();
      state.buffer = JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "flushed content" }] },
      });

      // @ts-expect-error accessing private method
      session.flushRemainingEvents(false, state);

      expect(messages).toEqual(["flushed content"]);
    });

    test("handles empty buffer gracefully", () => {
      const session = new ClaudeCodeSession();
      const messages: string[] = [];
      session.on("message", (content) => messages.push(content));

      const state = createParserState();
      state.buffer = "";

      // @ts-expect-error accessing private method
      session.flushRemainingEvents(false, state);

      expect(messages).toEqual([]);
    });
  });

  describe("stream processing via run()", () => {
    const writeTempFile = async (lines: Record<string, unknown>[]): Promise<string> => {
      const path = `/tmp/claude-session-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`;
      const content = `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
      await Bun.write(path, content);
      return path;
    };

    const removeTempFile = async (path: string): Promise<void> => {
      try {
        await unlink(path);
      } catch {}
    };

    test("processes stream JSON from a spawned process", async () => {
      const session = new ClaudeCodeSession();
      const messages: string[] = [];
      const completedOutputs: string[] = [];
      session.on("message", (content) => messages.push(content));
      session.on("completed", (output) => completedOutputs.push(output));

      const tmpFile = await writeTempFile([
        {
          type: "assistant",
          session_id: "integration-sess",
          message: { content: [{ type: "text", text: "Hello from process" }] },
        },
        { type: "result", result: "Final result text" },
      ]);

      // @ts-expect-error overriding private method for test
      session.buildCommand = () => ["cat", tmpFile];

      try {
        await session.run("test prompt");

        expect(messages).toEqual(["Hello from process"]);
        expect(session.sessionId).toBe("integration-sess");
        expect(completedOutputs).toEqual(["Final result text"]);
        expect(session.isRunning).toBe(false);
      } finally {
        await removeTempFile(tmpFile);
      }
    });

    test("emits error for non-zero exit code", async () => {
      const session = new ClaudeCodeSession();
      const errors: number[] = [];
      session.on("error", (code) => errors.push(code));

      // @ts-expect-error overriding private method for test
      session.buildCommand = () => ["sh", "-c", "exit 1"];

      await session.run("test");

      expect(errors).toEqual([1]);
      expect(session.isRunning).toBe(false);
    });

    test("resume processes stream and preserves sessionId", async () => {
      const session = new ClaudeCodeSession();
      const messages: string[] = [];
      const completedOutputs: string[] = [];
      session.on("message", (content) => messages.push(content));
      session.on("completed", (output) => completedOutputs.push(output));

      const tmpFile = await writeTempFile([
        { type: "assistant", message: { content: [{ type: "text", text: "resumed" }] } },
        { type: "result", result: "done" },
      ]);

      // @ts-expect-error overriding private method for test
      session.buildResumeCommand = () => ["cat", tmpFile];

      try {
        await session.resume("existing-session-id", "my answer");

        expect(session.sessionId).toBe("existing-session-id");
        expect(messages).toEqual(["resumed"]);
        expect(completedOutputs).toEqual(["done"]);
      } finally {
        await removeTempFile(tmpFile);
      }
    });

    test("kills process and emits question when AskUserQuestion in stream", async () => {
      const session = new ClaudeCodeSession();
      const questions: unknown[] = [];
      const completedOutputs: string[] = [];
      const errors: number[] = [];
      session.on("question", (data) => questions.push(data));
      session.on("completed", (output) => completedOutputs.push(output));
      session.on("error", (code) => errors.push(code));

      const tmpFile = await writeTempFile([
        {
          type: "tool_use",
          tool_use: {
            name: "AskUserQuestion",
            id: "tu_1",
            input: { questions: [{ question: "What framework?" }] },
          },
        },
      ]);

      // @ts-expect-error overriding private method for test
      session.buildCommand = () => ["cat", tmpFile];

      try {
        await session.run("test");

        expect(questions).toHaveLength(1);
        expect(session.isRunning).toBe(false);
        expect(completedOutputs).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await removeTempFile(tmpFile);
      }
    });

    test("handles stream read error gracefully", async () => {
      const session = new ClaudeCodeSession();
      const errors: number[] = [];
      session.on("error", (code) => errors.push(code));

      // @ts-expect-error overriding private method for test
      session.buildCommand = () => ["sh", "-c", "echo 'not json' && exit 0"];

      await session.run("test");

      expect(session.isRunning).toBe(false);
    });
  });
});
