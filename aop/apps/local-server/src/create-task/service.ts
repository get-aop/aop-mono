import { generateTypeId, getLogger } from "@aop/infra";
import { aopPaths } from "@aop/infra";
import { ClaudeCodeSession, type Question } from "@aop/llm-provider";
import type { LocalServerContext } from "../context.ts";
import {
  type BrainstormingResult,
  parseBrainstormingResult,
  parseQuestionFromAssistantOutput,
} from "./brainstorm-parser.ts";
import { type ClaudeRunState, createClaudeTurnRunner } from "./claude-turn-runner.ts";
import {
  buildBrainstormingPrompt,
  buildContinuationPrompt,
  finalizeWithChange,
  normalizeMaxQuestions,
} from "./task-builder.ts";

export type { BrainstormingResult, ParsedTextQuestion } from "./brainstorm-parser.ts";

const logger = getLogger("create-task");

const MAX_CONTINUATION_RETRIES = 3;
const DEFAULT_TURN_TIMEOUT_MS = 90 * 1000;

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
}

export const createCreateTaskService = (
  ctx: LocalServerContext,
  deps: CreateTaskServiceDeps = {},
): CreateTaskService => {
  const runtimes = new Map<string, RuntimeSession>();
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

  const { runClaudeTurn } = createClaudeTurnRunner(turnTimeoutMs);

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

  return {
    start: async (input: StartBrainstormInput): Promise<CreateTaskStepResponse> => {
      const maxQuestions = normalizeMaxQuestions(input.maxQuestions);
      const prompt = buildBrainstormingPrompt(input.description);
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
        await markSessionCompleted(runtime);
        return {
          status: "success",
          sessionId: runtime.sessionId,
          requirements,
        };
      }

      const result = await finalizeWithChange(runtime, requirements, detectQuestion);
      if (result.changeName) {
        const repo = await ctx.repoRepository.getByPath(runtime.cwd);
        if (repo) {
          await ctx.taskRepository.createIdempotent({
            id: generateTypeId("task"),
            repo_id: repo.id,
            change_path: `${aopPaths.relativeTaskDocs()}/${result.changeName}`,
            status: "DRAFT",
            worktree_path: null,
            ready_at: null,
          });
        }
      }
      await markSessionCompleted(runtime);
      return {
        status: "success",
        sessionId: runtime.sessionId,
        requirements,
        ...result,
      };
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
