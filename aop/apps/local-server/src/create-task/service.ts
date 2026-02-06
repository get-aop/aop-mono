import { generateTypeId, getLogger } from "@aop/infra";
import { type AskUserQuestionInput, ClaudeCodeSession, type Question } from "@aop/llm-provider";
import type { LocalServerContext } from "../context.ts";
import { saveDraft } from "./draft.ts";
import { createQuestionEnforcer, type QuestionEnforcer } from "./question-enforcer.ts";

const logger = getLogger("aop", "local-server", "create-task");

const MAX_CONTINUATION_RETRIES = 3;
const MAX_BACKGROUND_RETRIES = 2;
const RETRY_DELAY_MS = 2000;
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
}

export interface CreateTaskQuestionResponse {
  status: "question";
  sessionId: string;
  question: Question;
  questionCount: number;
  maxQuestions: number;
}

export interface CreateTaskCompletedResponse {
  status: "completed";
  sessionId: string;
  requirements: BrainstormingResult;
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
  questionEnforcer: QuestionEnforcer;
  requirements: BrainstormingResult | null;
  continuationCount: number;
  maxQuestions: number;
  awaitingAnswer: boolean;
  cwd: string;
}

interface ClaudeRunState {
  lastOutput: string;
  questionData: AskUserQuestionInput | null;
  completed: boolean;
  errorMessage: string | null;
}

interface BackgroundTurnState {
  output: string;
  questionData: AskUserQuestionInput | null;
  errorMessage: string | null;
  timedOut: boolean;
}

