import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../../context.ts";
import type { Database, Repo } from "../../db/schema.ts";
import { createTestDb, createTestRepo } from "../../db/test-utils.ts";
import { reconcileAllRepos, reconcileRepo } from "./reconcile.ts";

describe("reconcile", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  const repoId = "repo-reconcile-1";
  let repoPath: string;

  const getRepo = async (id: string): Promise<Repo> => {
    const repo = await ctx.repoRepository.getById(id);
    if (!repo) throw new Error(`Test setup error: repo ${id} not found`);
    return repo;
  };

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    repoPath = `/tmp/aop-test-reconcile-repo-${Date.now()}`;
    mkdirSync(repoPath, { recursive: true });
    await createTestRepo(db, repoId, repoPath);

    mkdirSync(aopPaths.openspecChanges(repoId), { recursive: true });
  });

  afterEach(async () => {
    await db.destroy();
    rmSync(repoPath, { recursive: true, force: true });
    rmSync(aopPaths.repoDir(repoId), { recursive: true, force: true });
  });

  test("creates tasks for changes at global path", async () => {
    const changePath = join(aopPaths.openspecChanges(repoId), "feat-1");
    mkdirSync(changePath, { recursive: true });
    writeFileSync(join(changePath, "proposal.md"), "# Feature 1");

    const repo = await getRepo(repoId);
    const result = await reconcileRepo(repo, {
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
    });

    expect(result.created).toBe(1);
    const tasks = await ctx.taskRepository.list({ repo_id: repoId, excludeRemoved: true });
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.change_path).toBe("openspec/changes/feat-1");
  });

  test("removes orphaned tasks when change directory is deleted", async () => {
    const changePath = join(aopPaths.openspecChanges(repoId), "feat-gone");
    mkdirSync(changePath, { recursive: true });

    const repo = await getRepo(repoId);
    const deps = { repoRepository: ctx.repoRepository, taskRepository: ctx.taskRepository };

    // First reconcile creates the task
    await reconcileRepo(repo, deps);

    // Delete the change
    rmSync(changePath, { recursive: true });

    // Second reconcile removes the task
    const result = await reconcileRepo(repo, deps);
    expect(result.removed).toBe(1);
  });

  test("ignores archive folder", async () => {
    const archivePath = join(aopPaths.openspecChanges(repoId), "archive");
    mkdirSync(archivePath, { recursive: true });

    const repo = await getRepo(repoId);
    const result = await reconcileRepo(repo, {
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
    });

    expect(result.created).toBe(0);
  });

  test("handles missing global changes directory gracefully", async () => {
    rmSync(aopPaths.openspecChanges(repoId), { recursive: true, force: true });

    const repo = await getRepo(repoId);
    const result = await reconcileRepo(repo, {
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
    });

    expect(result.created).toBe(0);
    expect(result.removed).toBe(0);
  });

  describe("reconcileAllRepos", () => {
    const repoId2 = "repo-reconcile-2";
    let repoPath2: string;

    beforeEach(async () => {
      repoPath2 = `/tmp/aop-test-reconcile-repo2-${Date.now()}`;
      mkdirSync(repoPath2, { recursive: true });
      await createTestRepo(db, repoId2, repoPath2);
      mkdirSync(aopPaths.openspecChanges(repoId2), { recursive: true });
    });

    afterEach(() => {
      rmSync(repoPath2, { recursive: true, force: true });
      rmSync(aopPaths.repoDir(repoId2), { recursive: true, force: true });
    });

    test("aggregates results across multiple repos", async () => {
      // Add a change to each repo
      const change1 = join(aopPaths.openspecChanges(repoId), "feat-a");
      mkdirSync(change1, { recursive: true });
      writeFileSync(join(change1, "proposal.md"), "# A");

      const change2 = join(aopPaths.openspecChanges(repoId2), "feat-b");
      mkdirSync(change2, { recursive: true });
      writeFileSync(join(change2, "proposal.md"), "# B");

      const deps = { repoRepository: ctx.repoRepository, taskRepository: ctx.taskRepository };
      const result = await reconcileAllRepos(deps);

      expect(result.created).toBe(2);
      expect(result.removed).toBe(0);
    });

    test("returns zero counts when no repos have changes", async () => {
      const deps = { repoRepository: ctx.repoRepository, taskRepository: ctx.taskRepository };
      const result = await reconcileAllRepos(deps);

      expect(result.created).toBe(0);
      expect(result.removed).toBe(0);
    });
  });
});
