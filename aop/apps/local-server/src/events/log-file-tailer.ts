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

export const parseJsonlEntry = (data: Record<string, unknown>): LogLine[] => {
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
