import { describe, expect, it, mock, spyOn } from "bun:test";
import type {
  AskUserQuestionInput,
  ClaudeEventHandler,
  ClaudeInitEvent,
  ClaudeResultEvent
} from "./claude-events";
import {
  type IOHandler,
  runClaudeSession,
  runJsonStreamSession
} from "./claude-session";

const createMockStream = (chunks: Uint8Array[] = []) => {
  let index = 0;
  return {
    async *[Symbol.asyncIterator]() {
      while (index < chunks.length) {
        yield chunks[index++];
      }
    }
  } as unknown as ReadableStream<Uint8Array>;
};

const createMockEventHandler = (): ClaudeEventHandler & {
  events: Array<{ type: string; data: unknown }>;
} => {
  const events: Array<{ type: string; data: unknown }> = [];
  return {
    events,
    onInit: mock((event: ClaudeInitEvent) => {
      events.push({ type: "init", data: event });
    }),
    onText: mock((text: string) => {
      events.push({ type: "text", data: text });
    }),
    onAskQuestion: mock(
      async (_toolUseId: string, _input: AskUserQuestionInput) => {
        events.push({ type: "askQuestion", data: { _toolUseId, _input } });
        return JSON.stringify({ answers: { Color: "Blue" } });
      }
    ),
    onToolUse: mock((toolUseId: string, name: string, input: unknown) => {
      events.push({ type: "toolUse", data: { toolUseId, name, input } });
    }),
    onResult: mock((event: ClaudeResultEvent) => {
      events.push({ type: "result", data: event });
    }),
    onError: mock((error: Error) => {
      events.push({ type: "error", data: error });
    })
  };
};

