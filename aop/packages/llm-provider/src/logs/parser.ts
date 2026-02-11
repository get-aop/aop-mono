import type { LogProvider, ParsedRawJsonl, ParsedRawLogEntry, RawProviderEvent } from "./types";

const isPotentialJsonStart = (line: string): boolean => {
  return line.startsWith("{") || line.startsWith("[");
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object" && !Array.isArray(value);
};

const detectProvider = (event: RawProviderEvent): LogProvider => {
  if ("part" in event) return "opencode";
  if (event.type === "tool_call" || "tool_call" in event) return "cursor-cli";

  const type = typeof event.type === "string" ? event.type : "";
  if (["assistant", "tool_use", "tool_result", "result", "system", "user"].includes(type)) {
    return "claude-code";
  }

  return "unknown";
};

const parseCandidate = (candidate: string): RawProviderEvent | null => {
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return isObjectRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const parseRawJsonlContent = (content: string): ParsedRawJsonl => {
  const entries: ParsedRawLogEntry[] = [];
  let ignoredLineCount = 0;
  let entryIndex = 0;
  let buffer = "";

  for (const rawLine of content.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const candidate = buffer ? `${buffer}\n${trimmed}` : trimmed;
    const parsed = parseCandidate(candidate);
    if (parsed) {
      entries.push({
        index: entryIndex,
        raw: candidate,
        event: parsed,
        provider: detectProvider(parsed),
      });
      entryIndex += 1;
      buffer = "";
      continue;
    }

    if (buffer || isPotentialJsonStart(trimmed)) {
      buffer = candidate;
      continue;
    }

    ignoredLineCount += 1;
  }

  return {
    entries,
    ignoredLineCount,
    hasTrailingPartial: buffer.trim().length > 0,
  };
};
