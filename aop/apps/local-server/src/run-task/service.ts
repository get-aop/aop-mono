import { generateTypeId } from "@aop/infra";
import { ClaudeCodeSession } from "@aop/llm-provider";
import type { LocalServerContext } from "../context.ts";
import { runInitialCommand, runWithRetry } from "../session/background-runner.ts";

export interface RunTaskInput {
  changeName: string;
  cwd: string;
}

export interface RunTaskSuccess {
  status: "success";
  changeName: string;
  sessionId: string;
  warning?: string;
}

export interface RunTaskError {
  status: "error";
  error: string;
  code: "internal";
  sessionId?: string;
}

export type RunTaskResponse = RunTaskSuccess | RunTaskError;

interface RunTaskServiceDeps {
  createClaudeSession?: (cwd: string) => ClaudeCodeSession;
  backgroundTimeoutMs?: number;
}

interface RunTaskService {
  run: (input: RunTaskInput) => Promise<RunTaskResponse>;
}

export const createRunTaskService = (
  ctx: LocalServerContext,
  deps: RunTaskServiceDeps = {},
): RunTaskService => {
  const backgroundTimeoutMs = deps.backgroundTimeoutMs;

  return {
    run: async (input: RunTaskInput): Promise<RunTaskResponse> => {
      const sessionId = generateTypeId("isess");

      const claudeSession =
        deps.createClaudeSession?.(input.cwd) ??
        new ClaudeCodeSession({
          cwd: input.cwd,
          dangerouslySkipPermissions: true,
        });

      const initialResult = await runInitialCommand(claudeSession, `/opsx:new ${input.changeName}`);

      if (!initialResult.claudeSessionId) {
        claudeSession.kill();
        return {
          status: "error",
          code: "internal",
          error: "Failed to get Claude session ID",
        };
      }

      if (initialResult.errorMessage) {
        claudeSession.kill();
        return {
          status: "error",
          code: "internal",
          error: initialResult.errorMessage,
          sessionId,
        };
      }

      await ctx.sessionRepository.create({
        id: sessionId,
        claude_session_id: initialResult.claudeSessionId,
        status: "active",
      });

      const session = {
        claudeSessionId: initialResult.claudeSessionId,
        claudeSession,
      };

      const ffResult = await runWithRetry(session, "/opsx:ff", {
        autoAnswer: input.changeName,
        timeoutMs: backgroundTimeoutMs,
      });

      claudeSession.kill();
      await ctx.sessionRepository.update(sessionId, {
        status: ffResult.success ? "completed" : "error",
      });

      if (!ffResult.success) {
        return {
          status: "success",
          changeName: input.changeName,
          sessionId,
          warning: "Change created, but artifact generation failed.",
        };
      }

      return {
        status: "success",
        changeName: input.changeName,
        sessionId,
      };
    },
  };
};
