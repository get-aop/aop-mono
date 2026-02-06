import type { AskUserQuestionInput, Question } from "@aop/llm-provider";

export interface QuestionEnforcerResult {
  valid: boolean;
  question?: Question;
  errorMessage?: string;
}

export interface QuestionEnforcerOptions {
  maxMultiQuestionRetries?: number;
  maxQuestionCount?: number;
}

interface AskedQuestion {
  text: string;
  normalizedText: string;
  normalizedHeader: string;
  optionLabels: string[];
  normalizedOptions: string[];
}

const DEFAULT_MAX_MULTI_QUESTION_RETRIES = 5;
const DEFAULT_MAX_QUESTION_COUNT = 5;
const DEFAULT_MAX_DUPLICATE_RETRIES = 2;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "should",
  "that",
  "the",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "with",
]);

export interface QuestionEnforcer {
  validate: (input: AskUserQuestionInput) => QuestionEnforcerResult;
  incrementQuestionCount: () => void;
  getQuestionCount: () => number;
  isMaxQuestionsReached: () => boolean;
  getRetryCount: () => number;
  getAskedTopics: () => string[];
  reset: () => void;
}

const normalizeHeader = (header: string | undefined): string => {
  if (!header) return "";
  return header.toLowerCase().replace(/[^a-z]/g, "");
};

const normalizeQuestionText = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
};

const tokenizeQuestion = (text: string): string[] => {
  const normalized = normalizeQuestionText(text);
  return normalized.split(" ").filter((token) => token && !STOPWORDS.has(token));
};

const areHeadersSimilar = (normalized: string, existingNormalized: string): boolean => {
  if (normalized === existingNormalized) return true;

  if (normalized.includes(existingNormalized) || existingNormalized.includes(normalized)) {
    return true;
  }

  const minLen = Math.min(normalized.length, existingNormalized.length);
  if (minLen >= 5 && existingNormalized.startsWith(normalized.slice(0, minLen))) {
    return true;
  }

  return false;
};

const buildAskedQuestion = (question: Question): AskedQuestion => {
  const optionLabels = question.options?.map((opt) => opt.label) ?? [];
  return {
    text: question.question,
    normalizedText: normalizeQuestionText(question.question),
    normalizedHeader: normalizeHeader(question.header),
    optionLabels,
    normalizedOptions: normalizeOptionLabels(optionLabels),
  };
};

const normalizeOptionLabels = (labels: string[]): string[] => {
  return labels.map((label) => normalizeHeader(label)).filter(Boolean);
};

const hasSignificantContainment = (a: string, b: string): boolean => {
  if (a.length < 20 || b.length < 20) return false;
  return a.includes(b) || b.includes(a);
};

const hasTokenOverlap = (a: string, b: string): boolean => {
  const tokensA = new Set(tokenizeQuestion(a));
  const tokensB = new Set(tokenizeQuestion(b));
  if (tokensA.size === 0 || tokensB.size === 0) return false;

  let common = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) common++;
  }
  const ratio = common / Math.min(tokensA.size, tokensB.size);
  return ratio >= 0.6;
};

const areQuestionTextsSimilar = (a: string, b: string): boolean => {
  if (!a || !b) return false;
  if (a === b) return true;
  if (hasSignificantContainment(a, b)) return true;
  return hasTokenOverlap(a, b);
};

const areOptionSetsSimilar = (a: string[], b: string[]): boolean => {
  if (a.length === 0 || b.length === 0) return false;

  const remaining = [...b];
  let matches = 0;

  for (const labelA of a) {
    const index = remaining.findIndex((labelB) => areHeadersSimilar(labelA, labelB));
    if (index >= 0) {
      matches++;
      remaining.splice(index, 1);
    }
  }

  const ratio = matches / Math.min(a.length, b.length);
  return ratio >= 0.7;
};

const isSimilarToPrevious = (question: Question, previous: AskedQuestion): boolean => {
  const normalizedText = normalizeQuestionText(question.question);
  const normalizedOptions = normalizeOptionLabels(question.options?.map((opt) => opt.label) ?? []);
  const normalizedHeader = normalizeHeader(question.header);

  if (normalizedHeader && previous.normalizedHeader) {
    if (areHeadersSimilar(normalizedHeader, previous.normalizedHeader)) return true;
  }
  if (areQuestionTextsSimilar(normalizedText, previous.normalizedText)) return true;
  if (areOptionSetsSimilar(normalizedOptions, previous.normalizedOptions)) return true;
  return false;
};

