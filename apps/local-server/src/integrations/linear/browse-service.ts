import type { LocalServerContext } from "../../context.ts";
import { getLinearAccessToken } from "./access-token.ts";
import { createLinearClient } from "./client.ts";

interface CreateLinearBrowseServiceOptions {
  ctx: LocalServerContext;
  apiKey?: string;
  createClient?: typeof createLinearClient;
}

export const createLinearBrowseService = (options: CreateLinearBrowseServiceOptions) => ({
  getImportOptions: async () => {
    const client = createBrowseClient(options);
    const result = await client.getImportOptions();

    return {
      projects: [...result.projects].sort((left, right) => left.name.localeCompare(right.name)),
      users: [...result.users]
        .sort((left, right) => {
          if (left.isMe !== right.isMe) {
            return left.isMe ? -1 : 1;
          }

          return left.name.localeCompare(right.name);
        })
        .map((user) => ({
          id: user.id,
          name: user.name,
          displayName: user.displayName ?? null,
          email: user.email ?? null,
          isMe: user.isMe,
        })),
    };
  },

  getTodoIssues: async (params: { projectId: string; assigneeId?: string }) => {
    const client = createBrowseClient(options);
    const issues = await client.getTodoIssues(params);

    return {
      issues: [...issues]
        .sort((left, right) => left.identifier.localeCompare(right.identifier))
        .map((issue) => ({
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          url: issue.url,
          projectName: issue.project?.name ?? null,
          assigneeName: issue.assignee?.displayName ?? issue.assignee?.name ?? null,
          stateName: issue.state?.name ?? null,
        })),
    };
  },
});

const createBrowseClient = (options: CreateLinearBrowseServiceOptions) =>
  (options.createClient ?? createLinearClient)({
    apiKey: options.apiKey ?? process.env.LINEAR_API_KEY,
    getAccessToken: async () => getLinearAccessToken(options.ctx),
  });
