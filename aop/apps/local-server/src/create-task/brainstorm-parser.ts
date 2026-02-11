import { getLogger } from "@aop/infra";
import type { Question, QuestionOption } from "@aop/llm-provider";

const logger = getLogger("create-task");

export const BRAINSTORM_COMPLETE_MARKER = "[BRAINSTORM_COMPLETE]";

export interface BrainstormingResult {
  title: string;
  description: string;
  requirements: string[];
  acceptanceCriteria: string[];
}

export interface ParsedTextQuestion {
  question: Question;
  assistantOutput: string;
}

/* --- Public API --- */

export const parseBrainstormingResult = (output: string): BrainstormingResult | null => {
  const markerIndex = output.indexOf(BRAINSTORM_COMPLETE_MARKER);
  if (markerIndex === -1) return null;

  const boundaries = findJsonBoundaries(output, markerIndex);
  if (!boundaries) return null;

  const jsonStr = output.slice(boundaries.start, boundaries.end);
  return parseJsonResult(jsonStr);
};

export const parseQuestionFromAssistantOutput = (output: string): ParsedTextQuestion | null => {
  const trimmedOutput = output.trim();
  if (!trimmedOutput) return null;
  if (trimmedOutput.includes(BRAINSTORM_COMPLETE_MARKER)) return null;

  const lines = parseNonEmptyLines(trimmedOutput);
  if (lines.length === 0) return null;

  const candidate = findQuestionCandidate(lines);
  if (!candidate) return null;

  const { options, multiSelect } = parseQuestionOptions(
    lines.slice(candidate.questionLineIndex + 1),
  );
  const hasQuestionShape = candidate.questionText.includes("?") || options.length > 0;
  if (!hasQuestionShape) return null;

  return {
    assistantOutput: trimmedOutput,
    question: {
      question: candidate.questionText,
      header: candidate.parsedQuestionLine.header,
      options: options.length > 0 ? options : undefined,
      multiSelect: options.length > 0 ? multiSelect : undefined,
    },
  };
};

/* --- JSON extraction --- */

const findJsonBoundaries = (
  output: string,
  markerIndex: number,
): { start: number; end: number } | null => {
  const jsonStart = output.indexOf("{", markerIndex);
  if (jsonStart === -1) return null;

  let braceCount = 0;
  for (let i = jsonStart; i < output.length; i++) {
    if (output[i] === "{") braceCount++;
    if (output[i] === "}") braceCount--;
    if (braceCount === 0) {
      return { start: jsonStart, end: i + 1 };
    }
  }
  return null;
};

const parseJsonResult = (jsonStr: string): BrainstormingResult | null => {
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      title: String(parsed.title || ""),
      description: String(parsed.description || ""),
      requirements: Array.isArray(parsed.requirements) ? parsed.requirements.map(String) : [],
      acceptanceCriteria: Array.isArray(parsed.acceptanceCriteria)
        ? parsed.acceptanceCriteria.map(String)
        : [],
    };
  } catch (err) {
    logger.warn("Failed to parse brainstorming result JSON: {error}", { error: String(err) });
    return null;
  }
};

/* --- Question parsing --- */

const QUESTION_WITH_HEADER_REGEX = /^Question(?:\s+\d+(?:\/\d+)?)?(?:\s+\[([^\]]+)\])?:\s*(.+)$/i;
const NATURAL_QUESTION_PREFIX_REGEX =
  /^.*\bquestion(?:\s+\d+(?:\/\d+)?)?(?:\s+\[([^\]]+)\])?:\s*(.+)$/i;
const QUESTION_WITHOUT_PREFIX_REGEX = /^\[([^\]]+)\]\s*(.+)$/;
const OPTION_LINE_REGEX = /^\d+[).:-]\s+(.+)$/;
const MULTI_SELECT_HINT_REGEX = /(comma[-\s]?separated|multiple\s+choice|multi[-\s]?select)/i;

const QUESTION_PATTERNS: RegExp[] = [QUESTION_WITH_HEADER_REGEX, NATURAL_QUESTION_PREFIX_REGEX];

interface ParsedQuestionLine {
  header?: string;
  question: string;
}

interface QuestionCandidate {
  questionLineIndex: number;
  parsedQuestionLine: { header?: string; question: string };
  questionText: string;
}

const normalizeLine = (line: string): string => line.replace(/^\s*[-*]\s+/, "").trim();

const matchToQuestionLine = (match: RegExpMatchArray): ParsedQuestionLine => ({
  header: match[1]?.trim() || undefined,
  question: match[2]?.trim() || "",
});

const tryMatchPatterns = (text: string): ParsedQuestionLine | null => {
  for (const pattern of QUESTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) return matchToQuestionLine(match);
  }
  return null;
};

const parseQuestionLine = (line: string): ParsedQuestionLine | null => {
  const normalized = normalizeLine(line);
  if (!normalized) return null;

  const patternMatch = tryMatchPatterns(normalized);
  if (patternMatch) return patternMatch;

  const withoutPrefix = normalized.match(QUESTION_WITHOUT_PREFIX_REGEX);
  if (withoutPrefix?.[2]?.includes("?")) return matchToQuestionLine(withoutPrefix);

  return normalized.includes("?") ? { question: normalized } : null;
};

const parseOptionFromLine = (normalized: string): QuestionOption | null => {
  const optionMatch = normalized.match(OPTION_LINE_REGEX);
  if (!optionMatch?.[1]) return null;

  const optionText = optionMatch[1].trim();
  if (!optionText) return null;

  const [labelPart = "", ...descriptionParts] = optionText.split(" - ");
  const label = labelPart.trim();
  if (!label) return null;

  const description = descriptionParts.join(" - ").trim();
  return {
    label,
    description: description.length > 0 ? description : undefined,
  };
};

const parseQuestionOptionLine = (
  line: string,
): { option: QuestionOption | null; multiSelect: boolean } => {
  const normalized = normalizeLine(line);
  if (!normalized) {
    return { option: null, multiSelect: false };
  }

  return {
    option: parseOptionFromLine(normalized),
    multiSelect: MULTI_SELECT_HINT_REGEX.test(normalized),
  };
};

const parseQuestionOptions = (
  lines: string[],
): { options: NonNullable<Question["options"]>; multiSelect: boolean } => {
  const options: NonNullable<Question["options"]> = [];
  let multiSelect = false;

  for (const line of lines) {
    const parsed = parseQuestionOptionLine(line);
    if (parsed.multiSelect) {
      multiSelect = true;
    }
    if (parsed.option) {
      options.push(parsed.option);
    }
  }

  return { options, multiSelect };
};

const parseNonEmptyLines = (output: string): string[] => {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

const findQuestionCandidate = (lines: string[]): QuestionCandidate | null => {
  const questionLineIndex = lines.findIndex((line) => parseQuestionLine(line) !== null);
  if (questionLineIndex === -1) return null;

  const questionLine = lines[questionLineIndex];
  if (!questionLine) return null;

  const parsedQuestionLine = parseQuestionLine(questionLine);
  if (!parsedQuestionLine) return null;

  const questionText = parsedQuestionLine.question.trim();
  if (!questionText) return null;

  return { questionLineIndex, parsedQuestionLine, questionText };
};
