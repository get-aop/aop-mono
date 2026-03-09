import {
  extractToolDescription,
  formatToolInput,
  getCursorToolContext,
  getOpenCodeToolContext,
  normalizeToolName,
} from "./tools";
import type { NormalizedLogEvent, ParsedRawLogEntry, RawProviderEvent } from "./types";

interface ContentBlock {
  type: string;
  text?: string;
}

interface AssistantMessage {
  content?: ContentBlock[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object" && !Array.isArray(value);
};

const findNestedText = (
  source: Record<string, unknown>,
  keys: string[],
  depth: number,
): string | undefined => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  if (depth <= 0) return undefined;

  for (const nestedValue of Object.values(source)) {
    if (!isRecord(nestedValue)) continue;
    const found = findNestedText(nestedValue, keys, depth - 1);
    if (found) return found;
  }

  return undefined;
};

const toTextLines = (text: string): string[] => {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

const extractClaudeAssistantText = (event: RawProviderEvent): string[] => {
  if (event.type !== "assistant") return [];

  const message = event.message;
  if (typeof message === "string") return toTextLines(message);
  if (!isRecord(message)) return [];

  const assistant = message as AssistantMessage;
  return (assistant.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .flatMap((block) => toTextLines(block.text ?? ""));
};

const normalizeResultEvent = (
  provider: ParsedRawLogEntry["provider"],
  event: RawProviderEvent,
): NormalizedLogEvent[] => {
  if (event.type !== "result") return [];

  const subtype = typeof event.subtype === "string" ? event.subtype.toLowerCase() : "";
  const text = typeof event.result === "string" ? event.result : "";

  if (subtype === "success") {
    return [{ kind: "result_success", provider, text: text || undefined }];
  }

  if (subtype === "error" || subtype === "failure") {
    return [{ kind: "result_error", provider, text: text || "Unknown error" }];
  }

  return [];
};

const normalizeClaudeEvent = (entry: ParsedRawLogEntry): NormalizedLogEvent[] => {
  const { event, provider } = entry;

  const resultEvents = normalizeResultEvent(provider, event);
  if (resultEvents.length > 0) return resultEvents;

  if (event.type === "tool_use") {
    const toolName = normalizeToolName(String(event.tool_name ?? event.name ?? "Tool"));
    const input = isRecord(event.input) ? event.input : {};
    return [
      {
        kind: "tool_started",
        provider,
        toolName,
        primaryInput: formatToolInput(toolName, input),
        description: extractToolDescription(input),
      },
    ];
  }

  if (event.type === "result" && typeof event.result === "string") {
    return [{ kind: "result_success", provider, text: event.result }];
  }

  const textLines = extractClaudeAssistantText(event);
  if (textLines.length > 0) {
    return textLines.map((text) => ({ kind: "assistant_text", provider, text }));
  }

  return [{ kind: "noise", provider, reason: "claude-unhandled" }];
};

const OPEN_CODE_SUCCESS_STATUSES = ["completed", "complete", "done", "success"];
const OPEN_CODE_FAILURE_STATUSES = ["error", "failed", "failure"];

const normalizeOpenCodeToolEvent = (
  provider: ParsedRawLogEntry["provider"],
  tool: NonNullable<ReturnType<typeof getOpenCodeToolContext>>,
): NormalizedLogEvent[] => {
  const toolName = normalizeToolName(tool.toolName);
  const status = tool.status?.toLowerCase();

  if (status && OPEN_CODE_SUCCESS_STATUSES.includes(status)) {
    return [
      {
        kind: "tool_started",
        provider,
        toolName,
        primaryInput: formatToolInput(toolName, tool.input),
        description: tool.description,
      },
    ];
  }

  if (status && OPEN_CODE_FAILURE_STATUSES.includes(status)) {
    return [
      {
        kind: "tool_completed",
        provider,
        toolName,
        success: false,
        message: tool.message ?? `${toolName} failed`,
      },
    ];
  }

  return [
    {
      kind: "tool_started",
      provider,
      toolName,
      primaryInput: formatToolInput(toolName, tool.input),
      description: tool.description,
    },
  ];
};

const normalizeOpenCodeEvent = (entry: ParsedRawLogEntry): NormalizedLogEvent[] => {
  const { event, provider } = entry;

  if (event.type === "text" && isRecord(event.part) && typeof event.part.text === "string") {
    return toTextLines(event.part.text).map((text) => ({ kind: "assistant_text", provider, text }));
  }

  const tool = getOpenCodeToolContext(event);
  if (tool) return normalizeOpenCodeToolEvent(provider, tool);

  const resultEvents = normalizeResultEvent(provider, event);
  if (resultEvents.length > 0) return resultEvents;

  return [{ kind: "noise", provider, reason: "opencode-unhandled" }];
};

const normalizeCursorEvent = (entry: ParsedRawLogEntry): NormalizedLogEvent[] => {
  const { event, provider } = entry;

  const resultEvents = normalizeResultEvent(provider, event);
  if (resultEvents.length > 0) return resultEvents;

  const textLines = extractClaudeAssistantText(event);
  if (textLines.length > 0) {
    return textLines.map((text) => ({ kind: "assistant_text", provider, text }));
  }

  const tool = getCursorToolContext(event);
  if (tool) {
    const toolName = normalizeToolName(tool.toolName);
    if (event.subtype === "completed") {
      return [{ kind: "tool_completed", provider, toolName, success: true }];
    }

    return [
      {
        kind: "tool_started",
        provider,
        toolName,
        primaryInput: formatToolInput(toolName, tool.input),
        description: extractToolDescription(tool.input),
      },
    ];
  }

  return [{ kind: "noise", provider, reason: "cursor-unhandled" }];
};

export const normalizeRawEvent = (entry: ParsedRawLogEntry): NormalizedLogEvent[] => {
  if (isFailureMarker(entry.event)) {
    return [
      {
        kind: "error",
        provider: entry.provider,
        text: failureMessage(entry.event),
      },
    ];
  }

  switch (entry.provider) {
    case "opencode":
      return normalizeOpenCodeEvent(entry);
    case "cursor-cli":
      return normalizeCursorEvent(entry);
    case "claude-code":
      return normalizeClaudeEvent(entry);
    default:
      return normalizeClaudeEvent(entry);
  }
};

export const normalizeRawEvents = (entries: ParsedRawLogEntry[]): NormalizedLogEvent[] => {
  return entries.flatMap((entry) => normalizeRawEvent(entry));
};

export const extractAssistantTextFromRawEvent = (event: RawProviderEvent): string => {
  if (event.type === "text" && isRecord(event.part) && typeof event.part.text === "string") {
    return event.part.text;
  }

  if (event.type === "result" && event.subtype === "success") {
    return typeof event.result === "string" ? event.result : "";
  }

  if (event.type !== "assistant") return "";

  const message = event.message;
  if (typeof message === "string") return message;
  if (!isRecord(message)) return "";

  const assistant = message as AssistantMessage;
  return (assistant.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
};

const isOneOf = (value: string, candidates: string[]): boolean => {
  return candidates.includes(value);
};

const hasFailureSubtype = (value: unknown): boolean => {
  return isOneOf(String(value ?? "").toLowerCase(), ["error", "failure", "failed"]);
};

const hasTopLevelFailure = (event: RawProviderEvent): boolean => {
  const type = String(event.type ?? "").toLowerCase();
  if (isOneOf(type, ["error", "fatal"])) return true;
  if (String(event.level ?? "").toLowerCase() === "error") return true;
  if (hasFailureSubtype(event.subtype)) return true;
  return hasFailureSubtype(event.status);
};

const hasToolUseFailure = (event: RawProviderEvent): boolean => {
  if (event.type !== "tool_use" || !isRecord(event.part) || !isRecord(event.part.state)) {
    return false;
  }

  return hasFailureSubtype(event.part.state.status) || event.part.state.error !== undefined;
};

export const isFailureMarker = (event: RawProviderEvent): boolean => {
  return hasTopLevelFailure(event) || hasToolUseFailure(event) || event.error !== undefined;
};

const failureMessage = (event: RawProviderEvent): string => {
  const candidates = [event.result, event.error, event.message];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  const nested = findNestedText(event, ["error", "message", "result", "reason"], 3);
  if (nested) {
    return nested;
  }

  return "Unknown error";
};
