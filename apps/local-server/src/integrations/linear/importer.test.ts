import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../../context.ts";
import type { Database } from "../../db/schema.ts";
import { createTestDb, createTestRepo } from "../../db/test-utils.ts";
import { parseTaskDoc } from "../../task-docs/task.ts";

interface LinearIssueSummary {
  id: string;
  ref: string;
  title: string;
  url: string;
}

interface LinearResolvedIssue extends LinearIssueSummary {
  blocks: LinearIssueSummary[];
  description?: string | null;
  priority?: number | null;
  state?: {
    name: string;
    type: string;
  } | null;
  project?: {
    name: string;
  } | null;
  team?: {
    key: string;
    name: string;
  } | null;
}

interface ImporterModule {
  createLinearImporter(options: {
    repoRepository: LocalServerContext["repoRepository"];
    taskRepository: LocalServerContext["taskRepository"];
    linearStore: LocalServerContext["linearStore"];
    resolveIssuesByRefs(refs: string[]): Promise<LinearResolvedIssue[]>;
  }): {
    importIssues(params: { repoId: string; issues: LinearResolvedIssue[] }): Promise<{
      imported: Array<{
        taskId: string;
        ref: string;
        changePath: string;
        requested: boolean;
        dependencyImported: boolean;
      }>;
      failures: Array<{
        ref: string;
        error: string;
      }>;
    }>;
  };
}

type ImportResult = Awaited<
  ReturnType<ReturnType<ImporterModule["createLinearImporter"]>["importIssues"]>
>;

const loadImporterModule = async (): Promise<ImporterModule> =>
  (await import("./importer.ts")) as ImporterModule;

const getImportedRecord = (result: ImportResult, ref: string) => {
  const record = result.imported.find((item) => item.ref === ref);
  if (!record) {
    throw new Error(`Missing imported record for ${ref}`);
  }
  return record;
};

const createIssue = (
  ref: string,
  title: string,
  blocks: LinearIssueSummary[] = [],
): LinearResolvedIssue => ({
  id: `lin_${ref.toLowerCase().replace("-", "_")}`,
  ref,
  title,
  url: `https://linear.app/acme/issue/${ref}/${title.toLowerCase().replace(/\s+/g, "-")}`,
  blocks,
  description: null,
  priority: null,
  state: null,
  project: null,
  team: null,
});

