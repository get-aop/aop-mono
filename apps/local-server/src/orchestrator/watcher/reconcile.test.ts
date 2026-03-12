import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../../context.ts";
import type { Database, Repo } from "../../db/schema.ts";
import { createTestDb, createTestRepo } from "../../db/test-utils.ts";
import { writeTaskDoc } from "../../task-docs/task.ts";
import { reconcileRepo } from "./reconcile.ts";

describe("orchestrator/watcher/reconcile", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let repoPath: string;
  let repo: Repo;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    repoPath = join(tmpdir(), `aop-reconcile-${Date.now()}`);
    await createTestRepo(db, "repo-1", repoPath);
    const createdRepo = await ctx.repoRepository.getById("repo-1");
    if (!createdRepo) {
      throw new Error("Missing test repo");
    }
    repo = createdRepo;
  });

  afterEach(async () => {
    await db.destroy();
    await rm(repoPath, { recursive: true, force: true });
  });

  test("rebuilds Linear source and dependency rows from task docs", async () => {
    const rootDir = join(repoPath, "docs/tasks/abc-123-auth-flow");
    const blockerDir = join(repoPath, "docs/tasks/abc-120-provision-database");
    await mkdir(rootDir, { recursive: true });
    await mkdir(blockerDir, { recursive: true });

    await writeTaskDoc(
      join(rootDir, "task.md"),
      {
        id: "task-root",
        title: "Auth Flow",
        status: "DRAFT",
        created: "2026-03-12T12:00:00.000Z",
        changePath: "docs/tasks/abc-123-auth-flow",
        source: {
          provider: "linear",
          id: "lin_abc_123",
          ref: "ABC-123",
          url: "https://linear.app/acme/issue/ABC-123/auth-flow",
        },
        dependencySources: [
          {
            provider: "linear",
            id: "lin_abc_120",
            ref: "ABC-120",
          },
        ],
      },
      [
        "",
        "## Description",
        "Imported from Linear",
        "",
        "## Requirements",
        "- Review the ticket",
        "",
        "## Acceptance Criteria",
        "- [ ] Match the Linear intent",
        "",
      ].join("\n"),
    );
    await writeTaskDoc(
      join(blockerDir, "task.md"),
      {
        id: "task-blocker",
        title: "Provision Database",
        status: "DRAFT",
        created: "2026-03-12T12:00:00.000Z",
        changePath: "docs/tasks/abc-120-provision-database",
        source: {
          provider: "linear",
          id: "lin_abc_120",
          ref: "ABC-120",
          url: "https://linear.app/acme/issue/ABC-120/provision-database",
        },
        dependencyImported: true,
      },
      [
        "",
        "## Description",
        "Imported from Linear",
        "",
        "## Requirements",
        "- Review the ticket",
        "",
        "## Acceptance Criteria",
        "- [ ] Match the Linear intent",
        "",
      ].join("\n"),
    );

    await reconcileRepo(repo, {
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
      linearStore: ctx.linearStore,
    });

    expect(await ctx.linearStore.getTaskSourceByExternalId("repo-1", "lin_abc_123")).toMatchObject({
      task_id: "task-root",
      external_ref: "ABC-123",
    });
    expect(await ctx.linearStore.getTaskSourceByExternalId("repo-1", "lin_abc_120")).toMatchObject({
      task_id: "task-blocker",
      external_ref: "ABC-120",
    });
    expect(await ctx.linearStore.listTaskDependencies("task-root")).toMatchObject([
      {
        task_id: "task-root",
        depends_on_task_id: "task-blocker",
        source: "linear_blocks",
      },
    ]);
  });
});
