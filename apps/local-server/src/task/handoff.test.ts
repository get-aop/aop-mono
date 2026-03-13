import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { join } from "node:path";
import { GitManager, WorktreeNotFoundError } from "@aop/git-manager";
import { useTestAopHome } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import { createCommandContext } from "../context.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { handoffCompletedTask } from "./handoff.ts";

describe("handoffCompletedTask", () => {
  let cleanupAopHome: () => void;

  beforeEach(() => {
    cleanupAopHome = useTestAopHome();
  });

  afterEach(() => {
    mock.restore();
    cleanupAopHome();
  });

  test("clears worktree_path when the worktree is already gone", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);

    await createTestRepo(db, "repo-1", "/tmp/aop-handoff-repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");
    await ctx.taskRepository.update("task-1", {
      worktree_path: "/tmp/aop/worktrees/task-1",
    });

    const initSpy = spyOn(GitManager.prototype, "init").mockResolvedValue(undefined);
    const handoffSpy = spyOn(GitManager.prototype, "handoffWorktree").mockRejectedValue(
      new WorktreeNotFoundError("task-1"),
    );

    await expect(handoffCompletedTask(ctx, "task-1")).resolves.toBeNull();

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(handoffSpy).toHaveBeenCalledTimes(1);
    expect((await ctx.taskRepository.get("task-1"))?.worktree_path).toBeNull();
  });

  test("hands off code changes even when task docs changed outside the worktree", async () => {
    const db = await createTestDb();
    const commandCtx = createCommandContext(db);

    await createTestRepo(db, "repo-2", "/tmp/aop-handoff-integration");
    const repoRecord = await commandCtx.repoRepository.getById("repo-2");
    expect(repoRecord).not.toBeNull();
    if (!repoRecord) {
      throw new Error("repo-2 not found");
    }
    const repo = {
      id: repoRecord.id,
      path: repoRecord.path,
    };

    await Bun.$`mkdir -p docs/tasks/benchmark-filter-by-tag src`.cwd(repo.path).quiet();
    await Bun.write(
      join(repo.path, "docs", "tasks", "benchmark-filter-by-tag", "task.md"),
      "---\ntitle: Benchmark Filter By Tag\nstatus: DONE\n---\n",
    );
    await Bun.write(join(repo.path, "src", "notes.ts"), "export const value = 1;\n");
    await Bun.$`git add docs/tasks/benchmark-filter-by-tag/task.md src/notes.ts`
      .cwd(repo.path)
      .quiet();
    await Bun.$`git commit -m "add benchmark fixture files"`.cwd(repo.path).quiet();

    const gitManager = new GitManager({ repoPath: repo.path, repoId: repo.id });
    await gitManager.init();
    const worktree = await gitManager.createWorktree(
      "task-2",
      "main",
      "benchmark-filter-by-tag",
    );

    let task = {
      id: "task-2",
      repo_id: repo.id,
      change_path: "docs/tasks/benchmark-filter-by-tag",
      status: "DONE",
      worktree_path: worktree.path,
      ready_at: null,
      preferred_workflow: null,
      base_branch: null,
      preferred_provider: null,
      retry_from_step: null,
      resume_input: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as const;

    const ctx = {
      taskRepository: {
        get: async (taskId: string) => (taskId === task.id ? task : null),
        update: async (taskId: string, patch: Record<string, unknown>) => {
          if (taskId !== task.id) {
            return null;
          }

          task = {
            ...task,
            ...patch,
            updated_at: new Date().toISOString(),
          };
          return task;
        },
      },
      repoRepository: {
        getById: async (repoId: string) => (repoId === repo.id ? repo : null),
      },
    } as unknown as LocalServerContext;

    await Bun.write(join(worktree.path, "src", "notes.ts"), "export const value = 2;\n");
    await Bun.write(
      join(worktree.path, "docs", "tasks", "benchmark-filter-by-tag", "task.md"),
      "---\ntitle: Benchmark Filter By Tag\nstatus: DONE\n---\n",
    );
    await Bun.write(
      join(worktree.path, "docs", "tasks", "benchmark-filter-by-tag", "plan.md"),
      "# Worktree plan\n",
    );

    await Bun.write(
      join(repo.path, "docs", "tasks", "benchmark-filter-by-tag", "task.md"),
      "---\ntitle: Benchmark Filter By Tag\nstatus: DONE\n---\n",
    );
    await Bun.write(
      join(repo.path, "docs", "tasks", "benchmark-filter-by-tag", "plan.md"),
      "# Source repo plan\n",
    );

    await expect(handoffCompletedTask(ctx, "task-2")).resolves.toEqual({
      branch: "benchmark-filter-by-tag",
      commitSha: expect.stringMatching(/^[a-f0-9]{40}$/),
    });

    expect((await Bun.file(join(repo.path, "src", "notes.ts")).text()).trim()).toBe(
      "export const value = 2;",
    );
    expect((await Bun.file(join(repo.path, "docs", "tasks", "benchmark-filter-by-tag", "plan.md")).text()).trim()).toBe(
      "# Source repo plan",
    );
    expect((await ctx.taskRepository.get("task-2"))?.worktree_path).toBeNull();
  });
});
