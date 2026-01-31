import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  createTerminalIOHandler,
  createTestIOHandler
} from "./interactive-io-handler";

describe("createTestIOHandler", () => {
  it("should collect text outputs", () => {
    const handler = createTestIOHandler();

    handler.writeText("Hello ");
    handler.writeText("World!");

    expect(handler.outputs).toEqual(["Hello ", "World!"]);
  });

  it("should collect tool uses", () => {
    const handler = createTestIOHandler();

    handler.writeToolUse("read_file", { path: "/test.txt" });
    handler.writeToolUse("bash", { command: "ls" });

    expect(handler.toolUses).toEqual([
      { name: "read_file", input: { path: "/test.txt" } },
      { name: "bash", input: { command: "ls" } }
    ]);
  });

  it("should collect status messages", () => {
    const handler = createTestIOHandler();

    handler.writeStatus("Starting", "info");
    handler.writeStatus("Done", "success");
    handler.writeStatus("Warning!", "warning");
    handler.writeStatus("Failed", "error");

    expect(handler.statuses).toEqual([
      { message: "Starting", type: "info" },
      { message: "Done", type: "success" },
      { message: "Warning!", type: "warning" },
      { message: "Failed", type: "error" }
    ]);
  });

  it("should return mock responses for askUser", async () => {
    const handler = createTestIOHandler();
    handler.mockResponses.push("Response 1", "Response 2");

    const r1 = await handler.askUser("Question 1?");
    const r2 = await handler.askUser("Question 2?");
    const r3 = await handler.askUser("Question 3?");

    expect(r1).toBe("Response 1");
    expect(r2).toBe("Response 2");
    expect(r3).toBe("");
  });

  it("should have no-op close method", () => {
    const handler = createTestIOHandler();
    expect(() => handler.close()).not.toThrow();
  });
});

describe("createTerminalIOHandler", () => {
  let originalStdoutWrite: typeof process.stdout.write;
  let originalConsoleLog: typeof console.log;
  let writtenOutput: string[];
  let consoleOutput: string[];

  beforeEach(() => {
    originalStdoutWrite = process.stdout.write;
    originalConsoleLog = console.log;
    writtenOutput = [];
    consoleOutput = [];

    process.stdout.write = mock((data: string) => {
      writtenOutput.push(data);
      return true;
    }) as any;

    console.log = mock((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    }) as any;
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    console.log = originalConsoleLog;
  });

  describe("writeText", () => {
    it("should write to stdout", () => {
      const handler = createTerminalIOHandler();
      handler.writeText("Hello World");

      expect(writtenOutput).toEqual(["Hello World"]);
    });

    it("should not write when silent", () => {
      const handler = createTerminalIOHandler({ silent: true });
      handler.writeText("Hello World");

      expect(writtenOutput).toEqual([]);
    });
  });

  describe("writeToolUse", () => {
    it("should format read_file tool", () => {
      const handler = createTerminalIOHandler();
      handler.writeToolUse("read_file", { path: "/test/file.txt" });

      expect(consoleOutput.some((line) => line.includes("Reading"))).toBe(true);
      expect(
        consoleOutput.some((line) => line.includes("/test/file.txt"))
      ).toBe(true);
    });

    it("should format write_file tool", () => {
      const handler = createTerminalIOHandler();
      handler.writeToolUse("write_file", { path: "/output.txt" });

      expect(consoleOutput.some((line) => line.includes("Writing"))).toBe(true);
    });

    it("should format bash tool with truncation", () => {
      const handler = createTerminalIOHandler();
      const longCommand = "a".repeat(100);
      handler.writeToolUse("bash", { command: longCommand });

      expect(consoleOutput.some((line) => line.includes("Running"))).toBe(true);
      expect(consoleOutput.some((line) => line.includes("..."))).toBe(true);
    });

    it("should format glob tool", () => {
      const handler = createTerminalIOHandler();
      handler.writeToolUse("glob", { pattern: "**/*.ts" });

      expect(consoleOutput.some((line) => line.includes("Searching"))).toBe(
        true
      );
    });

    it("should format grep tool", () => {
      const handler = createTerminalIOHandler();
      handler.writeToolUse("grep", { pattern: "TODO" });

      expect(consoleOutput.some((line) => line.includes("Grep"))).toBe(true);
    });

    it("should not show ask_user tool", () => {
      const handler = createTerminalIOHandler();
      handler.writeToolUse("ask_user", { question: "Test?" });

      expect(consoleOutput.length).toBe(0);
    });

    it("should not write when showToolUse is false", () => {
      const handler = createTerminalIOHandler({ showToolUse: false });
      handler.writeToolUse("read_file", { path: "/test.txt" });

      expect(consoleOutput.length).toBe(0);
    });

    it("should not write when silent", () => {
      const handler = createTerminalIOHandler({ silent: true });
      handler.writeToolUse("read_file", { path: "/test.txt" });

      expect(consoleOutput.length).toBe(0);
    });

    it("should handle unknown tools", () => {
      const handler = createTerminalIOHandler();
      handler.writeToolUse("custom_tool", { data: "test" });

      expect(consoleOutput.some((line) => line.includes("custom_tool"))).toBe(
        true
      );
    });
  });

  describe("writeStatus", () => {
    it("should write info status", () => {
      const handler = createTerminalIOHandler();
      handler.writeStatus("Processing...", "info");

      expect(consoleOutput.some((line) => line.includes("●"))).toBe(true);
      expect(consoleOutput.some((line) => line.includes("Processing..."))).toBe(
        true
      );
    });

    it("should write success status", () => {
      const handler = createTerminalIOHandler();
      handler.writeStatus("Done!", "success");

      expect(consoleOutput.some((line) => line.includes("✓"))).toBe(true);
    });

    it("should write warning status", () => {
      const handler = createTerminalIOHandler();
      handler.writeStatus("Caution", "warning");

      expect(consoleOutput.some((line) => line.includes("⚠"))).toBe(true);
    });

    it("should write error status", () => {
      const handler = createTerminalIOHandler();
      handler.writeStatus("Failed", "error");

      expect(consoleOutput.some((line) => line.includes("✗"))).toBe(true);
    });

    it("should not write when silent", () => {
      const handler = createTerminalIOHandler({ silent: true });
      handler.writeStatus("Message", "info");

      expect(consoleOutput.length).toBe(0);
    });
  });

  describe("close", () => {
    it("should not throw when called multiple times", () => {
      const handler = createTerminalIOHandler();
      expect(() => handler.close()).not.toThrow();
      expect(() => handler.close()).not.toThrow();
    });
  });
});
