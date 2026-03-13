import { readFile } from "node:fs/promises";
import type {
  LinearImportProject,
  LinearImportUser,
  LinearIssueClient,
  LinearRawIssue,
} from "./types.ts";

interface LinearFixtureClientOptions {
  fixturesPath: string;
}

interface LinearFixtureData {
  issues?: LinearRawIssue[];
  projects?: LinearImportProject[];
  users?: Array<LinearImportUser & { active?: boolean | null }>;
}

export const createLinearFixtureClient = (
  options: LinearFixtureClientOptions,
): LinearIssueClient => ({
  getIssuesByRefs: async (refs) => {
    const fixtures = await loadFixtures(options.fixturesPath);
    const issuesByRef = new Map(
      (fixtures.issues ?? []).map((issue) => [issue.identifier.toUpperCase(), issue]),
    );

    return refs.flatMap((ref) => {
      const issue = issuesByRef.get(ref.toUpperCase());
      return issue ? [issue] : [];
    });
  },

  getImportOptions: async () => {
    const fixtures = await loadFixtures(options.fixturesPath);
    return {
      projects: fixtures.projects ?? [],
      users: fixtures.users ?? [],
    };
  },

  getTodoIssues: async (params) => {
    const fixtures = await loadFixtures(options.fixturesPath);

    return (fixtures.issues ?? []).filter((issue) => {
      const projectMatches = issue.project?.id === params.projectId;
      if (!projectMatches) {
        return false;
      }

      if (params.assigneeId && issue.assignee?.id !== params.assigneeId) {
        return false;
      }

      return isActionableIssue(issue);
    });
  },
});

const isActionableIssue = (issue: LinearRawIssue): boolean => {
  const stateType = issue.state?.type?.trim().toLowerCase();
  return stateType !== "completed" && stateType !== "canceled";
};

const loadFixtures = async (fixturesPath: string): Promise<LinearFixtureData> => {
  const content = await readFile(fixturesPath, "utf-8");
  const parsed = JSON.parse(content) as LinearFixtureData;

  return {
    issues: parsed.issues ?? [],
    projects: parsed.projects ?? [],
    users: parsed.users ?? [],
  };
};
