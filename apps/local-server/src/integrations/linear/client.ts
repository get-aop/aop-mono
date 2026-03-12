import type { LinearIssueClient, LinearRawIssue } from "./types.ts";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const LINEAR_ISSUES_QUERY = `
  query LinearIssues($refs: [String!]) {
    issues(filter: { identifier: { in: $refs } }) {
      nodes {
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
      }
    }
  }
`;

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
          query: LINEAR_ISSUES_QUERY,
          variables: { refs },
        }),
      });

      if (!response.ok) {
        throw new Error(`Linear issue query failed (${response.status})`);
      }

      const body = (await response.json()) as {
        data?: {
          issues?: {
            nodes?: LinearRawIssue[];
          } | null;
        } | null;
        errors?: Array<{ message?: string }>;
      };

      if (body.errors?.length) {
        throw new Error(body.errors[0]?.message ?? "Linear issue query failed");
      }

      const nodes = body.data?.issues?.nodes;
      if (!Array.isArray(nodes)) {
        throw new Error("Linear issue query returned an invalid payload");
      }

      return nodes;
    },
  };
};

const resolveAuthorization = async (options: CreateLinearClientOptions): Promise<string> => {
  const accessToken = await options.getAccessToken?.();
  if (accessToken) {
    return accessToken;
  }

  if (options.apiKey) {
    return options.apiKey;
  }

  throw new Error("Linear is not connected");
};
