import { normalizeRawEvents } from "./normalize";
import type {
  NormalizedLogEvent,
  ParsedRawJsonl,
  ParsedRawLogEntry,
  RenderedLogLine,
} from "./types";

interface RenderOptions {
  timestamp?: string;
}

const NOISE_TEXT_PATTERNS = [/^step\s+\d+\s*\/\s*\d+\b/i, /^tokens?\b/i, /^cost\b/i, /^usage\b/i];

const isNoiseText = (line: string): boolean => {
  return NOISE_TEXT_PATTERNS.some((pattern) => pattern.test(line.trim()));
};

const splitReadableLines = (text: string): string[] => {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !isNoiseText(line));
};

const renderToolStart = (event: Extract<NormalizedLogEvent, { kind: "tool_started" }>): string => {
  const base = `[${event.toolName}]${event.primaryInput ? ` ${event.primaryInput}` : ""}`;
  if (!event.description) return base;
  if (base.includes(event.description)) return base;
  return `${base} - ${event.description}`;
};

const renderToolCompleted = (
  event: Extract<NormalizedLogEvent, { kind: "tool_completed" }>,
): RenderedLogLine => {
  const status = event.success ? "completed" : "failed";
  const message = event.message ? ` - ${event.message}` : "";
  return {
    stream: event.success ? "stdout" : "stderr",
    content: `[${event.toolName}] ${status}${message}`,
    timestamp: new Date().toISOString(),
  };
};

const renderNormalizedEvent = (
  event: NormalizedLogEvent,
  defaultTimestamp: string,
): RenderedLogLine[] => {
  switch (event.kind) {
    case "assistant_text":
      return splitReadableLines(event.text).map((content) => ({
        stream: "stdout",
        content,
        timestamp: defaultTimestamp,
      }));

    case "tool_started":
      return [
        {
          stream: "stdout",
          content: renderToolStart(event),
          timestamp: defaultTimestamp,
        },
      ];

    case "tool_completed": {
      const completed = renderToolCompleted(event);
      completed.timestamp = defaultTimestamp;
      return [completed];
    }

    case "result_success":
      if (!event.text) return [];
      return splitReadableLines(event.text).map((content) => ({
        stream: "stdout",
        content,
        timestamp: defaultTimestamp,
      }));

    case "result_error":
      return [
        {
          stream: "stderr",
          content: event.text,
          timestamp: defaultTimestamp,
        },
      ];

    case "error":
      return [
        {
          stream: "stderr",
          content: event.text,
          timestamp: defaultTimestamp,
        },
      ];

    case "noise":
      return [];

    default:
      return [];
  }
};

const resolveEntries = (input: ParsedRawJsonl | ParsedRawLogEntry[]): ParsedRawLogEntry[] => {
  return Array.isArray(input) ? input : input.entries;
};

export const renderCompactLogLines = (
  input: ParsedRawJsonl | ParsedRawLogEntry[],
  options: RenderOptions = {},
): RenderedLogLine[] => {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const normalized = normalizeRawEvents(resolveEntries(input));
  return normalized.flatMap((event) => renderNormalizedEvent(event, timestamp));
};
