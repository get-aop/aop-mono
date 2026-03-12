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

      const authorization = await resolveAuthorization(options);
      const response = await fetchImpl(LINEAR_GRAPHQL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorization,
        },
        body: JSON.stringify({
          query: buildIssuesQuery(refs),
          variables: buildIssuesVariables(refs),
        }),
      });

      if (!response.ok) {
        throw new Error(`Linear issue query failed (${response.status})`);
      }

      const body = (await response.json()) as {
        data?: Record<string, LinearRawIssue | null> | null;
        errors?: Array<{ message?: string }>;
      };

      if (body.errors?.length) {
        throw new Error(body.errors[0]?.message ?? "Linear issue query failed");
      }

      if (!body.data || typeof body.data !== "object") {
        throw new Error("Linear issue query returned an invalid payload");
      }

      return refs.flatMap((_, index) => {
        const issue = body.data?.[toIssueAlias(index)];
        return issue ? [issue] : [];
      });
    },
  };
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
        url
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

const toIssueAlias = (index: number): string => `issue${index}`;
