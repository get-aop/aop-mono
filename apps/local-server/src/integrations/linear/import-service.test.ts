import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../../context.ts";
import type { Database } from "../../db/schema.ts";
import { createTestDb } from "../../db/test-utils.ts";
import { parseTaskDoc } from "../../task-docs/task.ts";

interface LinearImportServiceModule {
  createLinearImportService(options: {
    ctx: LocalServerContext;
    createClient?(options: {
      apiKey?: string;
      getAccessToken?: () => Promise<string | null>;
      fetch?: typeof fetch;
    }): {
      getIssuesByRefs(refs: string[]): Promise<
        Array<{
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
        }>
      >;
    };
  }): {
    importFromInput(params: { cwd: string; input: string }): Promise<{
      repoId: string;
      alreadyExists: boolean;
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

const loadImportServiceModule = async (): Promise<LinearImportServiceModule> =>
  (await import("./import-service.ts")) as LinearImportServiceModule;

describe("integrations/linear/import-service", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let repoPath: string;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    repoPath = await mkdtemp(join(tmpdir(), "aop-linear-import-service-"));
    await Bun.$`git init -b main ${repoPath}`.quiet();
    await Bun.$`git -C ${repoPath} config user.email aop-tests@example.com`.quiet();
    await Bun.$`git -C ${repoPath} config user.name "AOP Tests"`.quiet();
  });

  afterEach(async () => {
    await db.destroy();
    await rm(repoPath, { recursive: true, force: true });
  });

  test("auto-registers the current repo before importing Linear issues", async () => {
    const { createLinearImportService } = await loadImportServiceModule();
    const service = createLinearImportService({
      ctx,
      createClient: () => ({
        getIssuesByRefs: async (refs) =>
          refs.map((ref) => ({
            id: `lin_${ref.toLowerCase().replace("-", "_")}`,
            identifier: ref,
            title: ref === "GET-41" ? "Dashboard Scroll" : "Unknown",
            url: `https://linear.app/get-aop/issue/${ref}/dashboard-scroll`,
            relations: { nodes: [] },
          })),
      }),
    });

    const result = await service.importFromInput({
      cwd: repoPath,
      input: "GET-41",
    });

    const repo = await ctx.repoRepository.getByPath(repoPath);
    if (!repo) {
      throw new Error("Expected repo to be auto-registered");
    }

    expect(result.alreadyExists).toBe(false);
    expect(result.repoId).toBe(repo.id);
    expect(result.failures).toEqual([]);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]).toMatchObject({
      ref: "GET-41",
      changePath: "docs/tasks/get-41-dashboard-scroll",
      requested: true,
      dependencyImported: false,
    });

    const taskDoc = await parseTaskDoc(
      join(repoPath, "docs/tasks/get-41-dashboard-scroll/task.md"),
    );
    expect(taskDoc.title).toBe("Dashboard Scroll");
    expect(taskDoc.source).toEqual({
      provider: "linear",
      id: "lin_get_41",
      ref: "GET-41",
      url: "https://linear.app/get-aop/issue/GET-41/dashboard-scroll",
    });

    const taskFiles = await readdir(join(repoPath, "docs/tasks/get-41-dashboard-scroll"));
    expect(taskFiles).toContain("task.md");
    expect(taskFiles).toContain("plan.md");
    expect(taskFiles.some((file) => /^\d{3}-.*\.md$/.test(file))).toBe(true);
  });
});
