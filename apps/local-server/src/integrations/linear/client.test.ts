import { describe, expect, test } from "bun:test";

interface LinearGraphQLIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  project?: {
    name: string;
  } | null;
  state?: {
    name: string;
    type: string;
  } | null;
  assignee?: {
    id: string;
    name: string;
  } | null;
  relations?: {
    nodes?: Array<{
      type?: string | null;
      relatedIssue?: {
        id: string;
        identifier: string;
        title: string;
        url: string;
      } | null;
    }>;
  } | null;
}

interface LinearGraphQLImportProject {
  id: string;
  name: string;
}

interface LinearGraphQLImportUser {
  id: string;
  name: string;
  displayName?: string | null;
  email?: string | null;
  isMe?: boolean | null;
  active?: boolean | null;
}

interface LinearClientModule {
  createLinearClient(options: {
    apiKey?: string;
    getAccessToken?: () => Promise<string | null>;
    fetch?: typeof fetch;
  }): {
    getIssuesByRefs(refs: string[]): Promise<LinearGraphQLIssue[]>;
    getImportOptions(): Promise<{
      projects: LinearGraphQLImportProject[];
      users: LinearGraphQLImportUser[];
    }>;
    getTodoIssues(params: {
      projectId: string;
      assigneeId?: string;
    }): Promise<LinearGraphQLIssue[]>;
  };
}

const loadClientModule = async (): Promise<LinearClientModule> =>
  (await import("./client.ts")) as LinearClientModule;

const createFetchMock = (
  handler: (
    input: string | URL | Request,
    init?: RequestInit | BunFetchRequestInit,
  ) => Promise<Response>,
): typeof fetch =>
  Object.assign(handler, {
    preconnect:
      typeof fetch.preconnect === "function" ? fetch.preconnect.bind(fetch) : () => undefined,
  }) as typeof fetch;

