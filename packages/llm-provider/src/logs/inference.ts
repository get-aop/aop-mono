import { extractAssistantTextFromRawEvent, isFailureMarker } from "./normalize";
import { parseRawJsonlContent } from "./parser";
import type {
  AssistantSignalText,
  InferredRunOutcome,
  ParsedRawJsonl,
  ParsedRawLogEntry,
  RawProviderEvent,
} from "./types";

interface InferOutcomeOptions {
  requireCompleteLine?: boolean;
}

interface AssistantTextOptions {
  requireCompleteLine?: boolean;
}

const isExplicitSuccess = (event: RawProviderEvent): boolean => {
  if (event.type === "turn.completed") return true;
  if (event.type !== "result") return false;
  const subtype = String(event.subtype ?? event.status ?? "").toLowerCase();
  return subtype === "success" || subtype === "completed";
};

const isExplicitFailure = (event: RawProviderEvent): boolean => {
  if (event.type === "turn.failed" || event.type === "error") return true;
  if (event.type !== "result") return false;
  const subtype = String(event.subtype ?? event.status ?? "").toLowerCase();
  return subtype === "error" || subtype === "failure" || subtype === "failed";
};

const resolveEntries = (input: ParsedRawJsonl | ParsedRawLogEntry[]): ParsedRawLogEntry[] => {
  return Array.isArray(input) ? input : input.entries;
};

const hasTrailingPartial = (input: ParsedRawJsonl | ParsedRawLogEntry[]): boolean => {
  return Array.isArray(input) ? false : input.hasTrailingPartial;
};

const buildInferredOutcome = (
  outcome: InferredRunOutcome["outcome"],
  reason: InferredRunOutcome["reason"],
  sawEvents: boolean,
  hasTrailingPartial: boolean,
): InferredRunOutcome => {
  return {
    outcome,
    reason,
    sawEvents,
    hasTrailingPartial,
  };
};

const inferExplicitOutcome = (event: RawProviderEvent): InferredRunOutcome["outcome"] | null => {
  if (isExplicitSuccess(event)) return "success";
  if (isExplicitFailure(event)) return "failure";
  return null;
};

const scanEntriesForOutcomeSignals = (entries: ParsedRawLogEntry[]) => {
  let explicitOutcome: InferredRunOutcome["outcome"] | null = null;
  let sawFailureMarker = false;

  for (const entry of entries) {
    explicitOutcome = inferExplicitOutcome(entry.event) ?? explicitOutcome;
    sawFailureMarker = sawFailureMarker || isFailureMarker(entry.event);
  }

  return {
    explicitOutcome,
    sawFailureMarker,
  };
};

export const inferRunOutcomeFromEntries = (
  input: ParsedRawJsonl | ParsedRawLogEntry[],
  options: InferOutcomeOptions = {},
): InferredRunOutcome => {
  const entries = resolveEntries(input);
  const trailingPartial = hasTrailingPartial(input);
  const requireCompleteLine = options.requireCompleteLine ?? true;
  const sawEvents = entries.length > 0;

  if (requireCompleteLine && trailingPartial) {
    return buildInferredOutcome("unknown", "trailing-partial-json-line", sawEvents, true);
  }

  const { explicitOutcome, sawFailureMarker } = scanEntriesForOutcomeSignals(entries);

  if (explicitOutcome) {
    return buildInferredOutcome(
      explicitOutcome,
      "explicit-result-event",
      sawEvents,
      trailingPartial,
    );
  }

  if (sawFailureMarker) {
    return buildInferredOutcome("failure", "failure-marker", sawEvents, trailingPartial);
  }

  if (sawEvents) {
    return buildInferredOutcome("success", "implicit-success-stream", true, trailingPartial);
  }

  return buildInferredOutcome("unknown", "no-events", false, trailingPartial);
};

export const inferRunOutcomeFromRawJsonl = (
  content: string,
  options: InferOutcomeOptions = {},
): InferredRunOutcome => {
  const parsed = parseRawJsonlContent(content);
  return inferRunOutcomeFromEntries(parsed, options);
};

export const extractAssistantSignalTextFromEntries = (
  input: ParsedRawJsonl | ParsedRawLogEntry[],
  options: AssistantTextOptions = {},
): AssistantSignalText => {
  const entries = resolveEntries(input);
  const trailingPartial = hasTrailingPartial(input);
  const requireCompleteLine = options.requireCompleteLine ?? true;

  if (requireCompleteLine && trailingPartial) {
    return {
      text: "",
      isComplete: false,
      hasTrailingPartial: true,
    };
  }

  const text = entries
    .map((entry) => extractAssistantTextFromRawEvent(entry.event))
    .filter((value) => value.trim().length > 0)
    .join("\n");

  return {
    text,
    isComplete: true,
    hasTrailingPartial: trailingPartial,
  };
};

export const extractAssistantSignalTextFromRawJsonl = (
  content: string,
  options: AssistantTextOptions = {},
): AssistantSignalText => {
  const parsed = parseRawJsonlContent(content);
  return extractAssistantSignalTextFromEntries(parsed, options);
};
