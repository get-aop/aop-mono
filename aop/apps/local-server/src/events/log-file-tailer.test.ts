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

    it("returns raw JSON lines from file", () => {
      const entry = {
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello world" }] },
      };
      const logFile = writeJsonl("test.jsonl", [entry]);

      const result = readLogLines(logFile);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]).toBe(JSON.stringify(entry));
      expect(result.lineCount).toBe(1);
    });

    it("returns multiple raw lines", () => {
      const entries = [
        { type: "assistant", message: { content: [{ type: "text", text: "Starting" }] } },
        { type: "tool_use", tool_name: "Bash", input: { command: "ls -la" } },
        { type: "result", subtype: "success", result: "ok" },
      ];
      const logFile = writeJsonl("test.jsonl", entries);

      const result = readLogLines(logFile);
      expect(result.lines).toHaveLength(3);
      expect(result.lines[0]).toBe(JSON.stringify(entries[0]));
      expect(result.lines[1]).toBe(JSON.stringify(entries[1]));
      expect(result.lines[2]).toBe(JSON.stringify(entries[2]));
      expect(result.lineCount).toBe(3);
    });

    it("filters out empty lines", () => {
      const path = join(testDir, "sparse.jsonl");
      writeFileSync(path, '{"type":"assistant"}\n\n{"type":"result"}\n');

      const result = readLogLines(path);
      expect(result.lines).toHaveLength(2);
      expect(result.lines[0]).toBe('{"type":"assistant"}');
      expect(result.lines[1]).toBe('{"type":"result"}');
    });

    it("supports offset to skip lines", () => {
      const entries = [
        { type: "assistant", message: { content: [{ type: "text", text: "line 1" }] } },
        { type: "assistant", message: { content: [{ type: "text", text: "line 2" }] } },
        { type: "assistant", message: { content: [{ type: "text", text: "line 3" }] } },
      ];
      const logFile = writeJsonl("test.jsonl", entries);

      const result = readLogLines(logFile, 1);
      expect(result.lines).toHaveLength(2);
      expect(result.lines[0]).toBe(JSON.stringify(entries[1]));
      expect(result.lines[1]).toBe(JSON.stringify(entries[2]));
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

    it("preserves non-JSON lines as raw strings", () => {
      const path = join(testDir, "mixed.jsonl");
      writeFileSync(path, 'not json\n{"type":"assistant"}\n');

      const result = readLogLines(path);
      expect(result.lines).toHaveLength(2);
      expect(result.lines[0]).toBe("not json");
      expect(result.lines[1]).toBe('{"type":"assistant"}');
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