describe("integrations/linear/importer", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let repoPath: string;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    repoPath = join(tmpdir(), `aop-linear-importer-${Date.now()}`);
    await createTestRepo(db, "repo-1", repoPath);
  });

  afterEach(async () => {
    await db.destroy();
    await rm(repoPath, { recursive: true, force: true });
  });

  test("imports a Linear issue into a task doc and stores canonical source linkage", async () => {
    const { createLinearImporter } = await loadImporterModule();
    const importer = createLinearImporter({
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
      linearStore: ctx.linearStore,
      resolveIssuesByRefs: async () => [],
    });

    const result = await importer.importIssues({
      repoId: "repo-1",
      issues: [createIssue("ABC-123", "Auth Flow")],
    });

    expect(result.failures).toEqual([]);
    expect(result.imported).toHaveLength(1);
    const imported = getImportedRecord(result, "ABC-123");

    expect(imported).toMatchObject({
      ref: "ABC-123",
      requested: true,
      dependencyImported: false,
      changePath: "docs/tasks/abc-123-auth-flow",
    });

    const taskDoc = await parseTaskDoc(join(repoPath, imported.changePath, "task.md"));
    expect(taskDoc.title).toBe("Auth Flow");
    expect(taskDoc.source).toEqual({
      provider: "linear",
      id: "lin_abc_123",
      ref: "ABC-123",
      url: "https://linear.app/acme/issue/ABC-123/auth-flow",
    });

    expect(await ctx.linearStore.getTaskSourceByExternalId("repo-1", "lin_abc_123")).toMatchObject({
      task_id: imported.taskId,
      external_ref: "ABC-123",
      title_snapshot: "Auth Flow",
    });
  });

  test("writes a useful task doc from Linear issue details instead of a placeholder stub", async () => {
    const { createLinearImporter } = await loadImporterModule();
    const importer = createLinearImporter({
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
      linearStore: ctx.linearStore,
      resolveIssuesByRefs: async () => [],
    });

    const result = await importer.importIssues({
      repoId: "repo-1",
      issues: [
        {
          ...createIssue("GET-41", "Dashboard Scroll"),
          description:
            "We can't scroll to bottom on dashboard; the image gets stuck and cut when the task view includes a screenshot.",
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
        },
      ],
    });

    const imported = getImportedRecord(result, "GET-41");
    const taskDocPath = join(repoPath, imported.changePath, "task.md");
    const taskDoc = await parseTaskDoc(taskDocPath);
    const rawTaskDoc = await Bun.file(taskDocPath).text();

    expect(taskDoc.description).toContain("Imported from Linear `GET-41`.");
    expect(taskDoc.description).toContain("We can't scroll to bottom on dashboard");
    expect(taskDoc.requirements).toContain("Fix the requested behavior described in `GET-41`.");
    expect(taskDoc.requirements).toContain(
      "Review https://linear.app/acme/issue/GET-41/dashboard-scroll.",
    );
    expect(taskDoc.acceptanceCriteria).toEqual([
      { text: "The implementation matches the behavior requested in GET-41.", checked: false },
      { text: "Relevant verification for this change passes.", checked: false },
    ]);
    expect(rawTaskDoc).toContain("priority: high");
    expect(rawTaskDoc).toContain("  - linear");
    expect(rawTaskDoc).toContain("  - dashboard");
    expect(rawTaskDoc).toContain("  - get");
    expect(rawTaskDoc).toContain("  - aop");
    expect(rawTaskDoc).toContain("- Team: Get-aop (GET)");
    expect(rawTaskDoc).toContain("- Project: AOP");
    expect(rawTaskDoc).toContain("- State: In Progress");
  });

  test("re-imports the same Linear issue without creating a duplicate folder and updates title snapshots", async () => {
    const { createLinearImporter } = await loadImporterModule();
    const importer = createLinearImporter({
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
      linearStore: ctx.linearStore,
      resolveIssuesByRefs: async () => [],
    });

    const first = await importer.importIssues({
      repoId: "repo-1",
      issues: [createIssue("ABC-123", "Old Title")],
    });
    const second = await importer.importIssues({
      repoId: "repo-1",
      issues: [createIssue("ABC-123", "New Title")],
    });

    const firstImported = getImportedRecord(first, "ABC-123");
    const secondImported = getImportedRecord(second, "ABC-123");

    expect(secondImported.taskId).toBe(firstImported.taskId);
    expect(secondImported.changePath).toBe(firstImported.changePath);

    const taskFolders = await readdir(join(repoPath, "docs/tasks"));
    expect(taskFolders).toEqual(["abc-123-old-title"]);

    const taskDoc = await parseTaskDoc(join(repoPath, firstImported.changePath, "task.md"));
    expect(taskDoc.title).toBe("New Title");
    expect(await ctx.linearStore.getTaskSourceByExternalId("repo-1", "lin_abc_123")).toMatchObject({
      task_id: firstImported.taskId,
      title_snapshot: "New Title",
    });
  });

  test("uses the Linear ref in the folder slug so same-title tickets do not collide", async () => {
    const { createLinearImporter } = await loadImporterModule();
    const importer = createLinearImporter({
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
      linearStore: ctx.linearStore,
      resolveIssuesByRefs: async () => [],
    });

    const result = await importer.importIssues({
      repoId: "repo-1",
      issues: [createIssue("ABC-123", "Auth Flow"), createIssue("ABC-124", "Auth Flow")],
    });

    expect(result.failures).toEqual([]);
    expect(result.imported.map((item) => item.changePath).sort()).toEqual([
      "docs/tasks/abc-123-auth-flow",
      "docs/tasks/abc-124-auth-flow",
    ]);
  });

  test("auto-imports missing blockers as dependency-imported draft tasks and mirrors dependency metadata", async () => {
    const { createLinearImporter } = await loadImporterModule();
    const importer = createLinearImporter({
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
      linearStore: ctx.linearStore,
      resolveIssuesByRefs: async (refs) =>
        refs.includes("ABC-120") ? [createIssue("ABC-120", "Provision Database")] : [],
    });

    const result = await importer.importIssues({
      repoId: "repo-1",
      issues: [
        createIssue("ABC-123", "Auth Flow", [
          {
            id: "lin_abc_120",
            ref: "ABC-120",
            title: "Provision Database",
            url: "https://linear.app/acme/issue/ABC-120/provision-database",
          },
        ]),
      ],
    });

    expect(result.failures).toEqual([]);
    expect(result.imported).toHaveLength(2);
    expect(result.imported.find((item) => item.ref === "ABC-120")).toMatchObject({
      requested: false,
      dependencyImported: true,
    });

    const rootTask = getImportedRecord(result, "ABC-123");
    const blockerTask = getImportedRecord(result, "ABC-120");

    const rootDoc = await parseTaskDoc(join(repoPath, rootTask.changePath, "task.md"));
    const blockerDoc = await parseTaskDoc(join(repoPath, blockerTask.changePath, "task.md"));

    expect(rootDoc.dependencySources).toEqual([
      {
        provider: "linear",
        id: "lin_abc_120",
        ref: "ABC-120",
      },
    ]);
    expect(blockerDoc.dependencyImported).toBe(true);
    expect(await ctx.linearStore.listTaskDependencies(rootTask.taskId)).toMatchObject([
      {
        task_id: rootTask.taskId,
        depends_on_task_id: blockerTask.taskId,
        source: "linear_blocks",
      },
    ]);
  });

  test("reports a per-ticket failure when a required blocker cannot be resolved", async () => {
    const { createLinearImporter } = await loadImporterModule();
    const importer = createLinearImporter({
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
      linearStore: ctx.linearStore,
      resolveIssuesByRefs: async () => [],
    });

    const result = await importer.importIssues({
      repoId: "repo-1",
      issues: [
        createIssue("ABC-123", "Auth Flow", [
          {
            id: "lin_abc_120",
            ref: "ABC-120",
            title: "Provision Database",
            url: "https://linear.app/acme/issue/ABC-120/provision-database",
          },
        ]),
      ],
    });

    expect(result.imported).toEqual([]);
    expect(result.failures).toEqual([
      {
        ref: "ABC-123",
        error: "Missing Linear blockers: ABC-120",
      },
    ]);
  });
});
