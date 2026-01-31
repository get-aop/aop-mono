import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  AskUserQuestionInput,
  ClaudeInitEvent,
  ClaudeResultEvent
} from "./claude-events";
import {
  createCliEventHandler,
  createCliIOHandler,
  type ReadlineProvider
} from "./cli-io-handler";

describe("createCliIOHandler", () => {
  let originalStdoutWrite: typeof process.stdout.write;
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    originalStdoutWrite = process.stdout.write;
    originalStderrWrite = process.stderr.write;
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  });

  it("should write output to stdout", () => {
    const writtenData: Uint8Array[] = [];
    process.stdout.write = mock((data: Uint8Array) => {
      writtenData.push(data);
      return true;
    }) as any;

    const handler = createCliIOHandler();
    const testData = new Uint8Array([72, 101, 108, 108, 111]);

    handler.onOutput(testData);

    expect(writtenData).toEqual([testData]);
  });

  it("should write errors to stderr", () => {
    const writtenData: Uint8Array[] = [];
    process.stderr.write = mock((data: Uint8Array) => {
      writtenData.push(data);
      return true;
    }) as any;

    const handler = createCliIOHandler();
    const testData = new Uint8Array([69, 114, 114, 111, 114]);

    handler.onError(testData);

    expect(writtenData).toEqual([testData]);
  });

  it("should return a ReadableStream from getInput", () => {
    const handler = createCliIOHandler();
    const input = handler.getInput();

    expect(input).toBeInstanceOf(ReadableStream);
  });
});

