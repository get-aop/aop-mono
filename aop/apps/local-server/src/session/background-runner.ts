import { getLogger } from "@aop/infra";
import type { ClaudeCodeSession } from "@aop/llm-provider";

const logger = getLogger("aop", "local-server", "background-runner");

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;
const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;

export interface BackgroundRunnerSession {
  claudeSessionId: string;
  claudeSession: ClaudeCodeSession;
}

export interface BackgroundTurnState {
  output: string;
  errorMessage: string | null;
  timedOut: boolean;
}

export interface BackgroundRunResult {
  success: boolean;
  output: string;
  sessionId?: string;
}

export interface BackgroundRunnerOptions {
  timeoutMs?: number;
  detectQuestion?: (output: string) => boolean;
}

const defaultDetectQuestion = (output: string): boolean => {
  const optionPattern = /^\s*\d+\.\s+(.+)/;
  return output.split("\n").some((line) => optionPattern.test(line));
};

export const runBackgroundTurn = async (
  session: BackgroundRunnerSession,
  input: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<BackgroundTurnState> => {
  const state: BackgroundTurnState = {
    output: "",
    errorMessage: null,
    timedOut: false,
  };

  const onMessage = (content: string): void => {
    state.output += content;
  };
  const onCompleted = (output: string): void => {
    state.output = output;
  };
  const onError = (code: number): void => {
    state.errorMessage = `Claude process exited with code ${code}`;
  };

  session.claudeSession.on("message", onMessage);
  session.claudeSession.on("completed", onCompleted);
  session.claudeSession.on("error", onError);

  const timeoutId = setTimeout(() => {
    state.timedOut = true;
    session.claudeSession.kill();
  }, timeoutMs);

  try {
    await session.claudeSession.resume(session.claudeSessionId, input);
  } catch (err) {
    state.errorMessage = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timeoutId);
    session.claudeSession.off("message", onMessage);
    session.claudeSession.off("completed", onCompleted);
    session.claudeSession.off("error", onError);
  }

  const latestSessionId = session.claudeSession.sessionId;
  if (latestSessionId) {
    session.claudeSessionId = latestSessionId;
  }

  return state;
};

export const toBackgroundTurnFailure = (
  turn: BackgroundTurnState,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): BackgroundRunResult | null => {
  if (turn.timedOut) {
    return {
      success: false,
      output: `Background command timed out after ${timeoutMs}ms`,
    };
  }

  if (turn.errorMessage) {
    return { success: false, output: turn.errorMessage };
  }

  return null;
};

export const runBackgroundInSession = async (
  session: BackgroundRunnerSession,
  prompt: string,
  opts: BackgroundRunnerOptions & { autoAnswer?: string } = {},
): Promise<BackgroundRunResult> => {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const detectQuestion = opts.detectQuestion ?? defaultDetectQuestion;

  const first = await runBackgroundTurn(session, prompt, timeoutMs);
  const firstFailure = toBackgroundTurnFailure(first, timeoutMs);
  if (firstFailure) return firstFailure;

  if (!detectQuestion(first.output)) {
    return { success: true, output: first.output, sessionId: session.claudeSessionId };
  }

  if (!opts.autoAnswer) {
    return {
      success: false,
      output: "Background command requested user input but no auto-answer was provided",
    };
  }

  const second = await runBackgroundTurn(session, opts.autoAnswer, timeoutMs);
  const secondFailure = toBackgroundTurnFailure(second, timeoutMs);
  if (secondFailure) return secondFailure;

  if (detectQuestion(second.output)) {
    return {
      success: false,
      output: "Background command requested multiple questions unexpectedly",
    };
  }
  return { success: true, output: second.output, sessionId: session.claudeSessionId };
};

export const runWithRetry = async (
  session: BackgroundRunnerSession,
  prompt: string,
  opts: BackgroundRunnerOptions & { autoAnswer?: string; maxRetries?: number } = {},
): Promise<BackgroundRunResult> => {
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await runBackgroundInSession(session, prompt, opts);
    if (result.success) {
      return result;
    }

    logger.warn("Background command failed", {
      prompt,
      attempt,
      output: result.output.slice(0, 500),
    });

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  return { success: false, output: `Command failed after ${maxRetries} attempts` };
};

export interface InitialRunResult {
  claudeSessionId: string;
  errorMessage: string | null;
}

export const runInitialCommand = async (
  claudeSession: ClaudeCodeSession,
  prompt: string,
): Promise<InitialRunResult> => {
  const state = { output: "", errorMessage: null as string | null };

  const onMessage = (content: string): void => {
    state.output += content;
  };
  const onCompleted = (output: string): void => {
    state.output = output;
  };
  const onError = (code: number): void => {
    state.errorMessage = `Claude process exited with code ${code}`;
  };

  claudeSession.on("message", onMessage);
  claudeSession.on("completed", onCompleted);
  claudeSession.on("error", onError);

  try {
    await claudeSession.run(prompt);
  } catch (err) {
    state.errorMessage = err instanceof Error ? err.message : String(err);
  } finally {
    claudeSession.off("message", onMessage);
    claudeSession.off("completed", onCompleted);
    claudeSession.off("error", onError);
  }

  return {
    claudeSessionId: claudeSession.sessionId ?? "",
    errorMessage: state.errorMessage,
  };
};