describe("integrations/linear/client", () => {
  test("uses an unlocked OAuth token before the API key fallback", async () => {
    const { createLinearClient } = await loadClientModule();
    const seenHeaders: string[] = [];
    const seenBodies: string[] = [];
    const client = createLinearClient({
      apiKey: "linear-api-key",
      getAccessToken: async () => "oauth-access-token",
      fetch: createFetchMock(async (_input, init) => {
        seenHeaders.push(new Headers(init?.headers).get("Authorization") ?? "");
        seenBodies.push(String(init?.body ?? ""));
        return new Response(
          JSON.stringify({
            data: {
              issue0: {
                id: "lin_123",
                identifier: "ABC-123",
                title: "Imported issue",
                url: "https://linear.app/acme/issue/ABC-123/imported-issue",
                relations: { nodes: [] },
              },
            },
          }),
        );
      }),
    });

    const issues = await client.getIssuesByRefs(["ABC-123"]);

    expect(seenHeaders).toEqual(["Bearer oauth-access-token"]);
    expect(seenBodies[0]).toContain("issue(id: $ref0)");
    expect(seenBodies[0]).toContain('"ref0":"ABC-123"');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.identifier).toBe("ABC-123");
  });

  test("falls back to LINEAR_API_KEY when no OAuth token is available", async () => {
    const { createLinearClient } = await loadClientModule();
    let seenAuthorization = "";
    const client = createLinearClient({
      apiKey: "linear-api-key",
      getAccessToken: async () => null,
      fetch: createFetchMock(async (_input, init) => {
        seenAuthorization = new Headers(init?.headers).get("Authorization") ?? "";
        return new Response(
          JSON.stringify({
            data: {
              issue0: {
                id: "lin_124",
                identifier: "ABC-124",
                title: "Imported issue",
                url: "https://linear.app/acme/issue/ABC-124/imported-issue",
                relations: { nodes: [] },
              },
            },
          }),
        );
      }),
    });

    const issues = await client.getIssuesByRefs(["ABC-124"]);

    expect(seenAuthorization).toBe("linear-api-key");
    expect(issues[0]?.identifier).toBe("ABC-124");
  });

  test("returns only the resolved issues when some refs are missing", async () => {
    const { createLinearClient } = await loadClientModule();
    const client = createLinearClient({
      apiKey: "linear-api-key",
      fetch: createFetchMock(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                issue0: {
                  id: "lin_123",
                  identifier: "ABC-123",
                  title: "Imported issue",
                  url: "https://linear.app/acme/issue/ABC-123/imported-issue",
                  relations: { nodes: [] },
                },
                issue1: null,
              },
            }),
          ),
      ),
    });

    await expect(client.getIssuesByRefs(["ABC-123", "ABC-124"])).resolves.toEqual([
      {
        id: "lin_123",
        identifier: "ABC-123",
        title: "Imported issue",
        url: "https://linear.app/acme/issue/ABC-123/imported-issue",
        relations: { nodes: [] },
      },
    ]);
  });

  test("surfaces GraphQL errors", async () => {
    const { createLinearClient } = await loadClientModule();
    const client = createLinearClient({
      apiKey: "linear-api-key",
      fetch: createFetchMock(
        async () =>
          new Response(
            JSON.stringify({
              errors: [{ message: "Something went wrong" }],
            }),
          ),
      ),
    });

    await expect(client.getIssuesByRefs(["ABC-123"])).rejects.toThrow("Something went wrong");
  });

  test("fetches import options for projects and active users", async () => {
    const { createLinearClient } = await loadClientModule();
    const seenBodies: string[] = [];
    const client = createLinearClient({
      apiKey: "linear-api-key",
      fetch: createFetchMock(async (_input, init) => {
        seenBodies.push(String(init?.body ?? ""));
        return new Response(
          JSON.stringify({
            data: {
              projects: {
                nodes: [
                  { id: "project-1", name: "Dashboard" },
                  { id: "project-2", name: "Backend" },
                ],
              },
              users: {
                nodes: [
                  {
                    id: "user-1",
                    name: "Jane Doe",
                    displayName: "Jane",
                    email: "jane@example.com",
                    isMe: true,
                    active: true,
                  },
                  {
                    id: "user-2",
                    name: "Archived User",
                    displayName: "Archived",
                    email: "archived@example.com",
                    isMe: false,
                    active: false,
                  },
                ],
              },
            },
          }),
        );
      }),
    });

    const result = await client.getImportOptions();

    expect(seenBodies[0]).toContain("projects");
    expect(seenBodies[0]).toContain("users");
    expect(result).toEqual({
      projects: [
        { id: "project-1", name: "Dashboard" },
        { id: "project-2", name: "Backend" },
      ],
      users: [
        {
          id: "user-1",
          name: "Jane Doe",
          displayName: "Jane",
          email: "jane@example.com",
          isMe: true,
          active: true,
        },
      ],
    });
  });

  test("fetches TODO issues for a project and optional assignee", async () => {
    const { createLinearClient } = await loadClientModule();
    const seenBodies: string[] = [];
    const client = createLinearClient({
      apiKey: "linear-api-key",
      fetch: createFetchMock(async (_input, init) => {
        seenBodies.push(String(init?.body ?? ""));
        return new Response(
          JSON.stringify({
            data: {
              issues: {
                nodes: [
                  {
                    id: "lin_125",
                    identifier: "ABC-125",
                    title: "Unstarted issue",
                    url: "https://linear.app/acme/issue/ABC-125/unstarted-issue",
                    project: {
                      name: "Dashboard",
                    },
                    state: {
                      name: "Todo",
                      type: "unstarted",
                    },
                    assignee: {
                      id: "user-1",
                      name: "Jane Doe",
                    },
                    relations: { nodes: [] },
                  },
                ],
              },
            },
          }),
        );
      }),
    });

    const issues = await client.getTodoIssues({ projectId: "project-1", assigneeId: "user-1" });

    const requestBody = JSON.parse(seenBodies[0] ?? "{}") as {
      query?: string;
      variables?: Record<string, string>;
    };

    expect(requestBody.query).toContain("issues(filter:");
    expect(requestBody.variables).toEqual({
      projectId: "project-1",
      assigneeId: "user-1",
    });
    expect(requestBody.query).toContain('state: { type: { eq: "unstarted" } }');
    expect(issues).toEqual([
      {
        id: "lin_125",
        identifier: "ABC-125",
        title: "Unstarted issue",
        url: "https://linear.app/acme/issue/ABC-125/unstarted-issue",
        project: {
          name: "Dashboard",
        },
        state: {
          name: "Todo",
          type: "unstarted",
        },
        assignee: {
          id: "user-1",
          name: "Jane Doe",
        },
        relations: { nodes: [] },
      },
    ]);
  });
});
