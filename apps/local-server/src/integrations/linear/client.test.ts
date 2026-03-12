import { describe, expect, test } from "bun:test";

interface LinearGraphQLIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
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

interface LinearClientModule {
  createLinearClient(options: {
    apiKey?: string;
    getAccessToken?: () => Promise<string | null>;
    fetch?: typeof fetch;
  }): {
    getIssuesByRefs(refs: string[]): Promise<LinearGraphQLIssue[]>;
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
});
