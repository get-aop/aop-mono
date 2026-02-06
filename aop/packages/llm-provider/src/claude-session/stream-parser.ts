import { getLogger } from "@aop/infra";
import type {
  AssistantEvent,
  ResultEvent,
  StreamEvent,
  StreamEventType,
  SystemEvent,
  ToolResultEvent,
  ToolUseEvent,
} from "./types";

const logger = getLogger("claude-session", "stream-parser");

const VALID_TYPES: Set<StreamEventType> = new Set([
  "assistant",
  "tool_use",
  "tool_result",
  "system",
  "result",
]);

export const parseLine = (line: string): StreamEvent | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const data = JSON.parse(trimmed) as Record<string, unknown>;
    return discriminateEvent(data);
  } catch (err) {
    logger.warn("Failed to parse stream line: {error}", { error: String(err) });
    return null;
  }
};

const discriminateEvent = (data: Record<string, unknown>): StreamEvent | null => {
  const type = data.type;
  if (typeof type !== "string" || !VALID_TYPES.has(type as StreamEventType)) {
    return null;
  }

  switch (type) {
    case "assistant":
      return parseAssistantEvent(data);
    case "tool_use":
      return parseToolUseEvent(data);
    case "tool_result":
      return parseToolResultEvent(data);
    case "system":
      return parseSystemEvent(data);
    case "result":
      return parseResultEvent(data);
    default:
      return null;
  }
};

const isTextBlock = (item: unknown): item is { type: string; text: string } =>
  item !== null &&
  typeof item === "object" &&
  (item as Record<string, unknown>).type === "text" &&
  typeof (item as Record<string, unknown>).text === "string";

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

const isToolUseBlock = (item: unknown): item is ToolUseBlock =>
  item !== null &&
  typeof item === "object" &&
  (item as Record<string, unknown>).type === "tool_use" &&
  typeof (item as Record<string, unknown>).name === "string" &&
  typeof (item as Record<string, unknown>).id === "string";

const extractTextContent = (content: unknown): string | null => {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const textParts = content.filter(isTextBlock).map((item) => item.text);
    return textParts.length > 0 ? textParts.join("") : null;
  }
  return null;
};

const extractToolUseFromContent = (content: unknown): ToolUseBlock | null => {
  if (!Array.isArray(content)) return null;
  const toolUse = content.find(isToolUseBlock);
  return toolUse ?? null;
};

const parseAssistantEvent = (
  data: Record<string, unknown>,
): AssistantEvent | ToolUseEvent | null => {
  const message = data.message as Record<string, unknown> | undefined;
  if (!message) return null;

  const toolUse = extractToolUseFromContent(message.content);
  if (toolUse) {
    return {
      type: "tool_use",
      session_id: typeof data.session_id === "string" ? data.session_id : undefined,
      tool_use: {
        name: toolUse.name,
        id: toolUse.id,
        input: toolUse.input,
      },
    };
  }

  const textContent = extractTextContent(message.content);
  if (textContent === null) return null;

  return {
    type: "assistant",
    session_id: typeof data.session_id === "string" ? data.session_id : undefined,
    message: { content: textContent },
  };
};

const parseToolUseEvent = (data: Record<string, unknown>): ToolUseEvent | null => {
  const toolUse = data.tool_use as Record<string, unknown> | undefined;
  if (!toolUse || typeof toolUse.name !== "string" || typeof toolUse.id !== "string") {
    return null;
  }

  return {
    type: "tool_use",
    session_id: typeof data.session_id === "string" ? data.session_id : undefined,
    tool_use: {
      name: toolUse.name,
      id: toolUse.id,
      input: toolUse.input,
    },
  };
};

const parseToolResultEvent = (data: Record<string, unknown>): ToolResultEvent | null => {
  const toolResult = data.tool_result as Record<string, unknown> | undefined;
  if (!toolResult || typeof toolResult.tool_use_id !== "string") return null;

  return {
    type: "tool_result",
    session_id: typeof data.session_id === "string" ? data.session_id : undefined,
    tool_result: {
      tool_use_id: toolResult.tool_use_id,
      content: typeof toolResult.content === "string" ? toolResult.content : "",
    },
  };
};

const parseSystemEvent = (data: Record<string, unknown>): SystemEvent => ({
  type: "system",
  session_id: typeof data.session_id === "string" ? data.session_id : undefined,
  message: typeof data.message === "string" ? data.message : undefined,
  subtype: typeof data.subtype === "string" ? data.subtype : undefined,
});

const parseResultEvent = (data: Record<string, unknown>): ResultEvent => ({
  type: "result",
  session_id: typeof data.session_id === "string" ? data.session_id : undefined,
  result: typeof data.result === "string" ? data.result : undefined,
  cost_usd: typeof data.cost_usd === "number" ? data.cost_usd : undefined,
  duration_ms: typeof data.duration_ms === "number" ? data.duration_ms : undefined,
  num_turns: typeof data.num_turns === "number" ? data.num_turns : undefined,
});

export interface StreamParserState {
  buffer: string;
  sessionId?: string;
}

export const createParserState = (): StreamParserState => ({
  buffer: "",
  sessionId: undefined,
});

export const processChunk = (
  chunk: string,
  state: StreamParserState,
): { events: StreamEvent[]; sessionId?: string } => {
  state.buffer += chunk;
  const lines = state.buffer.split("\n");
  state.buffer = lines.pop() ?? "";

  const events: StreamEvent[] = [];
  for (const line of lines) {
    const event = parseLine(line);
    if (event) {
      events.push(event);
      if (event.session_id) {
        state.sessionId = event.session_id;
      }
    }
  }

  return { events, sessionId: state.sessionId };
};

export const flushBuffer = (state: StreamParserState): StreamEvent[] => {
  if (!state.buffer.trim()) return [];

  const event = parseLine(state.buffer);
  state.buffer = "";
  return event ? [event] : [];
};