const findSimilarQuestion = (question: Question, asked: AskedQuestion[]): AskedQuestion | null => {
  for (const previous of asked) {
    if (isSimilarToPrevious(question, previous)) return previous;
  }

  return null;
};

export const createQuestionEnforcer = (options: QuestionEnforcerOptions = {}): QuestionEnforcer => {
  const maxMultiQuestionRetries =
    options.maxMultiQuestionRetries ?? DEFAULT_MAX_MULTI_QUESTION_RETRIES;
  const maxQuestionCount = options.maxQuestionCount ?? DEFAULT_MAX_QUESTION_COUNT;
  let multiQuestionRetryCount = 0;
  let duplicateRetryCount = 0;
  let questionCount = 0;
  const askedTopics: string[] = [];
  const askedQuestions: AskedQuestion[] = [];

  const buildDuplicateResult = (duplicateLabel: string): QuestionEnforcerResult => {
    duplicateRetryCount++;
    if (duplicateRetryCount > DEFAULT_MAX_DUPLICATE_RETRIES) {
      return {
        valid: false,
        errorMessage: `STOP. Duplicate question detected ("${duplicateLabel}"). You MUST now output [BRAINSTORM_COMPLETE] with the requirements gathered so far. Do NOT ask any more questions.`,
      };
    }

    return {
      valid: false,
      errorMessage: `STOP. Duplicate question detected ("${duplicateLabel}"). Ask a different question that targets a NEW aspect of the problem. Do NOT conclude yet.`,
    };
  };

  const checkForDuplicate = (question: Question): QuestionEnforcerResult | null => {
    const similarQuestion = findSimilarQuestion(question, askedQuestions);
    if (!similarQuestion) return null;

    return buildDuplicateResult(similarQuestion.text);
  };

  const recordTopic = (question: Question): void => {
    if (question.header) {
      askedTopics.push(question.header);
    }
    askedQuestions.push(buildAskedQuestion(question));
  };

  const validateMultipleQuestions = (count: number): QuestionEnforcerResult => {
    multiQuestionRetryCount++;
    if (multiQuestionRetryCount > maxMultiQuestionRetries) {
      return {
        valid: false,
        errorMessage: `Exceeded maximum multi-question retries (${maxMultiQuestionRetries}). Claude repeatedly sent multiple questions despite instructions.`,
      };
    }
    return {
      valid: false,
      errorMessage: `Please ask only one question at a time. You sent ${count} questions. Re-ask with a single question.`,
    };
  };

  const validateSingleQuestion = (question: Question): QuestionEnforcerResult => {
    const duplicateResult = checkForDuplicate(question);
    if (duplicateResult) return duplicateResult;

    recordTopic(question);
    return { valid: true, question };
  };

  return {
    validate: (input: AskUserQuestionInput): QuestionEnforcerResult => {
      if (!input.questions || input.questions.length === 0) {
        return { valid: false, errorMessage: "No questions provided in AskUserQuestion input" };
      }

      if (input.questions.length > 1) {
        return validateMultipleQuestions(input.questions.length);
      }

      multiQuestionRetryCount = 0;
      const question = input.questions[0];
      if (!question) {
        return { valid: false, errorMessage: "No question provided" };
      }

      return validateSingleQuestion(question);
    },

    incrementQuestionCount: (): void => {
      questionCount++;
    },

    getQuestionCount: (): number => questionCount,

    isMaxQuestionsReached: (): boolean =>
      maxQuestionCount > 0 ? questionCount >= maxQuestionCount : false,

    getRetryCount: (): number => multiQuestionRetryCount,

    getAskedTopics: (): string[] => [...askedTopics],

    reset: (): void => {
      multiQuestionRetryCount = 0;
      duplicateRetryCount = 0;
      questionCount = 0;
      askedTopics.length = 0;
      askedQuestions.length = 0;
    },
  };
};
