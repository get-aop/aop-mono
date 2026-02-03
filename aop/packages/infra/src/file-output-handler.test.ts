import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileOutputHandler } from "./file-output-handler";

describe("createFileOutputHandler", () => {
  let tempDir: string;
  let logFile: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "file-output-handler-test-"));
    logFile = join(tempDir, "output.jsonl");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("writes JSON line to file", () => {
    const handler = createFileOutputHandler({ logFile });

    handler({ type: "text", content: "hello" });

    const content = readFileSync(logFile, "utf-8");
    expect(content).toBe('{"type":"text","content":"hello"}\n');
  });

  test("appends multiple messages to file", () => {
    const handler = createFileOutputHandler({ logFile });

    handler({ type: "text", content: "first" });
    handler({ type: "text", content: "second" });

    const content = readFileSync(logFile, "utf-8");
    expect(content).toBe('{"type":"text","content":"first"}\n{"type":"text","content":"second"}\n');
  });

  test("calls onOutput callback if provided", () => {
    const calls: Array<Record<string, unknown>> = [];
    const handler = createFileOutputHandler({
      logFile,
      onOutput: (data) => calls.push(data),
    });

    handler({ type: "text", content: "hello" });
    handler({ type: "result", subtype: "success" });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ type: "text", content: "hello" });
    expect(calls[1]).toEqual({ type: "result", subtype: "success" });
  });

  test("writes to file even without onOutput callback", () => {
    const handler = createFileOutputHandler({ logFile });

    handler({ session_id: "sess_123" });

    expect(existsSync(logFile)).toBe(true);
    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("sess_123");
  });

  test("preserves all fields in JSON output", () => {
    const handler = createFileOutputHandler({ logFile });

    const data = {
      type: "assistant",
      session_id: "sess_abc",
      message: { content: [{ type: "text", text: "hello" }] },
      nested: { deep: { value: 123 } },
    };
    handler(data);

    const content = readFileSync(logFile, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed).toEqual(data);
  });

  test("uses rawLine directly when provided", () => {
    const handler = createFileOutputHandler({ logFile });
    const rawLine = '{"type":"text","content":"raw"}';

    handler({ type: "text", content: "parsed" }, rawLine);

    const content = readFileSync(logFile, "utf-8");
    expect(content).toBe(`${rawLine}\n`);
  });

  test("passes rawLine to onOutput callback", () => {
    const calls: Array<{ data: Record<string, unknown>; rawLine: string | undefined }> = [];
    const handler = createFileOutputHandler({
      logFile,
      onOutput: (data, rawLine) => calls.push({ data, rawLine }),
    });
    const rawLine = '{"type":"text"}';

    handler({ type: "text" }, rawLine);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.rawLine).toBe(rawLine);
  });
});
