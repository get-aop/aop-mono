import { existsSync, readFileSync, statSync } from "node:fs";
import { extractAssistantText, formatToolInput } from "@aop/llm-provider";
import type { LogLine } from "./log-buffer.ts";

export interface LogFileSnapshot {
  lines: LogLine[];
  lineCount: number;
}

export const readLogLines = (logFile: string, offset = 0): LogFileSnapshot => {
  if (!existsSync(logFile)) {
    return { lines: [], lineCount: 0 };
  }

  const content = readFileSync(logFile, "utf-8");
  const allLines = parseJsonlContent(content);
  const lines = offset > 0 ? allLines.slice(offset) : allLines;
  return { lines, lineCount: allLines.length };
};

export const getFileSize = (logFile: string): number => {
  try {
    return statSync(logFile).size;
  } catch {
    return 0;
  }
};

export const forEachJsonlEntry = (
  content: string,
  onEntry: (data: Record<string, unknown>) => void,
): void => {
  for (const raw of content.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const data = JSON.parse(trimmed) as Record<string, unknown>;
      onEntry(data);
    } catch {
      // skip non-JSON lines
    }
  }
};

export const parseJsonlContent = (content: string): LogLine[] => {
  const result: LogLine[] = [];
  forEachJsonlEntry(content, (data) => {
    for (const line of parseJsonlEntry(data)) {
      result.push(line);
    }
  });
  return result;
};

const parseOpenCodeEntry = (data: Record<string, unknown>): LogLine[] => {
  const lines: LogLine[] = [];
  const timestamp = new Date().toISOString();
  const part = data.part as Record<string, unknown> | undefined;
  if (!part) return lines;

  if (data.type === "text") {
    const text = part.text as string | undefined;
    if (text) lines.push({ stream: "stdout", content: text, timestamp });
  }

  if (data.type === "tool_use") {
    const toolName = (part.tool ?? "tool") as string;
    const state = part.state as Record<string, unknown> | undefined;
    const input = (state?.input ?? {}) as Record<string, unknown>;
    const formatted = formatToolInput(toolName, input);
    lines.push({ stream: "stdout", content: `[${toolName}] ${formatted}`, timestamp });
  }

  return lines;
};

interface ParsedCursorToolCall {
  name: string;
  input: Record<string, unknown>;
}

const parseCursorFileToolCall = (name: string, value: unknown): ParsedCursorToolCall | null => {
  if (!value || typeof value !== "object") return null;
  const args = ((value as Record<string, unknown>).args ?? {}) as Record<string, unknown>;
  return {
    name,
    input: { file_path: args.path ?? args.file_path ?? "" },
  };
};

const parseCursorFunctionArgs = (value: unknown): Record<string, unknown> => {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return { arguments: value };
  } catch {
    return { arguments: value };
  }
};

const parseCursorToolCall = (data: Record<string, unknown>): ParsedCursorToolCall | null => {
  const toolCall = data.tool_call as Record<string, unknown> | undefined;
  if (!toolCall) return null;

  const fileToolCall = [
    parseCursorFileToolCall("Read", toolCall.readToolCall),
    parseCursorFileToolCall("Write", toolCall.writeToolCall),
    parseCursorFileToolCall("Edit", toolCall.editToolCall),
  ].find((entry) => entry !== null);

  if (fileToolCall) return fileToolCall;

  const functionCall = toolCall.function as Record<string, unknown> | undefined;
  if (functionCall) {
    const rawName = functionCall.name;
    const name = typeof rawName === "string" ? rawName : "tool";
    return {
      name,
      input: parseCursorFunctionArgs(functionCall.arguments),
    };
  }

  return null;
};

const parseCursorToolCallEntry = (data: Record<string, unknown>): LogLine[] => {
  if (data.type !== "tool_call") return [];

  const parsedTool = parseCursorToolCall(data);
  if (!parsedTool) return [];

  const timestamp = new Date().toISOString();
  if (data.subtype === "completed") {
    return [{ stream: "stdout", content: `[${parsedTool.name}] completed`, timestamp }];
  }

  const formatted = formatToolInput(parsedTool.name, parsedTool.input);
  return [{ stream: "stdout", content: `[${parsedTool.name}] ${formatted}`, timestamp }];
};

export const parseJsonlEntry = (data: Record<string, unknown>): LogLine[] => {
  // OpenCode format: events have a `part` field with nested content
  if (data.part) return parseOpenCodeEntry(data);

  // Cursor stream-json format
  if (data.type === "tool_call") return parseCursorToolCallEntry(data);

  // Claude Code format
  const lines: LogLine[] = [];
  const timestamp = new Date().toISOString();

  const text = extractAssistantText(data);
  if (text) {
    lines.push({ stream: "stdout", content: text, timestamp });
  }

  if (data.type === "tool_use") {
    const toolName = (data.tool_name ?? data.name ?? "tool") as string;
    const input = (data.input ?? {}) as Record<string, unknown>;
    const formatted = formatToolInput(toolName, input);
    lines.push({ stream: "stdout", content: `[${toolName}] ${formatted}`, timestamp });
  }

  if (data.type === "result" && data.subtype === "error") {
    const errorMsg = String(data.result ?? "Unknown error");
    lines.push({ stream: "stderr", content: errorMsg, timestamp });
  }

  return lines;
};
