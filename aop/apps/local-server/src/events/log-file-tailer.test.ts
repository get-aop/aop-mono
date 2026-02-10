import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFileSize, readLogLines } from "./log-file-tailer.ts";

describe("log-file-tailer", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `log-tailer-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  const writeJsonl = (filename: string, entries: Record<string, unknown>[]): string => {
    const path = join(testDir, filename);
    writeFileSync(path, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`);
    return path;
  };

  describe("readLogLines", () => {
    it("returns empty for non-existent file", () => {
      const result = readLogLines("/nonexistent/file.jsonl");
      expect(result.lines).toEqual([]);
      expect(result.lineCount).toBe(0);
    });

    it("parses assistant text messages", () => {
      const logFile = writeJsonl("test.jsonl", [
        { type: "assistant", message: { content: [{ type: "text", text: "Hello world" }] } },
      ]);

      const result = readLogLines(logFile);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]?.content).toBe("Hello world");
      expect(result.lines[0]?.stream).toBe("stdout");
      expect(result.lineCount).toBe(1);
    });

    it("parses tool_use entries", () => {
      const logFile = writeJsonl("test.jsonl", [
        { type: "tool_use", tool_name: "Bash", input: { command: "ls -la" } },
      ]);

      const result = readLogLines(logFile);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]?.content).toBe("[Bash] ls -la");
      expect(result.lines[0]?.stream).toBe("stdout");
    });

    it("parses Cursor assistant stream-json messages", () => {
      const logFile = writeJsonl("test.jsonl", [
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Cursor says hello" }],
          },
        },
      ]);

      const result = readLogLines(logFile);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]?.content).toBe("Cursor says hello");
      expect(result.lines[0]?.stream).toBe("stdout");
    });

    it("parses Cursor tool_call started events", () => {
      const logFile = writeJsonl("test.jsonl", [
        {
          type: "tool_call",
          subtype: "started",
          tool_call: {
            readToolCall: { args: { path: "/foo/bar.ts" } },
          },
        },
      ]);

      const result = readLogLines(logFile);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]?.content).toBe("[Read] /foo/bar.ts");
      expect(result.lines[0]?.stream).toBe("stdout");
    });

    it("parses Cursor tool_call completed events", () => {
      const logFile = writeJsonl("test.jsonl", [
        {
          type: "tool_call",
          subtype: "completed",
          tool_call: {
            readToolCall: {
              args: { path: "/foo/bar.ts" },
              result: { success: { content: "file contents" } },
            },
          },
        },
      ]);

      const result = readLogLines(logFile);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]?.content).toBe("[Read] completed");
      expect(result.lines[0]?.stream).toBe("stdout");
    });

    it("parses Cursor function tool_call arguments", () => {
      const logFile = writeJsonl("test.jsonl", [
        {
          type: "tool_call",
          subtype: "started",
          tool_call: {
            function: {
              name: "Bash",
              arguments: JSON.stringify({ command: "ls -la" }),
            },
          },
        },
      ]);

      const result = readLogLines(logFile);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]?.content).toBe("[Bash] ls -la");
      expect(result.lines[0]?.stream).toBe("stdout");
    });

    it("parses error results", () => {
      const logFile = writeJsonl("test.jsonl", [
        { type: "result", subtype: "error", result: "Something went wrong" },
      ]);

      const result = readLogLines(logFile);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]?.content).toBe("Something went wrong");
      expect(result.lines[0]?.stream).toBe("stderr");
    });

    it("skips non-producing entries", () => {
      const logFile = writeJsonl("test.jsonl", [
        { type: "system", message: "init" },
        { type: "result", subtype: "success", result: "done" },
      ]);

      const result = readLogLines(logFile);
      expect(result.lines).toEqual([]);
      expect(result.lineCount).toBe(0);
    });

    it("skips invalid JSON lines", () => {
      const path = join(testDir, "bad.jsonl");
      writeFileSync(
        path,
        'not json\n{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}\n',
      );

      const result = readLogLines(path);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]?.content).toBe("ok");
    });

    it("supports offset to skip lines", () => {
      const logFile = writeJsonl("test.jsonl", [
        { type: "assistant", message: { content: [{ type: "text", text: "line 1" }] } },
        { type: "assistant", message: { content: [{ type: "text", text: "line 2" }] } },
        { type: "assistant", message: { content: [{ type: "text", text: "line 3" }] } },
      ]);

      const result = readLogLines(logFile, 1);
      expect(result.lines).toHaveLength(2);
      expect(result.lines[0]?.content).toBe("line 2");
      expect(result.lines[1]?.content).toBe("line 3");
      expect(result.lineCount).toBe(3);
    });

    it("returns empty lines when offset exceeds total", () => {
      const logFile = writeJsonl("test.jsonl", [
        { type: "assistant", message: { content: [{ type: "text", text: "line 1" }] } },
      ]);

      const result = readLogLines(logFile, 10);
      expect(result.lines).toEqual([]);
      expect(result.lineCount).toBe(1);
    });

    it("handles multiple content types in sequence", () => {
      const logFile = writeJsonl("test.jsonl", [
        { type: "assistant", message: { content: [{ type: "text", text: "Starting" }] } },
        { type: "tool_use", tool_name: "Read", input: { file_path: "/foo/bar.ts" } },
        { type: "tool_result", result: "file contents..." },
        { type: "assistant", message: { content: [{ type: "text", text: "Done" }] } },
        { type: "result", subtype: "success", result: "ok" },
      ]);

      const result = readLogLines(logFile);
      expect(result.lines).toHaveLength(3);
      expect(result.lines[0]?.content).toBe("Starting");
      expect(result.lines[1]?.content).toBe("[Read] /foo/bar.ts");
      expect(result.lines[2]?.content).toBe("Done");
      expect(result.lineCount).toBe(3);
    });
  });

  describe("getFileSize", () => {
    it("returns 0 for non-existent file", () => {
      expect(getFileSize("/nonexistent/file.jsonl")).toBe(0);
    });

    it("returns file size for existing file", () => {
      const path = join(testDir, "sized.jsonl");
      writeFileSync(path, "hello\n");
      expect(getFileSize(path)).toBe(6);
    });
  });
});
