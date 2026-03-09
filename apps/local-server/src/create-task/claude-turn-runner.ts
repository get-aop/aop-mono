import { getLogger } from "@aop/infra";
import type { ClaudeCodeSession } from "@aop/llm-provider";

const logger = getLogger("create-task");

export interface ClaudeRunState {
  lastOutput: string;
  completed: boolean;
  errorMessage: string | null;
}

export interface TurnRunnerSession {
  claudeSessionId: string;
  claudeSession: ClaudeCodeSession;
}

/* --- Public API --- */

export const createClaudeTurnRunner = (turnTimeoutMs: number) => {
  const runClaudeTurn = async (
    session: TurnRunnerSession,
    input: string,
    isResume: boolean,
  ): Promise<ClaudeRunState> => {
    const turnStart = logTurnStart(input, isResume);
    const state: ClaudeRunState = {
      lastOutput: "",
      completed: false,
      errorMessage: null,
    };
    const timeout = createTurnTimeout(session, turnTimeoutMs);
    const detachListeners = attachListeners(session, state, timeout.reset);

    try {
      timeout.reset();
      await runCommand(session, input, isResume);
    } catch (err) {
      state.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      timeout.clear();
      detachListeners();
    }

    applyTimeoutError(state, timeout.wasTimedOut(), turnTimeoutMs);
    session.claudeSessionId = session.claudeSession.sessionId ?? session.claudeSessionId;
    logTurnEnd(state, turnStart);

    return state;
  };

  return { runClaudeTurn };
};

/* --- Helpers --- */

const runCommand = (
  session: TurnRunnerSession,
  input: string,
  isResume: boolean,
): Promise<void> => {
  return isResume
    ? session.claudeSession.resume(session.claudeSessionId, input)
    : session.claudeSession.run(input);
};

const createTurnTimeout = (session: TurnRunnerSession, timeoutMs: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  const reset = (): void => {
    timeoutId && clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timedOut = true;
      session.claudeSession.kill();
    }, timeoutMs);
  };

  return {
    reset,
    clear: (): void => {
      timeoutId && clearTimeout(timeoutId);
    },
    wasTimedOut: (): boolean => timedOut,
  };
};

const attachListeners = (
  session: TurnRunnerSession,
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

  session.claudeSession.on("message", onMessage);
  session.claudeSession.on("toolUse", onToolUse);
  session.claudeSession.on("completed", onCompleted);
  session.claudeSession.on("error", onError);

  return () => {
    session.claudeSession.off("message", onMessage);
    session.claudeSession.off("toolUse", onToolUse);
    session.claudeSession.off("completed", onCompleted);
    session.claudeSession.off("error", onError);
  };
};

const applyTimeoutError = (state: ClaudeRunState, timedOut: boolean, timeoutMs: number): void => {
  if (!timedOut) return;
  state.errorMessage =
    state.errorMessage ?? `Claude turn timed out after ${timeoutMs}ms of inactivity`;
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
