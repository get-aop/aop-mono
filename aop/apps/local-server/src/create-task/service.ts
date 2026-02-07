import { generateTypeId, getLogger } from "@aop/infra";
import { ClaudeCodeSession, type Question, type QuestionOption } from "@aop/llm-provider";
import type { LocalServerContext } from "../context.ts";
import { runWithRetry } from "../session/background-runner.ts";
import { saveDraft } from "./draft.ts";

const logger = getLogger("aop", "local-server", "create-task");

const MAX_CONTINUATION_RETRIES = 3;
const DEFAULT_TURN_TIMEOUT_MS = 90 * 1000;
const DEFAULT_BACKGROUND_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_BRAINSTORM_COMMAND = "/aop:brainstorming";
const BRAINSTORM_COMPLETE_MARKER = "[BRAINSTORM_COMPLETE]";

const COMPLETION_INSTRUCTIONS =
  "When finished, output ONLY the [BRAINSTORM_COMPLETE] marker and raw JSON on separate lines. Do NOT wrap in code fences. Do NOT add any extra text before or after. Do NOT repeat the marker.";

export interface BrainstormingResult {
  title: string;
  description: string;
  requirements: string[];
  acceptanceCriteria: string[];
}

export interface StartBrainstormInput {
  description: string;
  cwd: string;
  maxQuestions?: number;
}

export interface AnswerQuestionInput {
  sessionId: string;
  answer: string;
}

export interface FinalizeBrainstormInput {
  sessionId: string;
  createChange: boolean;
}

export interface CancelBrainstormInput {
  sessionId: string;
}

interface CreateTaskBaseError {
  status: "error";
  error: string;
  sessionId?: string;
  code: "not_found" | "invalid_state" | "internal";
  assistantOutput?: string;
}

export interface CreateTaskQuestionResponse {
  status: "question";
  sessionId: string;
  question: Question;
  questionCount: number;
  maxQuestions: number;
  assistantOutput?: string;
}

export interface CreateTaskCompletedResponse {
  status: "completed";
  sessionId: string;
  requirements: BrainstormingResult;
  assistantOutput?: string;
}

export type CreateTaskStepResponse =
  | CreateTaskQuestionResponse
  | CreateTaskCompletedResponse
  | CreateTaskBaseError;

export interface CreateTaskFinalizeSuccess {
  status: "success";
  sessionId: string;
  requirements: BrainstormingResult;
  changeName?: string;
  warning?: string;
  draftPath?: string;
}

export type CreateTaskFinalizeResponse = CreateTaskFinalizeSuccess | CreateTaskBaseError;

export interface CreateTaskCancelResponse {
  status: "success";
  sessionId: string;
}

export type CreateTaskCancelResult = CreateTaskCancelResponse | CreateTaskBaseError;

interface RuntimeSession {
  sessionId: string;
  claudeSessionId: string;
  claudeSession: ClaudeCodeSession;
  questionCount: number;
  requirements: BrainstormingResult | null;
  continuationCount: number;
  maxQuestions: number;
  awaitingAnswer: boolean;
  cwd: string;
  lastAssistantOutput: string;
}

interface ClaudeRunState {
  lastOutput: string;
  completed: boolean;
  errorMessage: string | null;
}

type ClaudeDecision = CreateTaskStepResponse | { retryPrompt: string };

interface CreateTaskService {
  start: (input: StartBrainstormInput) => Promise<CreateTaskStepResponse>;
  answer: (input: AnswerQuestionInput) => Promise<CreateTaskStepResponse>;
  finalize: (input: FinalizeBrainstormInput) => Promise<CreateTaskFinalizeResponse>;
  cancel: (input: CancelBrainstormInput) => Promise<CreateTaskCancelResult>;
}

interface CreateTaskServiceDeps {
  createClaudeSession?: (cwd: string) => ClaudeCodeSession;
  turnTimeoutMs?: number;
  brainstormCommand?: string;
}

const buildBrainstormingPrompt = (description: string, command: string): string => {
  return `${command}

Task to brainstorm: ${description}

${COMPLETION_INSTRUCTIONS}`;
};

const buildContinuationPrompt = (attemptNumber: number): string => {
  const attemptText = attemptNumber > 1 ? `This is attempt ${attemptNumber} to continue. ` : "";
  return `Please continue the brainstorming session. ${attemptText}If you have gathered enough information, please conclude with the ${BRAINSTORM_COMPLETE_MARKER} marker and the requirements JSON. Otherwise, ask your next clarifying question. ${COMPLETION_INSTRUCTIONS}`;
};

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

