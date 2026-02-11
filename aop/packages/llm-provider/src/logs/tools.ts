import type { RawProviderEvent } from "./types";

type ToolFormatter = (input: Record<string, unknown>) => string;

const TOOL_NAME_MAP: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
  glob: "Glob",
  grep: "Grep",
  skill: "Skill",
  task: "Task",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  question: "Question",
};

const toolFormatters: Record<string, ToolFormatter> = {
  Bash: (i) => String(i.command ?? i.cmd ?? ""),
  Read: (i) => String(i.file_path ?? i.path ?? ""),
  Write: (i) => String(i.file_path ?? i.path ?? ""),
  Edit: (i) => String(i.file_path ?? i.path ?? ""),
  Glob: (i) => `${i.pattern ?? ""}${i.path ? ` in ${i.path}` : ""}`,
  Grep: (i) => `${i.pattern ?? ""}${i.path ? ` in ${i.path}` : ""}`,
  Skill: (i) => `${i.skill ?? ""}${i.args ? ` ${i.args}` : ""}`,
  Task: (i) => String(i.description ?? i.title ?? ""),
  WebFetch: (i) => String(i.url ?? ""),
  WebSearch: (i) => String(i.query ?? ""),
  Question: (i) => String(i.header ?? i.question ?? ""),
};

const sanitizeWhitespace = (value: string): string => {
  return value.replace(/\s+/g, " ").trim();
};

const truncate = (value: string, max = 180): string => {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
};

const stringValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return "{}";
    return `{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", …" : ""}}`;
  }
  return "";
};

const summarizeUnknownInput = (input: Record<string, unknown>): string => {
  try {
    return JSON.stringify(input);
  } catch {
    const keys = Object.keys(input);
    if (keys.length === 0) return "";
    const fields = keys.slice(0, 3).map((key) => `${key}=${stringValue(input[key])}`);
    const extra = keys.length > 3 ? ` +${keys.length - 3} keys` : "";
    return `${fields.join(" ")}${extra}`.trim();
  }
};

const normalizeNameForLookup = (name: string): string => {
  return TOOL_NAME_MAP[name.toLowerCase()] ?? name;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

const findTextByKeys = (
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
    const nested = asRecord(nestedValue);
    if (Object.keys(nested).length === 0) continue;
    const found = findTextByKeys(nested, keys, depth - 1);
    if (found) return found;
  }

  return undefined;
};

export const normalizeToolName = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) return "Tool";

  const mapped = TOOL_NAME_MAP[trimmed.toLowerCase()];
  if (mapped) return mapped;

  return `${trimmed.slice(0, 1).toUpperCase()}${trimmed.slice(1)}`;
};

export const summarizeToolArguments = (
  name: string,
  input: Record<string, unknown>,
  maxLength = 180,
): string => {
  const normalizedName = normalizeNameForLookup(normalizeToolName(name));
  const formatter = toolFormatters[normalizedName];
  const formatted = formatter ? formatter(input) : summarizeUnknownInput(input);
  return truncate(sanitizeWhitespace(formatted), maxLength);
};

export const extractToolDescription = (
  ...sources: Array<Record<string, unknown> | undefined>
): string | undefined => {
  for (const source of sources) {
    if (!source) continue;
    const exact = findTextByKeys(source, ["description", "title"], 2);
    if (exact) {
      return truncate(sanitizeWhitespace(exact), 140);
    }
  }

  for (const source of sources) {
    if (!source) continue;
    const fallback = findTextByKeys(source, ["summary", "reason", "goal"], 1);
    if (fallback) {
      return truncate(sanitizeWhitespace(fallback), 140);
    }
  }

  return undefined;
};

export const formatToolInput = (name: string, input: Record<string, unknown>): string => {
  return summarizeToolArguments(name, input, 200);
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object" && !Array.isArray(value);
};

export const getOpenCodeToolContext = (
  event: RawProviderEvent,
): {
  toolName: string;
  input: Record<string, unknown>;
  description?: string;
  status?: string;
  message?: string;
} | null => {
  if (event.type !== "tool_use" || !isRecord(event.part)) return null;

  const part = event.part;
  const state = isRecord(part.state) ? part.state : {};
  const input = isRecord(state.input) ? state.input : {};

  return {
    toolName: typeof part.tool === "string" ? part.tool : "Tool",
    input,
    description: extractToolDescription(input, state),
    status: typeof state.status === "string" ? state.status : undefined,
    message:
      typeof state.error === "string"
        ? state.error
        : typeof state.message === "string"
          ? state.message
          : undefined,
  };
};

export interface CursorToolContext {
  toolName: string;
  input: Record<string, unknown>;
}

const parseCursorFunctionArgs = (value: unknown): Record<string, unknown> => {
  if (!value) return {};
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : { arguments: value };
  } catch {
    return { arguments: value };
  }
};

export const getCursorToolContext = (event: RawProviderEvent): CursorToolContext | null => {
  if (event.type !== "tool_call" || !isRecord(event.tool_call)) return null;

  const toolCall = event.tool_call;
  const fileToolCandidates: Array<{ name: string; key: string }> = [
    { name: "Read", key: "readToolCall" },
    { name: "Write", key: "writeToolCall" },
    { name: "Edit", key: "editToolCall" },
  ];

  for (const candidate of fileToolCandidates) {
    const raw = toolCall[candidate.key];
    if (!isRecord(raw)) continue;
    const args = asRecord(raw.args);
    return {
      toolName: candidate.name,
      input: { file_path: args.path ?? args.file_path ?? "" },
    };
  }

  const fn = asRecord(toolCall.function);
  if (Object.keys(fn).length === 0) return null;

  const toolName = typeof fn.name === "string" ? fn.name : "Tool";
  return {
    toolName,
    input: parseCursorFunctionArgs(fn.arguments),
  };
};
