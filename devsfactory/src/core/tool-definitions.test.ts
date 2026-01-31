import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestIOHandler } from "./interactive-io-handler";
import {
  AskUserInputSchema,
  BashInputSchema,
  createToolExecutor,
  GlobInputSchema,
  GrepInputSchema,
  ReadFileInputSchema,
  toolDefinitions,
  WriteFileInputSchema
} from "./tool-definitions";

describe("tool-definitions schemas", () => {
  describe("AskUserInputSchema", () => {
    it("should accept valid input with question only", () => {
      const result = AskUserInputSchema.safeParse({
        question: "What is your name?"
      });
      expect(result.success).toBe(true);
    });

    it("should accept input with options", () => {
      const result = AskUserInputSchema.safeParse({
        question: "Choose one",
        options: [
          { label: "A", description: "Option A" },
          { label: "B", description: "Option B" }
        ]
      });
      expect(result.success).toBe(true);
    });

    it("should accept input with multiSelect and header", () => {
      const result = AskUserInputSchema.safeParse({
        question: "Select colors",
        multiSelect: true,
        header: "Colors"
      });
      expect(result.success).toBe(true);
    });

    it("should reject missing question", () => {
      const result = AskUserInputSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("ReadFileInputSchema", () => {
    it("should accept valid path", () => {
      const result = ReadFileInputSchema.safeParse({
        path: "/path/to/file.txt"
      });
      expect(result.success).toBe(true);
    });

    it("should accept path with offset and limit", () => {
      const result = ReadFileInputSchema.safeParse({
        path: "/file.txt",
        offset: 10,
        limit: 50
      });
      expect(result.success).toBe(true);
    });

    it("should reject missing path", () => {
      const result = ReadFileInputSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("WriteFileInputSchema", () => {
    it("should accept valid path and content", () => {
      const result = WriteFileInputSchema.safeParse({
        path: "/output.txt",
        content: "Hello World"
      });
      expect(result.success).toBe(true);
    });

    it("should reject missing content", () => {
      const result = WriteFileInputSchema.safeParse({
        path: "/output.txt"
      });
      expect(result.success).toBe(false);
    });
  });

  describe("BashInputSchema", () => {
    it("should accept command", () => {
      const result = BashInputSchema.safeParse({
        command: "ls -la"
      });
      expect(result.success).toBe(true);
    });

    it("should accept command with timeout", () => {
      const result = BashInputSchema.safeParse({
        command: "sleep 5",
        timeout: 10000
      });
      expect(result.success).toBe(true);
    });
  });

  describe("GlobInputSchema", () => {
    it("should accept pattern", () => {
      const result = GlobInputSchema.safeParse({
        pattern: "**/*.ts"
      });
      expect(result.success).toBe(true);
    });

    it("should accept pattern with path", () => {
      const result = GlobInputSchema.safeParse({
        pattern: "*.js",
        path: "/src"
      });
      expect(result.success).toBe(true);
    });
  });

  describe("GrepInputSchema", () => {
    it("should accept pattern", () => {
      const result = GrepInputSchema.safeParse({
        pattern: "TODO"
      });
      expect(result.success).toBe(true);
    });

    it("should accept pattern with path and include", () => {
      const result = GrepInputSchema.safeParse({
        pattern: "function",
        path: "/src",
        include: "*.ts"
      });
      expect(result.success).toBe(true);
    });
  });
});

describe("toolDefinitions", () => {
  it("should have all required tools defined", () => {
    const toolNames = toolDefinitions.map((t) => t.name);

    expect(toolNames).toContain("ask_user");
    expect(toolNames).toContain("read_file");
    expect(toolNames).toContain("write_file");
    expect(toolNames).toContain("bash");
    expect(toolNames).toContain("glob");
    expect(toolNames).toContain("grep");
  });

  it("should have valid input schemas for all tools", () => {
    for (const tool of toolDefinitions) {
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe("object");
      expect(tool.input_schema.properties).toBeDefined();
    }
  });
});

describe("createToolExecutor", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `tool-test-${Date.now()}`);
    await Bun.write(join(tempDir, "placeholder"), "");
  });

  afterEach(async () => {
    try {
      const proc = Bun.spawn(["rm", "-rf", tempDir]);
      await proc.exited;
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("ask_user", () => {
    it("should call ioHandler.askUser with question", async () => {
      const ioHandler = createTestIOHandler();
      ioHandler.mockResponses.push("User answer");

      const executor = createToolExecutor({
        cwd: tempDir,
        ioHandler
      });

      const result = await executor("ask_user", {
        question: "What is your name?"
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe("User answer");
    });

    it("should return error for invalid input", async () => {
      const ioHandler = createTestIOHandler();
      const executor = createToolExecutor({ cwd: tempDir, ioHandler });

      const result = await executor("ask_user", { invalid: true });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid");
    });
  });

  describe("read_file", () => {
    it("should read existing file", async () => {
      const testFile = join(tempDir, "test.txt");
      await Bun.write(testFile, "Line 1\nLine 2\nLine 3");

      const ioHandler = createTestIOHandler();
      const executor = createToolExecutor({ cwd: tempDir, ioHandler });

      const result = await executor("read_file", { path: testFile });

      expect(result.success).toBe(true);
      expect(result.output).toContain("Line 1");
      expect(result.output).toContain("Line 2");
      expect(result.output).toContain("Line 3");
    });

    it("should respect offset and limit", async () => {
      const testFile = join(tempDir, "test.txt");
      await Bun.write(testFile, "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");

      const ioHandler = createTestIOHandler();
      const executor = createToolExecutor({ cwd: tempDir, ioHandler });

      const result = await executor("read_file", {
        path: testFile,
        offset: 2,
        limit: 2
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain("Line 2");
      expect(result.output).toContain("Line 3");
      expect(result.output).not.toContain("Line 1");
      expect(result.output).not.toContain("Line 4");
    });

    it("should return error for non-existent file", async () => {
      const ioHandler = createTestIOHandler();
      const executor = createToolExecutor({ cwd: tempDir, ioHandler });

      const result = await executor("read_file", {
        path: "/nonexistent/file.txt"
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("write_file", () => {
    it("should write content to file", async () => {
      const testFile = join(tempDir, "output.txt");

      const ioHandler = createTestIOHandler();
      const executor = createToolExecutor({ cwd: tempDir, ioHandler });

      const result = await executor("write_file", {
        path: testFile,
        content: "Test content"
      });

      expect(result.success).toBe(true);

      const content = await Bun.file(testFile).text();
      expect(content).toBe("Test content");
    });
  });

  describe("bash", () => {
    it("should execute command and return output", async () => {
      const ioHandler = createTestIOHandler();
      const executor = createToolExecutor({ cwd: tempDir, ioHandler });

      const result = await executor("bash", { command: "echo hello" });

      expect(result.success).toBe(true);
      expect(result.output).toContain("hello");
    });

    it("should return error for failed command", async () => {
      const ioHandler = createTestIOHandler();
      const executor = createToolExecutor({ cwd: tempDir, ioHandler });

      const result = await executor("bash", { command: "exit 1" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("exited with code");
    });

    it("should capture stderr", async () => {
      const ioHandler = createTestIOHandler();
      const executor = createToolExecutor({ cwd: tempDir, ioHandler });

      const result = await executor("bash", {
        command: "echo error >&2"
      });

      expect(result.output).toContain("error");
    });
  });

  describe("glob", () => {
    it("should find matching files", async () => {
      await Bun.write(join(tempDir, "file1.ts"), "");
      await Bun.write(join(tempDir, "file2.ts"), "");
      await Bun.write(join(tempDir, "file3.js"), "");

      const ioHandler = createTestIOHandler();
      const executor = createToolExecutor({ cwd: tempDir, ioHandler });

      const result = await executor("glob", { pattern: "*.ts" });

      expect(result.success).toBe(true);
      expect(result.output).toContain("file1.ts");
      expect(result.output).toContain("file2.ts");
      expect(result.output).not.toContain("file3.js");
    });

    it("should return message when no matches", async () => {
      const ioHandler = createTestIOHandler();
      const executor = createToolExecutor({ cwd: tempDir, ioHandler });

      const result = await executor("glob", { pattern: "*.xyz" });

      expect(result.success).toBe(true);
      expect(result.output).toContain("No matches");
    });
  });

  describe("grep", () => {
    it("should find pattern in files", async () => {
      await Bun.write(join(tempDir, "test.txt"), "Hello World\nGoodbye World");

      const ioHandler = createTestIOHandler();
      const executor = createToolExecutor({ cwd: tempDir, ioHandler });

      const result = await executor("grep", {
        pattern: "Hello",
        path: tempDir
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain("Hello");
    });

    it("should return no matches message when not found", async () => {
      await Bun.write(join(tempDir, "test.txt"), "Hello World");

      const ioHandler = createTestIOHandler();
      const executor = createToolExecutor({ cwd: tempDir, ioHandler });

      const result = await executor("grep", {
        pattern: "NotFound",
        path: tempDir
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain("No matches");
    });
  });

  describe("unknown tool", () => {
    it("should return error for unknown tool", async () => {
      const ioHandler = createTestIOHandler();
      const executor = createToolExecutor({ cwd: tempDir, ioHandler });

      const result = await executor("unknown_tool", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown tool");
    });
  });
});