const parseBrainstormingResult = (output: string): BrainstormingResult | null => {
  const markerIndex = output.indexOf(BRAINSTORM_COMPLETE_MARKER);
  if (markerIndex === -1) return null;

  const boundaries = findJsonBoundaries(output, markerIndex);
  if (!boundaries) return null;

  const jsonStr = output.slice(boundaries.start, boundaries.end);
  return parseJsonResult(jsonStr);
};

interface ParsedTextQuestion {
  question: Question;
  assistantOutput: string;
}

const QUESTION_WITH_HEADER_REGEX = /^Question(?:\s+\d+(?:\/\d+)?)?(?:\s+\[([^\]]+)\])?:\s*(.+)$/i;
const NATURAL_QUESTION_PREFIX_REGEX =
  /^.*\bquestion(?:\s+\d+(?:\/\d+)?)?(?:\s+\[([^\]]+)\])?:\s*(.+)$/i;
const QUESTION_WITHOUT_PREFIX_REGEX = /^\[([^\]]+)\]\s*(.+)$/;
const OPTION_LINE_REGEX = /^\d+[).:-]\s+(.+)$/;
const MULTI_SELECT_HINT_REGEX = /(comma[-\s]?separated|multiple\s+choice|multi[-\s]?select)/i;

const normalizeLine = (line: string): string => line.replace(/^\s*[-*]\s+/, "").trim();

interface ParsedQuestionLine {
  header?: string;
  question: string;
}

const matchToQuestionLine = (match: RegExpMatchArray): ParsedQuestionLine => ({
  header: match[1]?.trim() || undefined,
  question: match[2]?.trim() || "",
});

const QUESTION_PATTERNS: RegExp[] = [QUESTION_WITH_HEADER_REGEX, NATURAL_QUESTION_PREFIX_REGEX];

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

interface QuestionCandidate {
  questionLineIndex: number;
  parsedQuestionLine: { header?: string; question: string };
  questionText: string;
}

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

