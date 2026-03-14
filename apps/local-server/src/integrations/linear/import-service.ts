import type { LLMProvider } from "@aop/llm-provider";
import type { LocalServerContext } from "../../context.ts";
import { initRepo } from "../../repo/handlers.ts";
import { getLinearAccessToken } from "./access-token.ts";
import type { createLinearClient } from "./client.ts";
import { createLinearImportPlanner } from "./import-planner.ts";
import { createLinearImporter } from "./importer.ts";
import { createLinearIssueResolver } from "./issue-resolver.ts";
import { createRuntimeLinearClient } from "./runtime-client.ts";

interface CreateLinearImportServiceOptions {
  ctx: LocalServerContext;
  apiKey?: string;
  planningProvider?: LLMProvider;
  createClient?: typeof createLinearClient;
}

export const createLinearImportService = (options: CreateLinearImportServiceOptions) => ({
  importFromInput: async (params: { cwd: string; input: string }) => {
    const repo = await initRepo(options.ctx, params.cwd);
    if (!repo.success) {
      throw new Error(`Not a git repository: ${params.cwd}`);
    }

    const clientFactory = options.createClient ?? createRuntimeLinearClient;
    const client = clientFactory({
      apiKey: options.apiKey ?? process.env.LINEAR_API_KEY,
      getAccessToken: async () => getLinearAccessToken(options.ctx),
    });
    const resolver = createLinearIssueResolver({ client });
    const importer = createLinearImporter({
      repoRepository: options.ctx.repoRepository,
      taskRepository: options.ctx.taskRepository,
      linearStore: options.ctx.linearStore,
      resolveIssuesByRefs: (refs) => resolver.resolve(refs.join(", ")),
    });
    const issues = await resolver.resolve(params.input);
    const result = await importer.importIssues({
      repoId: repo.repoId,
      issues,
    });
    const planner = createLinearImportPlanner({
      ctx: options.ctx,
      provider: options.planningProvider,
    });
    await planner.planTasks({
      taskIds: result.imported.filter((record) => record.requested).map((record) => record.taskId),
    });

    return {
      repoId: repo.repoId,
      alreadyExists: repo.alreadyExists,
      ...result,
    };
  },
});
