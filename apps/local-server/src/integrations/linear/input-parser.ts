import type { LinearIssueRefList } from "./types.ts";

const LINEAR_REF_PATTERN = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/;
const LINEAR_REF_IN_TEXT_PATTERN = /\b([A-Za-z][A-Za-z0-9]*-\d+)\b/;

export const parseLinearIssueInput = (input: string): LinearIssueRefList => {
  const refs = new Set<string>();

  for (const part of splitInput(input)) {
    for (const ref of expandInputPart(part)) {
      refs.add(ref);
    }
  }

  return { refs: [...refs] };
};

const splitInput = (input: string): string[] =>
  input
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const expandInputPart = (part: string): string[] => {
  if (part.includes("..")) {
    return expandRange(part);
  }

  return [extractRef(part)];
};

const expandRange = (part: string): string[] => {
  const [startRaw, endRaw, ...extra] = part.split("..");
  if (!startRaw || !endRaw || extra.length > 0) {
    throw new Error(`Invalid Linear issue range: ${part}`);
  }

  const start = parseRef(extractRef(startRaw));
  const end = parseRef(extractRef(endRaw));

  if (start.prefix !== end.prefix) {
    throw new Error("Linear issue range must stay within one team prefix");
  }

  if (start.number > end.number) {
    throw new Error("Linear issue range must be ascending");
  }

  return Array.from({ length: end.number - start.number + 1 }, (_, index) =>
    formatRef(start.prefix, start.number + index),
  );
};

const extractRef = (value: string): string => {
  const match = value.match(LINEAR_REF_IN_TEXT_PATTERN);
  if (!match?.[1]) {
    throw new Error(`Invalid Linear issue reference: ${value}`);
  }

  const parsed = parseRef(match[1]);
  return formatRef(parsed.prefix, parsed.number);
};

const parseRef = (value: string): { prefix: string; number: number } => {
  const match = value.match(LINEAR_REF_PATTERN);
  if (!match?.[1] || !match[2]) {
    throw new Error(`Invalid Linear issue reference: ${value}`);
  }

  return {
    prefix: match[1].toUpperCase(),
    number: Number.parseInt(match[2], 10),
  };
};

const formatRef = (prefix: string, number: number): string => `${prefix}-${number}`;
