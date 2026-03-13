import type { LinearIssueClient, LinearRawIssue } from "./types.ts";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

interface CreateLinearClientOptions {
  apiKey?: string;
  getAccessToken?: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export const createLinearClient = (options: CreateLinearClientOptions): LinearIssueClient => {
  const fetchImpl = options.fetch ?? fetch;

  return {
    getIssuesByRefs: async (refs: string[]): Promise<LinearRawIssue[]> => {
      if (refs.length === 0) {
        return [];
      }

      const data = await executeQuery<Record<string, LinearRawIssue | null>>(options, fetchImpl, {
        query: buildIssuesQuery(refs),
        variables: buildIssuesVariables(refs),
      });

      return refs.flatMap((_, index) => {
        const issue = data?.[toIssueAlias(index)];
        return issue ? [issue] : [];
      });
    },

    getImportOptions: async () => {
      const data = await executeQuery<{
        projects?: {
          nodes?: Array<{ id?: string | null; name?: string | null }>;
        } | null;
        users?: {
          nodes?: Array<{
            id?: string | null;
            name?: string | null;
            displayName?: string | null;
            email?: string | null;
            isMe?: boolean | null;
            active?: boolean | null;
          }>;
        } | null;
      }>(options, fetchImpl, {
        query: buildImportOptionsQuery(),
      });

      return {
        projects: (data.projects?.nodes ?? []).flatMap((project) =>
          project.id && project.name ? [{ id: project.id, name: project.name }] : [],
        ),
        users: (data.users?.nodes ?? []).flatMap((user) =>
          user.id && user.name && user.active !== false
            ? [
                {
                  id: user.id,
                  name: user.name,
                  displayName: user.displayName ?? null,
                  email: user.email ?? null,
                  isMe: user.isMe === true,
                  active: user.active ?? true,
                },
              ]
            : [],
        ),
      };
    },

    getTodoIssues: async (params) => {
      const data = await executeQuery<{
        issues?: {
          nodes?: LinearRawIssue[];
        } | null;
      }>(options, fetchImpl, {
        query: buildTodoIssuesQuery(Boolean(params.assigneeId)),
        variables: buildTodoIssuesVariables(params),
      });

      return data.issues?.nodes ?? [];
    },
  };
};

const executeQuery = async <T>(
  options: CreateLinearClientOptions,
  fetchImpl: typeof fetch,
  params: {
    query: string;
    variables?: Record<string, string>;
  },
): Promise<T> => {
  const authorization = await resolveAuthorization(options);
  const response = await fetchImpl(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authorization,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(`Linear issue query failed (${response.status})`);
  }

  const body = (await response.json()) as {
    data?: T | null;
    errors?: Array<{ message?: string }>;
  };

  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message ?? "Linear issue query failed");
  }

  if (!body.data) {
    throw new Error("Linear issue query returned an invalid payload");
  }

  return body.data;
};

const resolveAuthorization = async (options: CreateLinearClientOptions): Promise<string> => {
  const accessToken = await options.getAccessToken?.();
  if (accessToken) {
    return accessToken.startsWith("Bearer ") ? accessToken : `Bearer ${accessToken}`;
  }

  if (options.apiKey) {
    return options.apiKey;
  }

  throw new Error("Linear is not connected");
};

const buildIssuesQuery = (refs: string[]): string => {
  const variableDefinitions = refs.map((_, index) => `$ref${index}: String!`).join(", ");
  const aliasedIssueQueries = refs
    .map(
      (_, index) => `
      ${toIssueAlias(index)}: issue(id: $ref${index}) {
        id
        identifier
        title
        description
        url
        priority
        state {
          name
          type
        }
        project {
          name
        }
        team {
          key
          name
        }
        relations {
          nodes {
            type
            relatedIssue {
              id
              identifier
              title
              url
            }
          }
        }
      }`,
    )
    .join("\n");

  return `query LinearIssues(${variableDefinitions}) {${aliasedIssueQueries}
}`;
};

const buildIssuesVariables = (refs: string[]): Record<string, string> =>
  Object.fromEntries(refs.map((ref, index) => [`ref${index}`, ref]));

const buildImportOptionsQuery = (): string => `query LinearImportOptions {
  projects(first: 100) {
    nodes {
      id
      name
    }
  }
  users(filter: { active: { eq: true } }, first: 100) {
    nodes {
      id
      name
      displayName
      email
      isMe
      active
    }
  }
}`;

const buildTodoIssuesQuery = (hasAssigneeFilter: boolean): string => {
  const variableDefinitions = hasAssigneeFilter
    ? "($projectId: String!, $assigneeId: String!)"
    : "($projectId: String!)";
  const assigneeFilter = hasAssigneeFilter ? "\n      assignee: { id: { eq: $assigneeId } }," : "";

  return `query LinearTodoIssues${variableDefinitions} {
  issues(filter: {
      project: { id: { eq: $projectId } },${assigneeFilter}
      state: { type: { eq: "unstarted" } }
    }
    first: 100) {
    nodes {
      id
      identifier
      title
      url
      priority
      project {
        id
        name
      }
      state {
        name
        type
      }
      assignee {
        id
        name
        displayName
      }
      relations {
        nodes {
          type
          relatedIssue {
            id
            identifier
            title
            url
          }
        }
      }
    }
  }
}`;
};

const buildTodoIssuesVariables = (params: {
  projectId: string;
  assigneeId?: string;
}): Record<string, string> => {
  const variables: Record<string, string> = {
    projectId: params.projectId,
  };

  if (params.assigneeId) {
    variables.assigneeId = params.assigneeId;
  }

  return variables;
};

const toIssueAlias = (index: number): string => `issue${index}`;