const parseQuestionFromAssistantOutput = (output: string): ParsedTextQuestion | null => {
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

const toKebabCase = (title: string): string => {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
};

const normalizeMaxQuestions = (value: number | undefined): number => {
  // Temporarily disable hard question caps so brainstorming continues until completion marker.
  // The cap input is intentionally ignored during this period.
  void value;
  return 0;
};

export const createCreateTaskService = (
  ctx: LocalServerContext,
  deps: CreateTaskServiceDeps = {},
): CreateTaskService => {
  const runtimes = new Map<string, RuntimeSession>();
  const envBrainstormCommand = process.env.AOP_CREATE_TASK_BRAINSTORM_COMMAND;
  const brainstormCommand =
    deps.brainstormCommand ?? envBrainstormCommand ?? DEFAULT_BRAINSTORM_COMMAND;
  const envTurnTimeoutMs = Number(process.env.AOP_CREATE_TASK_TURN_TIMEOUT_MS);
  const turnTimeoutMs =
    deps.turnTimeoutMs && deps.turnTimeoutMs > 0
      ? deps.turnTimeoutMs
      : Number.isFinite(envTurnTimeoutMs) && envTurnTimeoutMs > 0
        ? envTurnTimeoutMs
        : DEFAULT_TURN_TIMEOUT_MS;

  const saveMessage = async (
    sessionId: string,
    role: "user" | "assistant",
    content: string,
  ): Promise<void> => {
    await ctx.sessionRepository.addMessage({
      id: generateTypeId("smsg"),
      session_id: sessionId,
      role,
      content,
    });
  };

  const removeRuntime = (sessionId: string): void => {
    runtimes.delete(sessionId);
  };

  const disposeRuntime = async (runtime: RuntimeSession): Promise<void> => {
    runtime.claudeSession.kill();
  };

  const updateSessionError = async (sessionId: string): Promise<void> => {
    const runtime = runtimes.get(sessionId);
    if (runtime) {
      await disposeRuntime(runtime);
    }
    await ctx.sessionRepository.update(sessionId, { status: "error" });
    removeRuntime(sessionId);
  };

  const runClaudeTurnCommand = (
    runtime: RuntimeSession,
    input: string,
    isResume: boolean,
  ): Promise<void> => {
    return isResume
      ? runtime.claudeSession.resume(runtime.claudeSessionId, input)
      : runtime.claudeSession.run(input);
  };

  const createTurnTimeout = (runtime: RuntimeSession) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;

    const reset = (): void => {
      timeoutId && clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        timedOut = true;
        runtime.claudeSession.kill();
      }, turnTimeoutMs);
    };

    return {
      reset,
      clear: (): void => {
        timeoutId && clearTimeout(timeoutId);
      },
      wasTimedOut: (): boolean => timedOut,
    };
  };

  const attachClaudeTurnListeners = (
    runtime: RuntimeSession,
    state: ClaudeRunState,
    onActivity: () => void,
  ): (() => void) => {
    const onMessage = (content: string): void => {
      state.lastOutput = content;
      onActivity();
    };
    const onCompleted = (output: string): void => {
      state.lastOutput = output;
      state.completed = true;
      onActivity();
    };
    const onToolUse = (): void => {
      onActivity();
    };
    const onError = (code: number): void => {
      state.errorMessage = `Claude process exited with code ${code}`;
    };

    runtime.claudeSession.on("message", onMessage);
    runtime.claudeSession.on("toolUse", onToolUse);
    runtime.claudeSession.on("completed", onCompleted);
    runtime.claudeSession.on("error", onError);

    return () => {
      runtime.claudeSession.off("message", onMessage);
      runtime.claudeSession.off("toolUse", onToolUse);
      runtime.claudeSession.off("completed", onCompleted);
      runtime.claudeSession.off("error", onError);
    };
  };

  const applyTurnTimeoutError = (state: ClaudeRunState, timedOut: boolean): void => {
    if (!timedOut) return;
    state.errorMessage =
      state.errorMessage ?? `Claude turn timed out after ${turnTimeoutMs}ms of inactivity`;
  };

  const logTurnStart = (input: string, isResume: boolean): number => {
    const inputPreview = input.length > 80 ? `${input.slice(0, 80)}...` : input;
    logger.info("Claude turn starting: {method} {input}", {
      method: isResume ? "resume" : "run",
      input: inputPreview,
    });
    return Date.now();
  };

  const logTurnEnd = (state: ClaudeRunState, turnStart: number): void => {
    const elapsed = Date.now() - turnStart;
    const outputPreview =
      state.lastOutput.length > 200 ? `${state.lastOutput.slice(0, 200)}...` : state.lastOutput;
    logger.info("Claude turn finished in {elapsed}ms: completed={completed} error={error}", {
      elapsed,
      completed: state.completed,
      error: state.errorMessage ?? "none",
    });
    logger.debug("Claude turn output: {output}", { output: outputPreview });
  };

  const runClaudeTurn = async (
    runtime: RuntimeSession,
    input: string,
    isResume: boolean,
  ): Promise<ClaudeRunState> => {
    const turnStart = logTurnStart(input, isResume);
    const state: ClaudeRunState = {
      lastOutput: "",
      completed: false,
      errorMessage: null,
    };
    const timeout = createTurnTimeout(runtime);
    const detachListeners = attachClaudeTurnListeners(runtime, state, timeout.reset);

    try {
      timeout.reset();
      await runClaudeTurnCommand(runtime, input, isResume);
    } catch (err) {
      state.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      timeout.clear();
      detachListeners();
    }

    applyTurnTimeoutError(state, timeout.wasTimedOut());
    runtime.claudeSessionId = runtime.claudeSession.sessionId ?? runtime.claudeSessionId;
    logTurnEnd(state, turnStart);

    return state;
  };

  const handleQuestionResponse = async (
    runtime: RuntimeSession,
    question: Question,
    assistantOutput?: string,
  ): Promise<CreateTaskQuestionResponse | { retryPrompt: string } | CreateTaskBaseError> => {
    runtime.questionCount += 1;
    runtime.awaitingAnswer = true;
    await ctx.sessionRepository.update(runtime.sessionId, {
      status: "brainstorming",
      question_count: runtime.questionCount,
    });

    return {
      status: "question",
      sessionId: runtime.sessionId,
      question,
      questionCount: runtime.questionCount,
      maxQuestions: runtime.maxQuestions,
      assistantOutput,
    };
  };

  const continueBrainstorming = async (
    runtime: RuntimeSession,
  ): Promise<{ retryPrompt: string } | CreateTaskBaseError> => {
    runtime.continuationCount++;
    if (runtime.continuationCount > MAX_CONTINUATION_RETRIES) {
      await updateSessionError(runtime.sessionId);
      return {
        status: "error",
        code: "internal",
        sessionId: runtime.sessionId,
        error: `Session ended without completion after ${MAX_CONTINUATION_RETRIES} attempts`,
        assistantOutput: runtime.lastAssistantOutput || undefined,
      };
    }

    await ctx.sessionRepository.update(runtime.sessionId, {
      continuation_count: runtime.continuationCount,
    });

    return { retryPrompt: buildContinuationPrompt(runtime.continuationCount) };
  };

  const processCompletedOutput = async (
    runtime: RuntimeSession,
    output: string,
    assistantOutput: string,
  ): Promise<CreateTaskStepResponse | { retryPrompt: string } | null> => {
    const result = parseBrainstormingResult(output);
    if (result) {
      logger.info("Brainstorming complete, parsed requirements: {title}", { title: result.title });
      runtime.requirements = result;
      runtime.awaitingAnswer = false;
      await ctx.sessionRepository.update(runtime.sessionId, { status: "brainstorming" });
      return {
        status: "completed",
        sessionId: runtime.sessionId,
        requirements: result,
        assistantOutput: assistantOutput || undefined,
      };
    }

    const parsedQuestion = parseQuestionFromAssistantOutput(output);
    if (parsedQuestion) {
      logger.info("Parsed question from output: {question}", {
        question: parsedQuestion.question.question,
      });
      return handleQuestionResponse(
        runtime,
        parsedQuestion.question,
        parsedQuestion.assistantOutput,
      );
    }

    logger.warn("Completed but no question or result parsed, will retry");
    return null;
  };

  const buildErrorResponse = async (
    runtime: RuntimeSession,
    errorMessage: string,
    assistantOutput: string,
  ): Promise<CreateTaskBaseError> => {
    logger.warn("Claude turn error: {error}", { error: errorMessage });
    await updateSessionError(runtime.sessionId);
    return {
      status: "error",
      code: "internal",
      sessionId: runtime.sessionId,
      error: errorMessage,
      assistantOutput: assistantOutput || runtime.lastAssistantOutput || undefined,
    };
  };

  const processClaudeState = async (
    runtime: RuntimeSession,
    state: ClaudeRunState,
  ): Promise<CreateTaskStepResponse | { retryPrompt: string }> => {
    const assistantOutput = state.lastOutput.trim();
    if (assistantOutput) {
      runtime.lastAssistantOutput = assistantOutput;
    }

    if (state.errorMessage) {
      return buildErrorResponse(runtime, state.errorMessage, assistantOutput);
    }

    if (state.completed) {
      const result = await processCompletedOutput(runtime, state.lastOutput, assistantOutput);
      if (result) return result;
    } else {
      logger.info("Turn not completed (no completed event), will retry");
    }

    return continueBrainstorming(runtime);
  };

  const advanceUntilDecision = async (
    runtime: RuntimeSession,
    input: string,
    isResume: boolean,
  ): Promise<CreateTaskStepResponse> => {
    let nextInput = input;
    let nextIsResume = isResume;

    while (true) {
      const claudeState = await runClaudeTurn(runtime, nextInput, nextIsResume);
      const decision = await processClaudeState(runtime, claudeState);

      if ("status" in decision) {
        return decision;
      }

      nextInput = decision.retryPrompt;
      nextIsResume = true;
    }
  };

  const ensureRuntime = (sessionId: string): RuntimeSession | null => {
    return runtimes.get(sessionId) ?? null;
  };

  const detectQuestion = (output: string): boolean =>
    parseQuestionFromAssistantOutput(output) !== null;

  const resolveClaudeDecision = async (
    runtime: RuntimeSession,
    decision: ClaudeDecision,
  ): Promise<CreateTaskStepResponse> => {
    if ("status" in decision) {
      return decision;
    }
    return advanceUntilDecision(runtime, decision.retryPrompt, true);
  };

  const markSessionCompleted = async (runtime: RuntimeSession): Promise<void> => {
    await disposeRuntime(runtime);
    await ctx.sessionRepository.update(runtime.sessionId, { status: "completed" });
    removeRuntime(runtime.sessionId);
  };

  const finalizeWithoutChange = async (
    runtime: RuntimeSession,
    requirements: BrainstormingResult,
  ): Promise<CreateTaskFinalizeSuccess> => {
    await markSessionCompleted(runtime);
    return {
      status: "success",
      sessionId: runtime.sessionId,
      requirements,
    };
  };

  const bgRunnerOpts = {
    timeoutMs: DEFAULT_BACKGROUND_TIMEOUT_MS,
    detectQuestion,
  };

  const finalizeWithChange = async (
    runtime: RuntimeSession,
    requirements: BrainstormingResult,
  ): Promise<CreateTaskFinalizeSuccess> => {
    const changeName = toKebabCase(requirements.title);
    const newResult = await runWithRetry(runtime, "/opsx:new", {
      ...bgRunnerOpts,
      autoAnswer: changeName,
    });

    if (!newResult.success) {
      const draftPath = await saveDraft(runtime.cwd, changeName, requirements);
      await markSessionCompleted(runtime);
      return {
        status: "success",
        sessionId: runtime.sessionId,
        requirements,
        warning: "Change creation failed after retries. Draft saved.",
        draftPath,
      };
    }

    runtime.claudeSessionId = newResult.sessionId ?? runtime.claudeSessionId;
    const ffResult = await runWithRetry(runtime, "/opsx:ff", {
      ...bgRunnerOpts,
      autoAnswer: changeName,
    });
    await markSessionCompleted(runtime);

    if (!ffResult.success) {
      return {
        status: "success",
        sessionId: runtime.sessionId,
        requirements,
        changeName,
        warning: "Change created, but artifact generation failed.",
      };
    }

    return {
      status: "success",
      sessionId: runtime.sessionId,
      requirements,
      changeName,
    };
  };

  return {
    start: async (input: StartBrainstormInput): Promise<CreateTaskStepResponse> => {
      const maxQuestions = normalizeMaxQuestions(input.maxQuestions);
      const prompt = buildBrainstormingPrompt(input.description, brainstormCommand);
      const claudeSession =
        deps.createClaudeSession?.(input.cwd) ??
        new ClaudeCodeSession({
          cwd: input.cwd,
          dangerouslySkipPermissions: true,
        });

      const runtime: RuntimeSession = {
        sessionId: "",
        claudeSessionId: "",
        claudeSession,
        questionCount: 0,
        requirements: null,
        continuationCount: 0,
        maxQuestions,
        awaitingAnswer: false,
        cwd: input.cwd,
        lastAssistantOutput: "",
      };

      const firstResult = await runClaudeTurn(runtime, prompt, false);

      if (!runtime.claudeSessionId) {
        return {
          status: "error",
          code: "internal",
          error: "Failed to get Claude session ID",
          assistantOutput: firstResult.lastOutput.trim() || undefined,
        };
      }

      const session = await ctx.sessionRepository.create({
        id: generateTypeId("isess"),
        claude_session_id: runtime.claudeSessionId,
        status: "active",
      });
      runtime.sessionId = session.id;
      runtimes.set(session.id, runtime);
      await saveMessage(session.id, "user", prompt);
      const decision = await processClaudeState(runtime, firstResult);
      return resolveClaudeDecision(runtime, decision);
    },

    answer: async (input: AnswerQuestionInput): Promise<CreateTaskStepResponse> => {
      const runtime = ensureRuntime(input.sessionId);
      if (!runtime) {
        return {
          status: "error",
          code: "not_found",
          sessionId: input.sessionId,
          error: "Session not found",
        };
      }

      if (!runtime.awaitingAnswer) {
        return {
          status: "error",
          code: "invalid_state",
          sessionId: input.sessionId,
          error: "Session is not waiting for an answer",
        };
      }

      runtime.awaitingAnswer = false;

      const answer = input.answer;

      await saveMessage(runtime.sessionId, "user", answer);
      return advanceUntilDecision(runtime, answer, true);
    },

    finalize: async (input: FinalizeBrainstormInput): Promise<CreateTaskFinalizeResponse> => {
      const runtime = ensureRuntime(input.sessionId);
      if (!runtime) {
        return {
          status: "error",
          code: "not_found",
          sessionId: input.sessionId,
          error: "Session not found",
        };
      }
      if (!runtime.requirements) {
        return {
          status: "error",
          code: "invalid_state",
          sessionId: input.sessionId,
          error: "No requirements gathered",
        };
      }

      const requirements = runtime.requirements;

      if (!input.createChange) {
        return finalizeWithoutChange(runtime, requirements);
      }

      return finalizeWithChange(runtime, requirements);
    },

    cancel: async (input: CancelBrainstormInput): Promise<CreateTaskCancelResult> => {
      const runtime = ensureRuntime(input.sessionId);
      if (!runtime) {
        return {
          status: "error",
          code: "not_found",
          sessionId: input.sessionId,
          error: "Session not found",
        };
      }

      runtime.claudeSession.kill();
      await ctx.sessionRepository.update(runtime.sessionId, { status: "cancelled" });
      removeRuntime(runtime.sessionId);
      return {
        status: "success",
        sessionId: runtime.sessionId,
      };
    },
  };
};