describe("createCliEventHandler", () => {
  let originalStdoutWrite: typeof process.stdout.write;
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let consoleOutput: string[];

  beforeEach(() => {
    originalStdoutWrite = process.stdout.write;
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    consoleOutput = [];

    console.log = mock((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    }) as any;

    console.error = mock((...args: unknown[]) => {
      consoleOutput.push(`[error] ${args.map(String).join(" ")}`);
    }) as any;
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  const createMockReadlineProvider = (
    responses: string[]
  ): ReadlineProvider => {
    let index = 0;
    return {
      question: mock(async (_prompt: string) => {
        return responses[index++] ?? "";
      }),
      close: mock(() => {})
    };
  };

  describe("onInit", () => {
    it("should not output when showInit is false", () => {
      const handler = createCliEventHandler({ showInit: false });
      const event: ClaudeInitEvent = {
        type: "system",
        subtype: "init",
        session_id: "abc123",
        tools: ["Read"],
        model: "claude-3-opus"
      };

      handler.onInit(event);

      expect(consoleOutput).toEqual([]);
    });

    it("should output session info when showInit is true", () => {
      const handler = createCliEventHandler({ showInit: true });
      const event: ClaudeInitEvent = {
        type: "system",
        subtype: "init",
        session_id: "abc123",
        tools: ["Read"],
        model: "claude-3-opus"
      };

      handler.onInit(event);

      expect(consoleOutput).toContain("Session: abc123");
      expect(consoleOutput).toContain("Model: claude-3-opus");
    });
  });

  describe("onText", () => {
    it("should write text to stdout", () => {
      const writtenData: string[] = [];
      process.stdout.write = mock((data: string) => {
        writtenData.push(data);
        return true;
      }) as any;

      const handler = createCliEventHandler();
      handler.onText("Hello, world!");

      expect(writtenData).toEqual(["Hello, world!"]);
    });

    it("should not write when silent is true", () => {
      const writtenData: string[] = [];
      process.stdout.write = mock((data: string) => {
        writtenData.push(data);
        return true;
      }) as any;

      const handler = createCliEventHandler({ silent: true });
      handler.onText("Hello, world!");

      expect(writtenData).toEqual([]);
    });
  });

  describe("onAskQuestion", () => {
    it("should return selected option for single select", async () => {
      const mockRl = createMockReadlineProvider(["1"]);
      const handler = createCliEventHandler({}, mockRl);

      const input: AskUserQuestionInput = {
        questions: [
          {
            question: "What is your favorite color?",
            header: "Color",
            options: [
              { label: "Blue", description: "A calming color" },
              { label: "Red", description: "An energetic color" }
            ],
            multiSelect: false
          }
        ]
      };

      const result = await handler.onAskQuestion("tool-123", input);
      const parsed = JSON.parse(result);

      expect(parsed.answers.Color).toBe("Blue");
    });

    it("should return custom input for 'Other' option", async () => {
      const mockRl = createMockReadlineProvider(["3", "Purple"]);
      const handler = createCliEventHandler({}, mockRl);

      const input: AskUserQuestionInput = {
        questions: [
          {
            question: "What is your favorite color?",
            header: "Color",
            options: [
              { label: "Blue", description: "A calming color" },
              { label: "Red", description: "An energetic color" }
            ],
            multiSelect: false
          }
        ]
      };

      const result = await handler.onAskQuestion("tool-123", input);
      const parsed = JSON.parse(result);

      expect(parsed.answers.Color).toBe("Purple");
    });

    it("should return multiple selections for multiSelect", async () => {
      const mockRl = createMockReadlineProvider(["1,2"]);
      const handler = createCliEventHandler({}, mockRl);

      const input: AskUserQuestionInput = {
        questions: [
          {
            question: "What colors do you like?",
            header: "Colors",
            options: [
              { label: "Blue", description: "A calming color" },
              { label: "Red", description: "An energetic color" }
            ],
            multiSelect: true
          }
        ]
      };

      const result = await handler.onAskQuestion("tool-123", input);
      const parsed = JSON.parse(result);

      expect(parsed.answers.Colors).toBe("Blue, Red");
    });

    it("should handle multiple questions", async () => {
      const mockRl = createMockReadlineProvider(["1", "2"]);
      const handler = createCliEventHandler({}, mockRl);

      const input: AskUserQuestionInput = {
        questions: [
          {
            question: "What is your favorite color?",
            header: "Color",
            options: [
              { label: "Blue", description: "A calming color" },
              { label: "Red", description: "An energetic color" }
            ],
            multiSelect: false
          },
          {
            question: "What is your favorite animal?",
            header: "Animal",
            options: [
              { label: "Cat", description: "A fluffy pet" },
              { label: "Dog", description: "A loyal companion" }
            ],
            multiSelect: false
          }
        ]
      };

      const result = await handler.onAskQuestion("tool-123", input);
      const parsed = JSON.parse(result);

      expect(parsed.answers.Color).toBe("Blue");
      expect(parsed.answers.Animal).toBe("Dog");
    });

    it("should reprompt for invalid selection", async () => {
      const mockRl = createMockReadlineProvider(["invalid", "5", "1"]);
      const handler = createCliEventHandler({}, mockRl);

      const input: AskUserQuestionInput = {
        questions: [
          {
            question: "Choose one?",
            header: "Choice",
            options: [
              { label: "Option A", description: "First option" },
              { label: "Option B", description: "Second option" }
            ],
            multiSelect: false
          }
        ]
      };

      const result = await handler.onAskQuestion("tool-123", input);
      const parsed = JSON.parse(result);

      expect(parsed.answers.Choice).toBe("Option A");
      expect(mockRl.question).toHaveBeenCalledTimes(3);
    });
  });

  describe("onToolUse", () => {
    it("should not output when showToolUse is false", () => {
      const handler = createCliEventHandler({ showToolUse: false });

      handler.onToolUse("tool-123", "Read", { path: "/test" });

      expect(consoleOutput).toEqual([]);
    });

    it("should output tool name when showToolUse is true", () => {
      const handler = createCliEventHandler({ showToolUse: true });

      handler.onToolUse("tool-123", "Read", { path: "/test" });

      expect(consoleOutput.some((line) => line.includes("[Tool: Read]"))).toBe(
        true
      );
    });
  });

  describe("onResult", () => {
    it("should display success message", () => {
      const handler = createCliEventHandler({});

      const event: ClaudeResultEvent = {
        type: "result",
        subtype: "success",
        result: "Done",
        session_id: "abc123",
        total_cost_usd: 0.05
      };

      handler.onResult(event);

      expect(
        consoleOutput.some((line) => line.includes("completed successfully"))
      ).toBe(true);
      expect(consoleOutput.some((line) => line.includes("$0.0500"))).toBe(true);
    });

    it("should display error message", () => {
      const handler = createCliEventHandler({});

      const event: ClaudeResultEvent = {
        type: "result",
        subtype: "error",
        result: "Something went wrong",
        session_id: "abc123",
        total_cost_usd: 0
      };

      handler.onResult(event);

      expect(consoleOutput.some((line) => line.includes("error"))).toBe(true);
    });

    it("should not display cost when zero", () => {
      const handler = createCliEventHandler({});

      const event: ClaudeResultEvent = {
        type: "result",
        subtype: "success",
        result: "Done",
        session_id: "abc123",
        total_cost_usd: 0
      };

      handler.onResult(event);

      expect(consoleOutput.some((line) => line.includes("Cost:"))).toBe(false);
    });

    it("should not display when silent", () => {
      const handler = createCliEventHandler({ silent: true });

      const event: ClaudeResultEvent = {
        type: "result",
        subtype: "success",
        result: "Done",
        session_id: "abc123",
        total_cost_usd: 0.05
      };

      handler.onResult(event);

      expect(
        consoleOutput.filter((line) => !line.startsWith("[error]"))
      ).toEqual([]);
    });
  });

  describe("onError", () => {
    it("should display error message", () => {
      const handler = createCliEventHandler({});

      handler.onError(new Error("Test error"));

      expect(consoleOutput.some((line) => line.includes("Test error"))).toBe(
        true
      );
    });

    it("should not display when silent", () => {
      const handler = createCliEventHandler({ silent: true });

      handler.onError(new Error("Test error"));

      expect(
        consoleOutput.filter((line) => !line.startsWith("[error]"))
      ).toEqual([]);
    });
  });
});
