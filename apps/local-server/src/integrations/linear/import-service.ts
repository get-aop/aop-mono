import type { LocalServerContext } from "../../context.ts";
import { initRepo } from "../../repo/handlers.ts";
import { getLinearAccessToken } from "./access-token.ts";
import { createLinearClient } from "./client.ts";
import { createLinearImporter } from "./importer.ts";
import { createLinearIssueResolver } from "./issue-resolver.ts";

interface CreateLinearImportServiceOptions {
  ctx: LocalServerContext;
  apiKey?: string;
  createClient?: typeof createLinearClient;
}

export const createLinearImportService = (options: CreateLinearImportServiceOptions) => ({
  importFromInput: async (params: { cwd: string; input: string }) => {
    const repo = await initRepo(options.ctx, params.cwd);
    if (!repo.success) {
      throw new Error(`Not a git repository: ${params.cwd}`);
    }

    const client = (options.createClient ?? createLinearClient)({
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

    return {
      repoId: repo.repoId,
      alreadyExists: repo.alreadyExists,
      ...result,
    };
  },
});
