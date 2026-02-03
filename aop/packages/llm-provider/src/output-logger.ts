import { getLogger, type Logger, type OutputHandler } from "@aop/infra";

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AssistantMessage {
  content?: ContentBlock[];
}

type ToolFormatter = (input: Record<string, unknown>) => string;

const toolFormatters: Record<string, ToolFormatter> = {
  Bash: (i) => String(i.command ?? ""),
  Read: (i) => String(i.file_path ?? ""),
  Write: (i) => String(i.file_path ?? ""),
  Edit: (i) => String(i.file_path ?? ""),
  Glob: (i) => `${i.pattern ?? ""}${i.path ? ` in ${i.path}` : ""}`,
  Grep: (i) => `${i.pattern ?? ""}${i.path ? ` in ${i.path}` : ""}`,
  Skill: (i) => `${i.skill ?? ""}${i.args ? ` ${i.args}` : ""}`,
  Task: (i) => String(i.description ?? ""),
  WebFetch: (i) => String(i.url ?? ""),
  WebSearch: (i) => String(i.query ?? ""),
};

export const formatToolInput = (name: string, input: Record<string, unknown>): string => {
  const formatter = toolFormatters[name];
  return formatter ? formatter(input) : JSON.stringify(input).slice(0, 200);
};

const logTextLines = (log: Logger, text: string, iter?: number): void => {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) log.info("message: {line}", { iter, line: trimmed });
  }
};

const logContentBlock = (block: ContentBlock, log: Logger, iter?: number): void => {
  if (block.type === "text" && block.text) {
    logTextLines(log, block.text, iter);
  } else if (block.type === "tool_use") {
    const toolName = block.name ?? "unknown";
    const inputStr = block.input ? formatToolInput(toolName, block.input) : "";
    log.debug("tool: {tool} {input}", { iter, tool: toolName, input: inputStr });
  }
};

const logAssistantContent = (message: unknown, log: Logger, iter?: number): void => {
  if (message && typeof message === "object") {
    const am = message as AssistantMessage;
    for (const block of am.content ?? []) {
      logContentBlock(block, log, iter);
    }
  } else if (typeof message === "string") {
    logTextLines(log, message, iter);
  }
};

const handleAssistant = (data: Record<string, unknown>, log: Logger, iter?: number): void => {
  logAssistantContent(data.message, log, iter);
};

const handleToolUse = (data: Record<string, unknown>, log: Logger, iter?: number): void => {
  log.debug("tool: {name}", { iter, name: data.tool_name });
};

const handleToolResult = (data: Record<string, unknown>, log: Logger, iter?: number): void => {
  if (!data.result) return;
  const result = String(data.result);
  const preview = result.length > 100 ? `${result.slice(0, 100)}...` : result;
  log.debug("result: {preview}", { iter, preview });
};

const handleResult = (data: Record<string, unknown>, log: Logger, iter?: number): void => {
  if (data.subtype === "success") {
    log.info("session complete: {result}", { iter, result: data.result });
  } else if (data.subtype === "error") {
    log.error("error: {result}", { iter, result: data.result });
  }
};

const handleSystem = (data: Record<string, unknown>, log: Logger, iter?: number): void => {
  if (typeof data.message === "string") {
    log.debug("system: {msg}", { iter, msg: data.message });
  }
};

const handleUser = (data: Record<string, unknown>, log: Logger, iter?: number): void => {
  const message = data.message as { role?: string; content?: unknown[] } | undefined;
  if (message?.content && Array.isArray(message.content)) {
    const textContent = message.content
      .filter(
        (c): c is { type: string; text: string } =>
          typeof c === "object" && c !== null && (c as { type?: string }).type === "text",
      )
      .map((c) => c.text)
      .join("\n");
    if (textContent) {
      logTextLines(log, textContent, iter);
    }
  }
};

export interface OutputLoggerOptions {
  categories: string[];
  iter?: number;
  logger?: Logger;
}

export type { OutputHandler };

/**
 * Create an output handler that logs agent output using @aop/infra logger.
 */
export const createOutputLogger = (options: OutputLoggerOptions): OutputHandler => {
  const log = options.logger ?? getLogger(...options.categories);
  const iter = options.iter;

  const handlers: Record<string, (data: Record<string, unknown>) => void> = {
    assistant: (d) => handleAssistant(d, log, iter),
    tool_use: (d) => handleToolUse(d, log, iter),
    tool_result: (d) => handleToolResult(d, log, iter),
    result: (d) => handleResult(d, log, iter),
    system: (d) => handleSystem(d, log, iter),
    user: (d) => handleUser(d, log, iter),
  };

  return (data: Record<string, unknown>) => {
    const handler = handlers[data.type as string];
    if (handler) {
      handler(data);
    } else {
      log.warn("unhandled: {type} {data}", { iter, type: data.type, data });
    }
  };
};

/**
 * Extract text content from an assistant message.
 */
export const extractAssistantText = (data: Record<string, unknown>): string => {
  if (data.type !== "assistant") return "";
  const message = data.message;
  if (message && typeof message === "object") {
    const am = message as AssistantMessage;
    return (am.content ?? [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("\n");
  }
  if (typeof message === "string") return message;
  return "";
};
