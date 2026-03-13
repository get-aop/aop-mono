import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLinearFixtureClient } from "./fixture-client.ts";

describe("integrations/linear/fixture-client", () => {
  let tempDir: string;
  let fixturesPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "aop-linear-fixture-client-"));
    fixturesPath = join(tempDir, "fixtures.json");
    await writeFile(
      fixturesPath,
      JSON.stringify({
        projects: [{ id: "project-1", name: "AOP" }],
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
        issues: [
          {
            id: "lin_1",
            identifier: "GET-101",
            title: "Independent issue",
            url: "https://linear.app/get-aop/issue/GET-101/independent",
            project: { id: "project-1", name: "AOP" },
            assignee: { id: "user-1", name: "Jane Doe", displayName: "Jane" },
            state: { name: "Todo", type: "unstarted" },
            relations: { nodes: [] },
          },
          {
            id: "lin_2",
            identifier: "GET-102",
            title: "Blocked issue",
            url: "https://linear.app/get-aop/issue/GET-102/blocked",
            project: { id: "project-1", name: "AOP" },
            assignee: { id: "user-1", name: "Jane Doe", displayName: "Jane" },
            state: { name: "In Progress", type: "started" },
            relations: { nodes: [] },
          },
        ],
      }),
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns requested issues by ref in input order", async () => {
    const client = createLinearFixtureClient({ fixturesPath });

    const result = await client.getIssuesByRefs(["GET-102", "GET-101"]);

    expect(result.map((issue) => issue.identifier)).toEqual(["GET-102", "GET-101"]);
  });

  test("returns fixture import options", async () => {
    const client = createLinearFixtureClient({ fixturesPath });

    const result = await client.getImportOptions();

    expect(result.projects).toEqual([{ id: "project-1", name: "AOP" }]);
    expect(result.users).toHaveLength(1);
    expect(result.users[0]?.name).toBe("Jane Doe");
  });

  test("filters todo issues by project and optional assignee", async () => {
    const client = createLinearFixtureClient({ fixturesPath });

    const result = await client.getTodoIssues({ projectId: "project-1", assigneeId: "user-1" });

    expect(result).toHaveLength(1);
    expect(result[0]?.identifier).toBe("GET-101");
  });
});
