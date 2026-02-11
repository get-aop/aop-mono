import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  extractAssistantSignalTextFromRawJsonl,
  inferRunOutcomeFromRawJsonl,
  parseRawJsonlContent,
  renderCompactLogLines,
} from "./index";

const OPENCODE_FIXTURE_PATH = new URL("./fixtures/opencode.jsonl", import.meta.url);
const readOpenCodeFixture = () => readFileSync(OPENCODE_FIXTURE_PATH, "utf-8");

describe("logs parser", () => {
  test("parses multiline json and ignores non-json lines", () => {
    const content = [
      "not-json",
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}',
      "{",
      '  "type": "result",',
      '  "subtype": "success",',
      '  "result": "done"',
      "}",
    ].join("\n");

    const parsed = parseRawJsonlContent(content);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.ignoredLineCount).toBe(1);
    expect(parsed.hasTrailingPartial).toBe(false);
  });

  test("flags trailing partial json entry", () => {
    const parsed = parseRawJsonlContent('{"type":"assistant"\n');
    expect(parsed.entries).toHaveLength(0);
    expect(parsed.hasTrailingPartial).toBe(true);
  });
});

describe("logs renderer", () => {
  test("renders compact tool lines from real opencode logs", () => {
    const parsed = parseRawJsonlContent(readOpenCodeFixture());
    const lines = renderCompactLogLines(parsed, { timestamp: "2026-01-01T00:00:00.000Z" });
    expect(lines.map((line) => line.content)).toEqual([
      '[Bash] openspec status --change "cli-greeting-command5" --json - Get OpenSpec status JSON for change',
      '[Bash] openspec instructions apply --change "cli-greeting-command5" --json - Get OpenSpec apply instructions JSON',
    ]);
  });

  test("suppresses token/cost noise from assistant text", () => {
    const content = JSON.stringify({
      type: "text",
      part: { text: "Working\nTokens: 210\nCost: 0.01\nDone" },
    });
    const lines = renderCompactLogLines(parseRawJsonlContent(content), {
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(lines.map((line) => line.content)).toEqual(["Working", "Done"]);
  });
});

describe("logs extraction and inference", () => {
  test("extracts signal text from opencode text events", () => {
    const content = JSON.stringify({
      type: "text",
      part: { text: "Finished <aop>ALL_TASKS_DONE</aop>" },
    });

    const extracted = extractAssistantSignalTextFromRawJsonl(content, {
      requireCompleteLine: true,
    });
    expect(extracted.isComplete).toBe(true);
    expect(extracted.text).toContain("<aop>ALL_TASKS_DONE</aop>");
  });

  test("blocks signal extraction when trailing line is partial", () => {
    const extracted = extractAssistantSignalTextFromRawJsonl(
      '{"type":"text","part":{"text":"<aop>ALL_TASKS_DONE</aop>"',
      { requireCompleteLine: true },
    );

    expect(extracted.isComplete).toBe(false);
    expect(extracted.text).toBe("");
  });

  test("infers explicit success/failure outcomes", () => {
    const success = inferRunOutcomeFromRawJsonl(
      JSON.stringify({ type: "result", subtype: "success", result: "ok" }),
    );
    const failure = inferRunOutcomeFromRawJsonl(
      JSON.stringify({ type: "result", subtype: "error", result: "bad" }),
    );

    expect(success.outcome).toBe("success");
    expect(failure.outcome).toBe("failure");
  });

  test("infers implicit success for parsable stream without result", () => {
    const content = [
      JSON.stringify({
        type: "tool_use",
        part: { tool: "bash", state: { input: { command: "ls" } } },
      }),
      JSON.stringify({ type: "text", part: { text: "done" } }),
    ].join("\n");

    const inferred = inferRunOutcomeFromRawJsonl(content);
    expect(inferred.outcome).toBe("success");
    expect(inferred.reason).toBe("implicit-success-stream");
  });

  test("infers failure from explicit error marker", () => {
    const content = JSON.stringify({ type: "event", level: "error", error: "boom" });
    const inferred = inferRunOutcomeFromRawJsonl(content);
    expect(inferred.outcome).toBe("failure");
  });

  test("returns unknown when trailing partial line exists", () => {
    const content = [
      JSON.stringify({ type: "text", part: { text: "ok" } }),
      '{"type":"text","part":',
    ].join("\n");

    const inferred = inferRunOutcomeFromRawJsonl(content, { requireCompleteLine: true });
    expect(inferred.outcome).toBe("unknown");
    expect(inferred.reason).toBe("trailing-partial-json-line");
  });
});
