import { aopPaths, generateTypeId } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import { scaffoldTaskFromBrainstorm, toTaskSlug } from "../task-docs/scaffold.ts";

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

interface RunTaskService {
  run: (input: RunTaskInput) => Promise<RunTaskResponse>;
}

interface RunTaskServiceDeps {
  createClaudeSession?: unknown;
  backgroundTimeoutMs?: number;
}

export const createRunTaskService = (
  ctx: LocalServerContext,
  _deps: RunTaskServiceDeps = {},
): RunTaskService => {
  return {
    run: async (input: RunTaskInput): Promise<RunTaskResponse> => {
      const sessionId = generateTypeId("isess");
      const changeName = toTaskSlug(input.changeName);

      try {
        const result = await scaffoldTaskFromBrainstorm(input.cwd, changeName, {
          title: input.changeName,
          description: input.changeName,
          requirements: [input.changeName],
          acceptanceCriteria: [`Complete ${input.changeName}`],
        });

        const repo = await ctx.repoRepository.getByPath(input.cwd);
        if (repo) {
          await ctx.taskRepository.createIdempotent({
            id: generateTypeId("task"),
            repo_id: repo.id,
            change_path: `${aopPaths.relativeTaskDocs()}/${result.taskName}`,
            status: "DRAFT",
            worktree_path: null,
            ready_at: null,
          });
        }

        await ctx.sessionRepository.create({
          id: sessionId,
          claude_session_id: "",
          status: "completed",
        });

        return {
          status: "success",
          changeName: result.taskName,
          sessionId,
        };
      } catch (error) {
        return {
          status: "error",
          code: "internal",
          error: error instanceof Error ? error.message : String(error),
          sessionId,
        };
      }
    },
  };
};
