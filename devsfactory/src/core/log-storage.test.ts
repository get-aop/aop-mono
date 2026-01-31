import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanupTestDir, createTestDir } from "../test-helpers";
import { LogStorage } from "./log-storage";

describe("LogStorage", () => {
  let storage: LogStorage;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTestDir("log-storage");
    storage = new LogStorage(tempDir);
  });

  afterEach(async () => {
    await cleanupTestDir(tempDir);
  });

  describe("getLogPath", () => {
    test("returns correct path for subtask", () => {
      const path = storage.getLogPath("my-task", "001-first-subtask.md");
      expect(path).toBe(
        join(tempDir, ".devsfactory/my-task/logs/001-first-subtask.log")
      );
    });

    test("handles subtask file without .md extension", () => {
      const path = storage.getLogPath("my-task", "001-first-subtask");
      expect(path).toBe(
        join(tempDir, ".devsfactory/my-task/logs/001-first-subtask.log")
      );
    });

    test("handles task folder with special characters", () => {
      const path = storage.getLogPath(
        "task-with-dashes-and-numbers-123",
        "002-subtask.md"
      );
      expect(path).toBe(
        join(
          tempDir,
          ".devsfactory/task-with-dashes-and-numbers-123/logs/002-subtask.log"
        )
      );
    });
  });

  describe("append", () => {
    test("creates log file and appends line", async () => {
      await storage.append("my-task", "001-subtask.md", "first log line");

      const logPath = storage.getLogPath("my-task", "001-subtask.md");
      const content = await Bun.file(logPath).text();
      expect(content).toBe("first log line\n");
    });

    test("appends multiple lines to same file", async () => {
      await storage.append("my-task", "001-subtask.md", "line 1");
      await storage.append("my-task", "001-subtask.md", "line 2");
      await storage.append("my-task", "001-subtask.md", "line 3");

      const logPath = storage.getLogPath("my-task", "001-subtask.md");
      const content = await Bun.file(logPath).text();
      expect(content).toBe("line 1\nline 2\nline 3\n");
    });

    test("creates separate log files for different subtasks", async () => {
      await storage.append("my-task", "001-first.md", "first subtask log");
      await storage.append("my-task", "002-second.md", "second subtask log");

      const path1 = storage.getLogPath("my-task", "001-first.md");
      const path2 = storage.getLogPath("my-task", "002-second.md");

      const content1 = await Bun.file(path1).text();
      const content2 = await Bun.file(path2).text();

      expect(content1).toBe("first subtask log\n");
      expect(content2).toBe("second subtask log\n");
    });

    test("creates parent directories if they don't exist", async () => {
      await storage.append("create-task", "001-subtask.md", "log line");

      const logPath = storage.getLogPath("create-task", "001-subtask.md");
      const exists = await Bun.file(logPath).exists();
      expect(exists).toBe(true);
    });
  });

  describe("read", () => {
    test("returns empty array for non-existent log file", async () => {
      const lines = await storage.read("non-existent", "001-subtask.md");
      expect(lines).toEqual([]);
    });

    test("reads single line from log file", async () => {
      await storage.append("my-task", "001-subtask.md", "single line");

      const lines = await storage.read("my-task", "001-subtask.md");
      expect(lines).toEqual(["single line"]);
    });

    test("reads multiple lines from log file", async () => {
      await storage.append("my-task", "001-subtask.md", "line 1");
      await storage.append("my-task", "001-subtask.md", "line 2");
      await storage.append("my-task", "001-subtask.md", "line 3");

      const lines = await storage.read("my-task", "001-subtask.md");
      expect(lines).toEqual(["line 1", "line 2", "line 3"]);
    });

    test("preserves empty lines in logs", async () => {
      const logPath = storage.getLogPath("my-task", "001-subtask.md");
      await Bun.$`mkdir -p ${join(tempDir, ".devsfactory/my-task/logs")}`;
      await Bun.write(logPath, "line 1\n\nline 3\n");

      const lines = await storage.read("my-task", "001-subtask.md");
      expect(lines).toEqual(["line 1", "", "line 3"]);
    });

    test("handles log file with no trailing newline", async () => {
      const logPath = storage.getLogPath("my-task", "001-subtask.md");
      await Bun.$`mkdir -p ${join(tempDir, ".devsfactory/my-task/logs")}`;
      await Bun.write(logPath, "line 1\nline 2");

      const lines = await storage.read("my-task", "001-subtask.md");
      expect(lines).toEqual(["line 1", "line 2"]);
    });
  });
});
