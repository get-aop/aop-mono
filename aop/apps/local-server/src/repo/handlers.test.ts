import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import {
  getRepoById,
  getRepoTasks,
  initRepo,
  removeRepo,
  setupOpenspecSymlink,
} from "./handlers.ts";

describe("repo/handlers", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  describe("initRepo", () => {
    let testRepoPath: string;

    beforeEach(async () => {
      testRepoPath = join(tmpdir(), `aop-test-repo-${Date.now()}`);
      mkdirSync(testRepoPath, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(testRepoPath)) {
        rmSync(testRepoPath, { recursive: true });
      }
    });

    test("returns error when path is not a git repo", async () => {
      const result = await initRepo(ctx, testRepoPath);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_A_GIT_REPO");
        expect(result.error.path).toBe(testRepoPath);
      }
    });

    test("creates new repo for valid git repository", async () => {
      const proc = Bun.spawn(["git", "init"], { cwd: testRepoPath });
      await proc.exited;

      const result = await initRepo(ctx, testRepoPath);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.repoId).toMatch(/^repo_/);
        expect(result.alreadyExists).toBe(false);
      }

      const repo = await ctx.repoRepository.getByPath(testRepoPath);
      expect(repo).not.toBeNull();
      expect(repo?.path).toBe(testRepoPath);
    });

    test("returns existing repo when already registered", async () => {
      const proc = Bun.spawn(["git", "init"], { cwd: testRepoPath });
      await proc.exited;

      const firstResult = await initRepo(ctx, testRepoPath);
      expect(firstResult.success).toBe(true);

      const secondResult = await initRepo(ctx, testRepoPath);

      expect(secondResult.success).toBe(true);
      if (secondResult.success && firstResult.success) {
        expect(secondResult.repoId).toBe(firstResult.repoId);
        expect(secondResult.alreadyExists).toBe(true);
      }
    });

    test("extracts repo name from path", async () => {
      const namedPath = join(tmpdir(), `aop-test-repo-name-${Date.now()}`, "my-project");
      mkdirSync(namedPath, { recursive: true });
      const proc = Bun.spawn(["git", "init"], { cwd: namedPath });
      await proc.exited;

      await initRepo(ctx, namedPath);

      const repo = await ctx.repoRepository.getByPath(namedPath);
      expect(repo?.name).toBe("my-project");

      rmSync(join(tmpdir(), `aop-test-repo-name-${Date.now().toString().slice(0, -3)}`), {
        recursive: true,
        force: true,
      });
    });

    test("creates global directory structure after registration", async () => {
      const proc = Bun.spawn(["git", "init"], { cwd: testRepoPath });
      await proc.exited;

      const result = await initRepo(ctx, testRepoPath);
      expect(result.success).toBe(true);

      if (result.success) {
        const repoId = result.repoId;
        expect(existsSync(aopPaths.openspecChanges(repoId))).toBe(true);
        expect(existsSync(aopPaths.worktrees(repoId))).toBe(true);
        expect(existsSync(aopPaths.worktreeMetadata(repoId))).toBe(true);
      }
    });

    test("creates openspec symlink pointing to global path", async () => {
      const proc = Bun.spawn(["git", "init"], { cwd: testRepoPath });
      await proc.exited;

      const result = await initRepo(ctx, testRepoPath);
      expect(result.success).toBe(true);

      if (result.success) {
        const repoId = result.repoId;
        const symlinkPath = join(testRepoPath, "openspec");

        expect(existsSync(symlinkPath)).toBe(true);
        expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
        expect(readlinkSync(symlinkPath)).toBe(aopPaths.openspec(repoId));
      }
    });

    test("adds openspec to .git/info/exclude", async () => {
      const proc = Bun.spawn(["git", "init"], { cwd: testRepoPath });
      await proc.exited;

      const result = await initRepo(ctx, testRepoPath);
      expect(result.success).toBe(true);

      if (result.success) {
        const excludePath = join(testRepoPath, ".git", "info", "exclude");
        const content = readFileSync(excludePath, "utf-8");
        expect(content).toContain("openspec");
      }
    });

    test("handles non-existent path", async () => {
      const nonExistentPath = join(tmpdir(), `does-not-exist-${Date.now()}`);

      const result = await initRepo(ctx, nonExistentPath);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_A_GIT_REPO");
      }
    });
  });

  describe("removeRepo", () => {
    test("returns error when repo not found", async () => {
      const result = await removeRepo(ctx, "/non/existent/path");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
        expect((result.error as { path: string }).path).toBe("/non/existent/path");
      }
    });

    test("removes repo without tasks", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");

      const result = await removeRepo(ctx, "/test/repo");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.repoId).toBe("repo-1");
        expect(result.abortedTasks).toBe(0);
      }

      const repo = await ctx.repoRepository.getByPath("/test/repo");
      expect(repo).toBeNull();
    });

    test("returns error when repo has working tasks without force", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      const result = await removeRepo(ctx, "/test/repo");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("HAS_WORKING_TASKS");
        expect((result.error as { count: number }).count).toBe(1);
      }
    });

    test("aborts working tasks when force is true", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "WORKING");

      const result = await removeRepo(ctx, "/test/repo", { force: true });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.abortedTasks).toBe(2);
      }
    });

    test("removes repo with non-working tasks", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "READY");

      const result = await removeRepo(ctx, "/test/repo");

      expect(result.success).toBe(true);
    });
  });

  describe("getRepoById", () => {
    test("returns repo when found", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");

      const repo = await getRepoById(ctx, "repo-1");

      expect(repo).not.toBeNull();
      expect(repo?.id).toBe("repo-1");
      expect(repo?.path).toBe("/test/repo");
    });

    test("returns null when repo not found", async () => {
      const repo = await getRepoById(ctx, "non-existent");

      expect(repo).toBeNull();
    });
  });

  describe("getRepoTasks", () => {
    test("returns tasks for repo", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "READY");

      const tasks = await getRepoTasks(ctx, "repo-1");

      expect(tasks).toHaveLength(2);
    });

    test("excludes REMOVED tasks", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "REMOVED");

      const tasks = await getRepoTasks(ctx, "repo-1");

      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.id).toBe("task-1");
    });

    test("returns empty array for repo with no tasks", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");

      const tasks = await getRepoTasks(ctx, "repo-1");

      expect(tasks).toEqual([]);
    });
  });

  describe("setupOpenspecSymlink", () => {
    const repoId = "repo-symlink-test";
    let repoPath: string;

    afterEach(() => {
      rmSync(repoPath, { recursive: true, force: true });
    });

    describe("standard mode (no tracked openspec files)", () => {
      beforeEach(() => {
        repoPath = join(tmpdir(), `aop-test-symlink-${Date.now()}`);
        mkdirSync(repoPath, { recursive: true });
        mkdirSync(join(repoPath, ".git", "info"), { recursive: true });
      });

      test("creates symlink from openspec to global path", async () => {
        await setupOpenspecSymlink(repoPath, repoId);

        const symlinkPath = join(repoPath, "openspec");
        expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
        expect(readlinkSync(symlinkPath)).toBe(aopPaths.openspec(repoId));
      });

      test("creates changes directory at global path", async () => {
        await setupOpenspecSymlink(repoPath, repoId);

        expect(existsSync(aopPaths.openspecChanges(repoId))).toBe(true);
      });

      test("is idempotent when symlink already exists", async () => {
        await setupOpenspecSymlink(repoPath, repoId);
        await setupOpenspecSymlink(repoPath, repoId);

        const symlinkPath = join(repoPath, "openspec");
        expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
      });

      test("relocates existing local openspec before creating symlink", async () => {
        const localChanges = join(repoPath, "openspec", "changes", "feat-existing");
        mkdirSync(localChanges, { recursive: true });
        writeFileSync(join(localChanges, "proposal.md"), "# Existing");

        await setupOpenspecSymlink(repoPath, repoId);

        const symlinkPath = join(repoPath, "openspec");
        expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);

        const globalFile = join(aopPaths.openspecChanges(repoId), "feat-existing", "proposal.md");
        expect(existsSync(globalFile)).toBe(true);
        expect(readFileSync(globalFile, "utf-8")).toBe("# Existing");
      });

      test("does not overwrite existing global entries during relocation", async () => {
        const localChanges = join(repoPath, "openspec", "changes", "feat-dup");
        mkdirSync(localChanges, { recursive: true });
        writeFileSync(join(localChanges, "proposal.md"), "LOCAL VERSION");

        mkdirSync(aopPaths.openspec(repoId), { recursive: true });
        const globalChanges = join(aopPaths.openspec(repoId), "changes");
        mkdirSync(join(globalChanges, "feat-dup"), { recursive: true });
        writeFileSync(join(globalChanges, "feat-dup", "proposal.md"), "GLOBAL VERSION");

        await setupOpenspecSymlink(repoPath, repoId);

        const content = readFileSync(join(globalChanges, "feat-dup", "proposal.md"), "utf-8");
        expect(content).toBe("GLOBAL VERSION");
      });

      test("writes through symlink land in global path", async () => {
        await setupOpenspecSymlink(repoPath, repoId);

        const localPath = join(repoPath, "openspec", "changes", "new-change");
        mkdirSync(localPath, { recursive: true });
        writeFileSync(join(localPath, "proposal.md"), "# New");

        const globalFile = join(aopPaths.openspecChanges(repoId), "new-change", "proposal.md");
        expect(existsSync(globalFile)).toBe(true);
        expect(readFileSync(globalFile, "utf-8")).toBe("# New");
      });

      test("adds openspec to .git/info/exclude", async () => {
        await setupOpenspecSymlink(repoPath, repoId);

        const excludePath = join(repoPath, ".git", "info", "exclude");
        const content = readFileSync(excludePath, "utf-8");
        expect(content).toContain("openspec");
      });

      test("does not duplicate entry in .git/info/exclude", async () => {
        await setupOpenspecSymlink(repoPath, repoId);

        rmSync(join(repoPath, "openspec"));
        await setupOpenspecSymlink(repoPath, repoId);

        const excludePath = join(repoPath, ".git", "info", "exclude");
        const content = readFileSync(excludePath, "utf-8");
        const matches = content.match(/openspec\n/g);
        expect(matches?.length).toBe(1);
      });
    });

    describe("native mode (repo has tracked openspec files)", () => {
      beforeEach(async () => {
        repoPath = join(tmpdir(), `aop-test-symlink-native-${Date.now()}`);
        mkdirSync(repoPath, { recursive: true });

        // Create a git repo with committed openspec files
        const init = Bun.spawn(["git", "init"], { cwd: repoPath });
        await init.exited;
        const configEmail = Bun.spawn(["git", "config", "user.email", "test@test.com"], {
          cwd: repoPath,
        });
        await configEmail.exited;
        const configName = Bun.spawn(["git", "config", "user.name", "Test"], { cwd: repoPath });
        await configName.exited;

        mkdirSync(join(repoPath, "openspec", "specs"), { recursive: true });
        writeFileSync(join(repoPath, "openspec", "config.yaml"), "version: 1");
        const add = Bun.spawn(["git", "add", "--force", "openspec/"], { cwd: repoPath });
        await add.exited;
        const commit = Bun.spawn(["git", "commit", "-m", "add openspec"], { cwd: repoPath });
        await commit.exited;
      });

      test("creates reverse symlink from global to local", async () => {
        await setupOpenspecSymlink(repoPath, repoId);

        const globalPath = aopPaths.openspec(repoId);
        expect(lstatSync(globalPath).isSymbolicLink()).toBe(true);
        expect(readlinkSync(globalPath)).toBe(join(repoPath, "openspec"));
      });

      test("local openspec remains a real directory", async () => {
        await setupOpenspecSymlink(repoPath, repoId);

        const localPath = join(repoPath, "openspec");
        expect(lstatSync(localPath).isSymbolicLink()).toBe(false);
        expect(lstatSync(localPath).isDirectory()).toBe(true);
      });

      test("creates local changes directory", async () => {
        await setupOpenspecSymlink(repoPath, repoId);

        expect(existsSync(join(repoPath, "openspec", "changes"))).toBe(true);
      });

      test("does not add anything to .git/info/exclude", async () => {
        await setupOpenspecSymlink(repoPath, repoId);

        const excludePath = join(repoPath, ".git", "info", "exclude");
        const content = existsSync(excludePath) ? readFileSync(excludePath, "utf-8") : "";
        expect(content).not.toContain("openspec");
      });

      test("preserves committed openspec files", async () => {
        await setupOpenspecSymlink(repoPath, repoId);

        expect(readFileSync(join(repoPath, "openspec", "config.yaml"), "utf-8")).toBe("version: 1");
        expect(existsSync(join(repoPath, "openspec", "specs"))).toBe(true);
      });

      test("watcher global path resolves to local changes", async () => {
        await setupOpenspecSymlink(repoPath, repoId);

        // Write a change in the local changes dir
        const changePath = join(repoPath, "openspec", "changes", "feat-native");
        mkdirSync(changePath, { recursive: true });
        writeFileSync(join(changePath, "proposal.md"), "# Native");

        // Should be visible through the global path (via reverse symlink)
        const globalFile = join(aopPaths.openspecChanges(repoId), "feat-native", "proposal.md");
        expect(existsSync(globalFile)).toBe(true);
        expect(readFileSync(globalFile, "utf-8")).toBe("# Native");
      });

      test("is idempotent when reverse symlink already exists", async () => {
        await setupOpenspecSymlink(repoPath, repoId);
        await setupOpenspecSymlink(repoPath, repoId);

        const globalPath = aopPaths.openspec(repoId);
        expect(lstatSync(globalPath).isSymbolicLink()).toBe(true);
      });
    });
  });
});
