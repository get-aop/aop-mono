import { describe, expect, test } from "bun:test";

interface RawLinearIssue {
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

interface IssueResolverModule {
  createLinearIssueResolver(options: {
    client: {
      getIssuesByRefs(refs: string[]): Promise<RawLinearIssue[]>;
    };
  }): {
    resolve(input: string): Promise<
      Array<{
        id: string;
        ref: string;
        title: string;
        url: string;
        blocks: Array<{
          id: string;
          ref: string;
          title: string;
          url: string;
        }>;
      }>
    >;
  };
}

const loadIssueResolverModule = async (): Promise<IssueResolverModule> =>
  (await import("./issue-resolver.ts")) as IssueResolverModule;

describe("integrations/linear/issue-resolver", () => {
  test("resolves mixed input with duplicate collapse and normalizes only blocks relationships", async () => {
    const { createLinearIssueResolver } = await loadIssueResolverModule();
    let seenRefs: string[] = [];
    const resolver = createLinearIssueResolver({
      client: {
        getIssuesByRefs: async (refs) => {
          seenRefs = refs;
          return [
            {
              id: "lin_124",
              identifier: "ABC-124",
              title: "Second issue",
              url: "https://linear.app/acme/issue/ABC-124/second-issue",
              relations: { nodes: [] },
            },
            {
              id: "lin_123",
              identifier: "ABC-123",
              title: "First issue",
              url: "https://linear.app/acme/issue/ABC-123/first-issue",
              relations: {
                nodes: [
                  {
                    type: "blocks",
                    relatedIssue: {
                      id: "lin_122",
                      identifier: "ABC-122",
                      title: "Blocker issue",
                      url: "https://linear.app/acme/issue/ABC-122/blocker-issue",
                    },
                  },
                  {
                    type: "related",
                    relatedIssue: {
                      id: "lin_999",
                      identifier: "ABC-999",
                      title: "Context only",
                      url: "https://linear.app/acme/issue/ABC-999/context-only",
                    },
                  },
                ],
              },
            },
          ];
        },
      },
    });

    const issues = await resolver.resolve(
      "ABC-123, https://linear.app/acme/issue/ABC-124/second-issue, ABC-123",
    );

    expect(seenRefs).toEqual(["ABC-123", "ABC-124"]);
    expect(issues).toEqual([
      {
        id: "lin_123",
        ref: "ABC-123",
        title: "First issue",
        description: null,
        priority: null,
        project: null,
        state: null,
        team: null,
        url: "https://linear.app/acme/issue/ABC-123/first-issue",
        blocks: [
          {
            id: "lin_122",
            ref: "ABC-122",
            title: "Blocker issue",
            url: "https://linear.app/acme/issue/ABC-122/blocker-issue",
          },
        ],
      },
      {
        id: "lin_124",
        ref: "ABC-124",
        title: "Second issue",
        description: null,
        priority: null,
        project: null,
        state: null,
        team: null,
        url: "https://linear.app/acme/issue/ABC-124/second-issue",
        blocks: [],
      },
    ]);
  });

  test("preserves optional Linear metadata needed by the importer", async () => {
    const { createLinearIssueResolver } = await loadIssueResolverModule();
    const resolver = createLinearIssueResolver({
      client: {
        getIssuesByRefs: async () => [
          {
            id: "lin_200",
            identifier: "GET-41",
            title: "Dashboard Scroll",
            description: "The dashboard image gets cut off at the bottom.",
            priority: 2,
            state: {
              name: "In Progress",
              type: "started",
            },
            project: {
              name: "AOP",
            },
            team: {
              key: "GET",
              name: "Get-aop",
            },
            url: "https://linear.app/get-aop/issue/GET-41/dashboard-scroll",
            relations: { nodes: [] },
          },
        ],
      },
    });

    await expect(resolver.resolve("GET-41")).resolves.toEqual([
      {
        id: "lin_200",
        ref: "GET-41",
        title: "Dashboard Scroll",
        description: "The dashboard image gets cut off at the bottom.",
        priority: 2,
        state: {
          name: "In Progress",
          type: "started",
        },
        project: {
          name: "AOP",
        },
        team: {
          key: "GET",
          name: "Get-aop",
        },
        url: "https://linear.app/get-aop/issue/GET-41/dashboard-scroll",
        blocks: [],
      },
    ]);
  });

  test("fails when Linear does not return every requested issue", async () => {
    const { createLinearIssueResolver } = await loadIssueResolverModule();
    const resolver = createLinearIssueResolver({
      client: {
        getIssuesByRefs: async () => [
          {
            id: "lin_123",
            identifier: "ABC-123",
            title: "First issue",
            url: "https://linear.app/acme/issue/ABC-123/first-issue",
            relations: { nodes: [] },
          },
        ],
      },
    });

    await expect(resolver.resolve("ABC-123, ABC-124")).rejects.toThrow(
      "Linear issues not found: ABC-124",
    );
  });
});