interface BackgroundRunResult {
  success: boolean;
  output: string;
  sessionId?: string;
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

const buildValidationErrorPrompt = (errorMessage: string): string => {
  return `Error: ${errorMessage}`;
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
  if (value === undefined || value === null || Number.isNaN(value) || value < 0) {
    return 5;
  }
  return Math.floor(value);
};

const appendMaxQuestionsNote = (answer: string): string => {
  return `${answer}\n\nNote: Maximum question limit reached. Please conclude the brainstorming session with the ${BRAINSTORM_COMPLETE_MARKER} marker and requirements JSON.`;
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

  const updateSessionError = async (sessionId: string): Promise<void> => {
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
    const onQuestion = (data: AskUserQuestionInput): void => {
      state.questionData = data;
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
    runtime.claudeSession.on("question", onQuestion);
    runtime.claudeSession.on("completed", onCompleted);
    runtime.claudeSession.on("error", onError);

    return () => {
      runtime.claudeSession.off("message", onMessage);
      runtime.claudeSession.off("toolUse", onToolUse);
      runtime.claudeSession.off("question", onQuestion);
      runtime.claudeSession.off("completed", onCompleted);
      runtime.claudeSession.off("error", onError);
    };
  };

  const applyTurnTimeoutError = (state: ClaudeRunState, timedOut: boolean): void => {
    if (!timedOut) return;
    state.errorMessage =
      state.errorMessage ?? `Claude turn timed out after ${turnTimeoutMs}ms of inactivity`;
  };

  const runClaudeTurn = async (
    runtime: RuntimeSession,
    input: string,
    isResume: boolean,
  ): Promise<ClaudeRunState> => {
    const state: ClaudeRunState = {
      lastOutput: "",
      questionData: null,
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

    return state;
  };

  const handleQuestion = async (
    runtime: RuntimeSession,
    questionData: AskUserQuestionInput,
  ): Promise<CreateTaskQuestionResponse | { retryPrompt: string } | CreateTaskBaseError> => {
    const validationResult = runtime.questionEnforcer.validate(questionData);
    if (!validationResult.valid) {
      return {
        retryPrompt: buildValidationErrorPrompt(
          validationResult.errorMessage || "Invalid question",
        ),
      };
    }

    const question = validationResult.question;
    if (!question) {
      return { retryPrompt: buildValidationErrorPrompt("No question provided") };
    }

    runtime.questionEnforcer.incrementQuestionCount();
    runtime.awaitingAnswer = true;
    await ctx.sessionRepository.update(runtime.sessionId, {
      status: "brainstorming",
      question_count: runtime.questionEnforcer.getQuestionCount(),
    });

    return {
      status: "question",
      sessionId: runtime.sessionId,
      question,
      questionCount: runtime.questionEnforcer.getQuestionCount(),
      maxQuestions: runtime.maxQuestions,
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
      };
    }

    await ctx.sessionRepository.update(runtime.sessionId, {
      continuation_count: runtime.continuationCount,
    });

    return { retryPrompt: buildContinuationPrompt(runtime.continuationCount) };
  };

  const processClaudeState = async (
    runtime: RuntimeSession,
    state: ClaudeRunState,
  ): Promise<CreateTaskStepResponse | { retryPrompt: string }> => {
    if (state.errorMessage) {
      await updateSessionError(runtime.sessionId);
      return {
        status: "error",
        code: "internal",
        sessionId: runtime.sessionId,
        error: state.errorMessage,
      };
    }

    if (state.questionData) {
      return handleQuestion(runtime, state.questionData);
    }

    if (state.completed) {
      const result = parseBrainstormingResult(state.lastOutput);
      if (result) {
        runtime.requirements = result;
        runtime.awaitingAnswer = false;
        await ctx.sessionRepository.update(runtime.sessionId, { status: "brainstorming" });
        return {
          status: "completed",
          sessionId: runtime.sessionId,
          requirements: result,
        };
      }
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

  const runBackgroundTurn = async (
    runtime: RuntimeSession,
    input: string,
  ): Promise<BackgroundTurnState> => {
    const state: BackgroundTurnState = {
      output: "",
      questionData: null,
      errorMessage: null,
      timedOut: false,
    };

    const onMessage = (content: string): void => {
      state.output += content;
    };
    const onQuestion = (data: AskUserQuestionInput): void => {
      state.questionData = data;
    };
    const onCompleted = (output: string): void => {
      state.output = output;
    };
    const onError = (code: number): void => {
      state.errorMessage = `Claude process exited with code ${code}`;
    };

    runtime.claudeSession.on("message", onMessage);
    runtime.claudeSession.on("question", onQuestion);
    runtime.claudeSession.on("completed", onCompleted);
    runtime.claudeSession.on("error", onError);

    const timeoutId = setTimeout(() => {
      state.timedOut = true;
      runtime.claudeSession.kill();
    }, DEFAULT_BACKGROUND_TIMEOUT_MS);

    try {
      await runtime.claudeSession.resume(runtime.claudeSessionId, input);
    } catch (err) {
      state.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timeoutId);
      runtime.claudeSession.off("message", onMessage);
      runtime.claudeSession.off("question", onQuestion);
      runtime.claudeSession.off("completed", onCompleted);
      runtime.claudeSession.off("error", onError);
    }

    const latestSessionId = runtime.claudeSession.sessionId;
    if (latestSessionId) {
      runtime.claudeSessionId = latestSessionId;
    }

    return state;
  };

  const toBackgroundTurnFailure = (turn: BackgroundTurnState): BackgroundRunResult | null => {
    if (turn.timedOut) {
      return {
        success: false,
        output: `Background command timed out after ${DEFAULT_BACKGROUND_TIMEOUT_MS}ms`,
      };
    }

    if (turn.errorMessage) {
      return { success: false, output: turn.errorMessage };
    }

    return null;
  };

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

  const finalizeWithChange = async (
    runtime: RuntimeSession,
    requirements: BrainstormingResult,
  ): Promise<CreateTaskFinalizeSuccess> => {
    const changeName = toKebabCase(requirements.title);
    const newResult = await runWithRetry(runtime, "/opsx:new", changeName);

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
    const ffResult = await runWithRetry(runtime, "/opsx:ff", changeName);
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

  const runBackgroundInSession = async (
    runtime: RuntimeSession,
    prompt: string,
    autoAnswer?: string,
  ): Promise<BackgroundRunResult> => {
    const first = await runBackgroundTurn(runtime, prompt);
    const firstFailure = toBackgroundTurnFailure(first);
    if (firstFailure) return firstFailure;

    if (!first.questionData) {
      return { success: true, output: first.output, sessionId: runtime.claudeSessionId };
    }

    if (!autoAnswer) {
      return {
        success: false,
        output: "Background command requested user input but no auto-answer was provided",
      };
    }

    const second = await runBackgroundTurn(runtime, autoAnswer);
    const secondFailure = toBackgroundTurnFailure(second);
    if (secondFailure) return secondFailure;

    if (second.questionData) {
      return {
        success: false,
        output: "Background command requested multiple questions unexpectedly",
      };
    }
    return { success: true, output: second.output, sessionId: runtime.claudeSessionId };
  };

  const runWithRetry = async (
    runtime: RuntimeSession,
    prompt: string,
    autoAnswer?: string,
  ): Promise<BackgroundRunResult> => {
    for (let attempt = 1; attempt <= MAX_BACKGROUND_RETRIES; attempt++) {
      const result = await runBackgroundInSession(runtime, prompt, autoAnswer);
      if (result.success) {
        return result;
      }

      logger.warn("Background command failed", {
        prompt,
        attempt,
        output: result.output.slice(0, 500),
      });

      if (attempt < MAX_BACKGROUND_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    return { success: false, output: `Command failed after ${MAX_BACKGROUND_RETRIES} attempts` };
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
        questionEnforcer: createQuestionEnforcer({ maxQuestionCount: maxQuestions }),
        requirements: null,
        continuationCount: 0,
        maxQuestions,
        awaitingAnswer: false,
        cwd: input.cwd,
      };

      const firstResult = await runClaudeTurn(runtime, prompt, false);

      if (!runtime.claudeSessionId) {
        return {
          status: "error",
          code: "internal",
          error: "Failed to get Claude session ID",
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

      const answer = runtime.questionEnforcer.isMaxQuestionsReached()
        ? appendMaxQuestionsNote(input.answer)
        : input.answer;

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