describe("runClaudeSession", () => {
  describe("piped mode", () => {
    it("should spawn claude with correct arguments", async () => {
      const mockHandler: IOHandler = {
        onOutput: mock(() => {}),
        onError: mock(() => {}),
        getInput: () => null
      };

      const mockProc = {
        stdin: { write: mock(() => 0), end: mock(() => {}) },
        stdout: createMockStream(),
        stderr: createMockStream(),
        exited: Promise.resolve(0),
        exitCode: 0
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      await runClaudeSession({
        cwd: "/test/dir",
        prompt: "test prompt",
        ioHandler: mockHandler
      });

      expect(spawnSpy).toHaveBeenCalledWith(["claude", "-p", "test prompt"], {
        cwd: "/test/dir",
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe"
      });

      spawnSpy.mockRestore();
    });

    it("should return success on exit code 0", async () => {
      const mockHandler: IOHandler = {
        onOutput: mock(() => {}),
        onError: mock(() => {}),
        getInput: () => null
      };

      const mockProc = {
        stdin: { write: mock(() => 0), end: mock(() => {}) },
        stdout: createMockStream(),
        stderr: createMockStream(),
        exited: Promise.resolve(0),
        exitCode: 0
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      const result = await runClaudeSession({
        cwd: "/test/dir",
        prompt: "test",
        ioHandler: mockHandler
      });

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);

      spawnSpy.mockRestore();
    });

    it("should return failure on non-zero exit code", async () => {
      const mockHandler: IOHandler = {
        onOutput: mock(() => {}),
        onError: mock(() => {}),
        getInput: () => null
      };

      const mockProc = {
        stdin: { write: mock(() => 0), end: mock(() => {}) },
        stdout: createMockStream(),
        stderr: createMockStream(),
        exited: Promise.resolve(1),
        exitCode: 1
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      const result = await runClaudeSession({
        cwd: "/test/dir",
        prompt: "test",
        ioHandler: mockHandler
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);

      spawnSpy.mockRestore();
    });

    it("should forward stdout to handler", async () => {
      const outputData: Uint8Array[] = [];
      const mockHandler: IOHandler = {
        onOutput: (data) => outputData.push(data),
        onError: mock(() => {}),
        getInput: () => null
      };

      const testData = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"

      const mockProc = {
        stdin: { write: mock(() => 0), end: mock(() => {}) },
        stdout: createMockStream([testData]),
        stderr: createMockStream(),
        exited: Promise.resolve(0),
        exitCode: 0
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      await runClaudeSession({
        cwd: "/test/dir",
        prompt: "test",
        ioHandler: mockHandler
      });

      expect(outputData).toEqual([testData]);

      spawnSpy.mockRestore();
    });

    it("should handle spawn failure", async () => {
      const mockHandler: IOHandler = {
        onOutput: mock(() => {}),
        onError: mock(() => {}),
        getInput: () => null
      };

      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
        throw new Error("Command not found");
      });

      const result = await runClaudeSession({
        cwd: "/test/dir",
        prompt: "test",
        ioHandler: mockHandler
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(-1);
      expect(result.error).toContain("Command not found");

      spawnSpy.mockRestore();
    });
  });

  describe("interactive mode", () => {
    it("should spawn claude with inherit stdio", async () => {
      const mockProc = {
        exited: Promise.resolve(0),
        exitCode: 0
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      await runClaudeSession({
        cwd: "/test/dir",
        prompt: "test prompt",
        interactive: true
      });

      expect(spawnSpy).toHaveBeenCalledWith(["claude", "test prompt"], {
        cwd: "/test/dir",
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit"
      });

      spawnSpy.mockRestore();
    });

    it("should return success on exit code 0", async () => {
      const mockProc = {
        exited: Promise.resolve(0),
        exitCode: 0
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      const result = await runClaudeSession({
        cwd: "/test/dir",
        prompt: "test",
        interactive: true
      });

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);

      spawnSpy.mockRestore();
    });

    it("should return failure on non-zero exit code", async () => {
      const mockProc = {
        exited: Promise.resolve(1),
        exitCode: 1
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      const result = await runClaudeSession({
        cwd: "/test/dir",
        prompt: "test",
        interactive: true
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);

      spawnSpy.mockRestore();
    });

    it("should handle spawn failure", async () => {
      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
        throw new Error("Command not found");
      });

      const result = await runClaudeSession({
        cwd: "/test/dir",
        prompt: "test",
        interactive: true
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(-1);
      expect(result.error).toContain("Command not found");

      spawnSpy.mockRestore();
    });
  });

  describe("json stream mode", () => {
    it("should spawn claude with json stream arguments", async () => {
      const mockHandler = createMockEventHandler();

      const mockProc = {
        pid: 12345,
        stdin: {
          write: mock(() => 0),
          flush: mock(() => {}),
          end: mock(() => {})
        },
        stdout: createMockStream(),
        stderr: createMockStream(),
        exited: Promise.resolve(0),
        exitCode: 0
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      await runJsonStreamSession({
        cwd: "/test/dir",
        prompt: "test prompt",
        eventHandler: mockHandler
      });

      expect(spawnSpy).toHaveBeenCalledWith(
        [
          "claude",
          "--output-format",
          "stream-json",
          "--verbose",
          "--dangerously-skip-permissions",
          "test prompt"
        ],
        {
          cwd: "/test/dir",
          stdout: "pipe",
          stderr: "pipe"
        }
      );

      spawnSpy.mockRestore();
    });

    it("should parse and route init event", async () => {
      const mockHandler = createMockEventHandler();

      const initEvent = JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "abc123",
        tools: ["Read"],
        model: "claude-3-opus"
      });

      const mockProc = {
        pid: 12345,
        stdin: {
          write: mock(() => 0),
          flush: mock(() => {}),
          end: mock(() => {})
        },
        stdout: createMockStream([new TextEncoder().encode(`${initEvent}\n`)]),
        stderr: createMockStream(),
        exited: Promise.resolve(0),
        exitCode: 0
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      await runJsonStreamSession({
        cwd: "/test/dir",
        prompt: "test",
        eventHandler: mockHandler
      });

      expect(mockHandler.onInit).toHaveBeenCalled();
      expect(mockHandler.events.find((e) => e.type === "init")).toBeDefined();

      spawnSpy.mockRestore();
    });

    it("should parse and route text content", async () => {
      const mockHandler = createMockEventHandler();

      const assistantEvent = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello, world!" }]
        },
        session_id: "abc123"
      });

      const mockProc = {
        pid: 12345,
        stdin: {
          write: mock(() => 0),
          flush: mock(() => {}),
          end: mock(() => {})
        },
        stdout: createMockStream([
          new TextEncoder().encode(`${assistantEvent}\n`)
        ]),
        stderr: createMockStream(),
        exited: Promise.resolve(0),
        exitCode: 0
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      await runJsonStreamSession({
        cwd: "/test/dir",
        prompt: "test",
        eventHandler: mockHandler
      });

      expect(mockHandler.onText).toHaveBeenCalledWith("Hello, world!");

      spawnSpy.mockRestore();
    });

    it("should handle AskUserQuestion tool and call handler", async () => {
      const mockHandler = createMockEventHandler();

      const toolUseEvent = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-123",
              name: "AskUserQuestion",
              input: {
                questions: [
                  {
                    question: "What is your favorite color?",
                    header: "Color",
                    options: [{ label: "Blue", description: "Calming" }],
                    multiSelect: false
                  }
                ]
              }
            }
          ]
        },
        session_id: "abc123"
      });

      const mockProc = {
        pid: 12345,
        stdout: createMockStream([
          new TextEncoder().encode(`${toolUseEvent}\n`)
        ]),
        stderr: createMockStream(),
        exited: Promise.resolve(0),
        exitCode: 0
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      await runJsonStreamSession({
        cwd: "/test/dir",
        prompt: "test",
        eventHandler: mockHandler
      });

      expect(mockHandler.onAskQuestion).toHaveBeenCalledWith("tool-123", {
        questions: [
          {
            question: "What is your favorite color?",
            header: "Color",
            options: [{ label: "Blue", description: "Calming" }],
            multiSelect: false
          }
        ]
      });

      spawnSpy.mockRestore();
    });

    it("should route non-AskUserQuestion tool_use to onToolUse", async () => {
      const mockHandler = createMockEventHandler();

      const toolUseEvent = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-456",
              name: "Read",
              input: { path: "/test/file.txt" }
            }
          ]
        },
        session_id: "abc123"
      });

      const mockProc = {
        pid: 12345,
        stdin: {
          write: mock(() => 0),
          flush: mock(() => {}),
          end: mock(() => {})
        },
        stdout: createMockStream([
          new TextEncoder().encode(`${toolUseEvent}\n`)
        ]),
        stderr: createMockStream(),
        exited: Promise.resolve(0),
        exitCode: 0
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      await runJsonStreamSession({
        cwd: "/test/dir",
        prompt: "test",
        eventHandler: mockHandler
      });

      expect(mockHandler.onToolUse).toHaveBeenCalledWith("tool-456", "Read", {
        path: "/test/file.txt"
      });

      spawnSpy.mockRestore();
    });

    it("should parse and route result event with cost", async () => {
      const mockHandler = createMockEventHandler();

      const resultEvent = JSON.stringify({
        type: "result",
        subtype: "success",
        result: "Task completed",
        session_id: "abc123",
        total_cost_usd: 0.05
      });

      const mockProc = {
        pid: 12345,
        stdin: {
          write: mock(() => 0),
          flush: mock(() => {}),
          end: mock(() => {})
        },
        stdout: createMockStream([
          new TextEncoder().encode(`${resultEvent}\n`)
        ]),
        stderr: createMockStream(),
        exited: Promise.resolve(0),
        exitCode: 0
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      const result = await runJsonStreamSession({
        cwd: "/test/dir",
        prompt: "test",
        eventHandler: mockHandler
      });

      expect(mockHandler.onResult).toHaveBeenCalled();
      expect(result.totalCostUsd).toBe(0.05);

      spawnSpy.mockRestore();
    });

    it("should handle spawn failure and call onError", async () => {
      const mockHandler = createMockEventHandler();

      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
        throw new Error("Command not found");
      });

      const result = await runJsonStreamSession({
        cwd: "/test/dir",
        prompt: "test",
        eventHandler: mockHandler
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(-1);
      expect(result.error).toContain("Command not found");
      expect(mockHandler.onError).toHaveBeenCalled();

      spawnSpy.mockRestore();
    });

    it("should handle multiple events in sequence", async () => {
      const mockHandler = createMockEventHandler();

      const events = [
        JSON.stringify({
          type: "system",
          subtype: "init",
          session_id: "abc123",
          tools: ["Read"],
          model: "claude-3-opus"
        }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Starting task..." }] },
          session_id: "abc123"
        }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Done!" }] },
          session_id: "abc123"
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "Completed",
          session_id: "abc123",
          total_cost_usd: 0.03
        })
      ];

      const mockProc = {
        pid: 12345,
        stdin: {
          write: mock(() => 0),
          flush: mock(() => {}),
          end: mock(() => {})
        },
        stdout: createMockStream([
          new TextEncoder().encode(`${events.join("\n")}\n`)
        ]),
        stderr: createMockStream(),
        exited: Promise.resolve(0),
        exitCode: 0
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      await runJsonStreamSession({
        cwd: "/test/dir",
        prompt: "test",
        eventHandler: mockHandler
      });

      expect(mockHandler.onInit).toHaveBeenCalledTimes(1);
      expect(mockHandler.onText).toHaveBeenCalledTimes(2);
      expect(mockHandler.onResult).toHaveBeenCalledTimes(1);

      spawnSpy.mockRestore();
    });

    it("should skip unparseable lines gracefully", async () => {
      const mockHandler = createMockEventHandler();

      const content = [
        "not valid json",
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Valid event" }] },
          session_id: "abc123"
        }),
        "another invalid line"
      ].join("\n");

      const mockProc = {
        pid: 12345,
        stdin: {
          write: mock(() => 0),
          flush: mock(() => {}),
          end: mock(() => {})
        },
        stdout: createMockStream([new TextEncoder().encode(`${content}\n`)]),
        stderr: createMockStream(),
        exited: Promise.resolve(0),
        exitCode: 0
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      const result = await runJsonStreamSession({
        cwd: "/test/dir",
        prompt: "test",
        eventHandler: mockHandler
      });

      expect(result.success).toBe(true);
      expect(mockHandler.onText).toHaveBeenCalledWith("Valid event");

      spawnSpy.mockRestore();
    });
  });
});
