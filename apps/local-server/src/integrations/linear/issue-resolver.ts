import { parseLinearIssueInput } from "./input-parser.ts";
import type {
  LinearIssueClient,
  LinearIssueSummary,
  LinearRawIssue,
  LinearRawIssueSummary,
  LinearResolvedIssue,
} from "./types.ts";

interface CreateLinearIssueResolverOptions {
  client: LinearIssueClient;
}

export const createLinearIssueResolver = (options: CreateLinearIssueResolverOptions) => ({
  resolve: async (input: string): Promise<LinearResolvedIssue[]> => {
    const { refs } = parseLinearIssueInput(input);
    const issues = await options.client.getIssuesByRefs(refs);
    const issuesByRef = new Map(issues.map((issue) => [normalizeRef(issue.identifier), issue]));
    const missingRefs = refs.filter((ref) => !issuesByRef.has(ref));

    if (missingRefs.length > 0) {
      throw new Error(`Linear issues not found: ${missingRefs.join(", ")}`);
    }

    return refs.map((ref) => normalizeIssue(getIssueByRef(issuesByRef, ref)));
  },
});

const normalizeIssue = (issue: LinearRawIssue): LinearResolvedIssue => ({
  id: issue.id,
  ref: normalizeRef(issue.identifier),
  title: issue.title,
  description: normalizeText(issue.description),
  priority: typeof issue.priority === "number" ? issue.priority : null,
  state:
    issue.state?.name && issue.state.type
      ? {
          name: issue.state.name,
          type: issue.state.type,
        }
      : null,
  project: issue.project?.name
    ? {
        name: issue.project.name,
      }
    : null,
  team:
    issue.team?.key && issue.team.name
      ? {
          key: issue.team.key,
          name: issue.team.name,
        }
      : null,
  url: issue.url,
  blocks: (issue.relations?.nodes ?? []).reduce<LinearIssueSummary[]>((blocks, relation) => {
    if (normalizeRelationType(relation.type) !== "blocks" || !relation.relatedIssue) {
      return blocks;
    }

    blocks.push(toIssueSummary(relation.relatedIssue));
    return blocks;
  }, []),
});

const toIssueSummary = (issue: LinearRawIssueSummary): LinearIssueSummary => ({
  id: issue.id,
  ref: normalizeRef(issue.identifier),
  title: issue.title,
  url: issue.url,
});

const getIssueByRef = (issuesByRef: Map<string, LinearRawIssue>, ref: string): LinearRawIssue => {
  const issue = issuesByRef.get(ref);
  if (!issue) {
    throw new Error(`Linear issue not found in resolver: ${ref}`);
  }
  return issue;
};

const normalizeRelationType = (type: string | null | undefined): string =>
  (type ?? "").toLowerCase();

const normalizeRef = (value: string): string => value.toUpperCase();

const normalizeText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};
