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
            title: "Triage issue",
            url: "https://linear.app/get-aop/issue/GET-102/triage",
            project: { id: "project-1", name: "AOP" },
            assignee: { id: "user-1", name: "Jane Doe", displayName: "Jane" },
            state: { name: "Triage", type: "triage" },
            relations: { nodes: [] },
          },
          {
            id: "lin_3",
            identifier: "GET-103",
            title: "Started issue",
            url: "https://linear.app/get-aop/issue/GET-103/started",
            project: { id: "project-1", name: "AOP" },
            assignee: { id: "user-1", name: "Jane Doe", displayName: "Jane" },
            state: { name: "In Progress", type: "started" },
            relations: { nodes: [] },
          },
          {
            id: "lin_4",
            identifier: "GET-104",
            title: "Done issue",
            url: "https://linear.app/get-aop/issue/GET-104/done",
            project: { id: "project-1", name: "AOP" },
            assignee: { id: "user-1", name: "Jane Doe", displayName: "Jane" },
            state: { name: "Done", type: "completed" },
            relations: { nodes: [] },
          },
          {
            id: "lin_5",
            identifier: "GET-105",
            title: "Canceled issue",
            url: "https://linear.app/get-aop/issue/GET-105/canceled",
            project: { id: "project-1", name: "AOP" },
            assignee: { id: "user-1", name: "Jane Doe", displayName: "Jane" },
            state: { name: "Canceled", type: "canceled" },
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

  test("filters actionable issues by project and optional assignee", async () => {
    const client = createLinearFixtureClient({ fixturesPath });

    const result = await client.getTodoIssues({ projectId: "project-1", assigneeId: "user-1" });

    expect(result.map((issue) => issue.identifier)).toEqual(["GET-101", "GET-102", "GET-103"]);
  });
});
