import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import {
  createSubtaskWorktree,
  createTaskWorktree,
  deleteWorktree,
  getCurrentBranch,
  listWorktrees,
  mergeSubtaskIntoTask
} from "../src/core/git";
import {
  getReadySubtasks,
  listSubtasks
} from "../src/migration/subtask-parser";
import { createTestDir } from "../src/test-helpers";

const FIXTURES_DIR = join(import.meta.dir, "fixtures");

interface TestRepo {
  path: string;
  devsfactoryDir: string;
}

const createTestRepo = async (): Promise<TestRepo> => {
  const tempDir = await createTestDir("e2e-git-worktree");

  await Bun.$`git init -b main ${tempDir}`.quiet();
  await Bun.$`git -C ${tempDir} config user.email "test@test.com"`.quiet();
  await Bun.$`git -C ${tempDir} config user.name "Test User"`.quiet();

  await Bun.$`touch ${tempDir}/README.md`.quiet();
  await Bun.$`git -C ${tempDir} add .`.quiet();
  await Bun.$`git -C ${tempDir} commit -m "Initial commit"`.quiet();

  const devsfactoryDir = join(tempDir, ".devsfactory");
  await Bun.$`mkdir -p ${devsfactoryDir}`.quiet();

  return { path: tempDir, devsfactoryDir };
};

const cleanupTestRepo = async (repo: TestRepo): Promise<void> => {
  const worktrees = await listWorktrees(repo.path);
  for (const wt of worktrees) {
    if (wt !== repo.path) {
      await deleteWorktree(repo.path, wt);
    }
  }
};

const copyFixture = async (
  fixtureName: string,
  repo: TestRepo
): Promise<string> => {
  const src = join(FIXTURES_DIR, fixtureName);
  const dest = join(repo.devsfactoryDir, fixtureName);
  await cp(src, dest, { recursive: true });

  await Bun.$`git -C ${repo.path} add .`.quiet();
  await Bun.$`git -C ${repo.path} commit -m "Add ${fixtureName} fixture"`.quiet();

  return fixtureName;
};

describe("Git Worktree E2E Tests", () => {
  describe("Linear Dependency Chain", () => {
    let repo: TestRepo;
    let taskFolder: string;

    beforeAll(async () => {
      repo = await createTestRepo();
      taskFolder = await copyFixture("sample-task", repo);
    });

    afterAll(async () => {
      await cleanupTestRepo(repo);
    });

    test("creates task worktree from main branch", async () => {
      const worktreePath = await createTaskWorktree(repo.path, taskFolder);

      expect(worktreePath).toBe(join(repo.path, ".worktrees", taskFolder));

      const branch = await getCurrentBranch(worktreePath);
      expect(branch).toBe(`task/${taskFolder}`);

      const worktrees = await listWorktrees(repo.path);
      expect(worktrees).toContain(worktreePath);

      const taskFileExists = await Bun.file(
        join(worktreePath, ".devsfactory", taskFolder, "task.md")
      ).exists();
      expect(taskFileExists).toBe(true);
    });

    test("creates subtask worktree branched from task", async () => {
      const subtaskSlug = "001-setup-base";
      const subtaskWorktreePath = await createSubtaskWorktree(
        repo.path,
        taskFolder,
        subtaskSlug
      );

      expect(subtaskWorktreePath).toBe(
        join(repo.path, ".worktrees", `${taskFolder}--${subtaskSlug}`)
      );

      const branch = await getCurrentBranch(subtaskWorktreePath);
      expect(branch).toBe(`task/${taskFolder}--${subtaskSlug}`);
    });

    test("simulates subtask work and merges back to task", async () => {
      const subtaskSlug = "001-setup-base";
      const subtaskWorktreePath = join(
        repo.path,
        ".worktrees",
        `${taskFolder}--${subtaskSlug}`
      );

      const newFile = join(subtaskWorktreePath, "base-setup.txt");
      await Bun.write(newFile, "Base infrastructure setup complete");
      await Bun.$`git -C ${subtaskWorktreePath} add .`.quiet();
      await Bun.$`git -C ${subtaskWorktreePath} commit -m "Complete base setup"`.quiet();

      const result = await mergeSubtaskIntoTask(
        repo.path,
        taskFolder,
        subtaskSlug
      );

      expect(result.success).toBe(true);
      expect(result.commitSha).toBeDefined();

      const taskWorktreePath = join(repo.path, ".worktrees", taskFolder);
      const mergedFileExists = await Bun.file(
        join(taskWorktreePath, "base-setup.txt")
      ).exists();
      expect(mergedFileExists).toBe(true);
    });

    test("deletes subtask worktree after merge", async () => {
      const subtaskSlug = "001-setup-base";
      const subtaskWorktreePath = join(
        repo.path,
        ".worktrees",
        `${taskFolder}--${subtaskSlug}`
      );

      await deleteWorktree(repo.path, subtaskWorktreePath);

      const worktrees = await listWorktrees(repo.path);
      expect(worktrees).not.toContain(subtaskWorktreePath);
    });

    test("creates dependent subtask from updated task branch", async () => {
      const subtaskSlug = "002-add-feature";
      const subtaskWorktreePath = await createSubtaskWorktree(
        repo.path,
        taskFolder,
        subtaskSlug
      );

      const inheritedFile = await Bun.file(
        join(subtaskWorktreePath, "base-setup.txt")
      ).exists();
      expect(inheritedFile).toBe(true);

      await Bun.write(
        join(subtaskWorktreePath, "feature.txt"),
        "Main feature added"
      );
      await Bun.$`git -C ${subtaskWorktreePath} add .`.quiet();
      await Bun.$`git -C ${subtaskWorktreePath} commit -m "Add main feature"`.quiet();

      const mergeResult = await mergeSubtaskIntoTask(
        repo.path,
        taskFolder,
        subtaskSlug
      );
      expect(mergeResult.success).toBe(true);

      await deleteWorktree(repo.path, subtaskWorktreePath);
    });

    test("final subtask inherits all previous changes", async () => {
      const subtaskSlug = "003-integrate-feature";
      const subtaskWorktreePath = await createSubtaskWorktree(
        repo.path,
        taskFolder,
        subtaskSlug
      );

      const baseFile = await Bun.file(
        join(subtaskWorktreePath, "base-setup.txt")
      ).exists();
      const featureFile = await Bun.file(
        join(subtaskWorktreePath, "feature.txt")
      ).exists();
      expect(baseFile).toBe(true);
      expect(featureFile).toBe(true);

      await Bun.write(
        join(subtaskWorktreePath, "integration.txt"),
        "Full integration complete"
      );
      await Bun.$`git -C ${subtaskWorktreePath} add .`.quiet();
      await Bun.$`git -C ${subtaskWorktreePath} commit -m "Complete integration"`.quiet();

      const mergeResult = await mergeSubtaskIntoTask(
        repo.path,
        taskFolder,
        subtaskSlug
      );
      expect(mergeResult.success).toBe(true);

      await deleteWorktree(repo.path, subtaskWorktreePath);
    });

    test("task worktree contains all merged changes", async () => {
      const taskWorktreePath = join(repo.path, ".worktrees", taskFolder);

      const files = ["base-setup.txt", "feature.txt", "integration.txt"];
      for (const file of files) {
        const exists = await Bun.file(join(taskWorktreePath, file)).exists();
        expect(exists).toBe(true);
      }
    });

    test("cleans up task worktree", async () => {
      const taskWorktreePath = join(repo.path, ".worktrees", taskFolder);

      await deleteWorktree(repo.path, taskWorktreePath);

      const worktrees = await listWorktrees(repo.path);
      expect(worktrees).not.toContain(taskWorktreePath);
      expect(worktrees).toHaveLength(1); // Only main worktree remains
    });
  });

  describe("Diamond Dependency Pattern", () => {
    let repo: TestRepo;
    let taskFolder: string;

    beforeAll(async () => {
      repo = await createTestRepo();
      taskFolder = await copyFixture("diamond-deps-task", repo);
    });

    afterAll(async () => {
      await cleanupTestRepo(repo);
    });

    test("creates task worktree for diamond pattern", async () => {
      const worktreePath = await createTaskWorktree(repo.path, taskFolder);
      expect(worktreePath).toBe(join(repo.path, ".worktrees", taskFolder));
    });

    test("completes base subtask (001)", async () => {
      const slug = "001-base-setup";
      const worktreePath = await createSubtaskWorktree(
        repo.path,
        taskFolder,
        slug
      );

      await Bun.write(join(worktreePath, "base.txt"), "Base completed");
      await Bun.$`git -C ${worktreePath} add .`.quiet();
      await Bun.$`git -C ${worktreePath} commit -m "Complete base"`.quiet();

      const result = await mergeSubtaskIntoTask(repo.path, taskFolder, slug);
      expect(result.success).toBe(true);

      await deleteWorktree(repo.path, worktreePath);
    });

    test("creates parallel worktrees for left and right branches", async () => {
      const leftSlug = "002-left-branch";
      const rightSlug = "003-right-branch";

      const leftPath = await createSubtaskWorktree(
        repo.path,
        taskFolder,
        leftSlug
      );
      const rightPath = await createSubtaskWorktree(
        repo.path,
        taskFolder,
        rightSlug
      );

      const worktrees = await listWorktrees(repo.path);
      expect(worktrees).toContain(leftPath);
      expect(worktrees).toContain(rightPath);

      const leftBase = await Bun.file(join(leftPath, "base.txt")).exists();
      const rightBase = await Bun.file(join(rightPath, "base.txt")).exists();
      expect(leftBase).toBe(true);
      expect(rightBase).toBe(true);
    });

    test("parallel branches can make independent changes", async () => {
      const leftPath = join(
        repo.path,
        ".worktrees",
        `${taskFolder}--002-left-branch`
      );
      const rightPath = join(
        repo.path,
        ".worktrees",
        `${taskFolder}--003-right-branch`
      );

      await Bun.write(
        join(leftPath, "left-feature.txt"),
        "Left branch feature"
      );
      await Bun.$`git -C ${leftPath} add .`.quiet();
      await Bun.$`git -C ${leftPath} commit -m "Add left feature"`.quiet();

      await Bun.write(
        join(rightPath, "right-feature.txt"),
        "Right branch feature"
      );
      await Bun.$`git -C ${rightPath} add .`.quiet();
      await Bun.$`git -C ${rightPath} commit -m "Add right feature"`.quiet();
    });

    test("merges left branch into task", async () => {
      const result = await mergeSubtaskIntoTask(
        repo.path,
        taskFolder,
        "002-left-branch"
      );
      expect(result.success).toBe(true);

      const taskPath = join(repo.path, ".worktrees", taskFolder);
      const leftFeature = await Bun.file(
        join(taskPath, "left-feature.txt")
      ).exists();
      expect(leftFeature).toBe(true);

      await deleteWorktree(
        repo.path,
        join(repo.path, ".worktrees", `${taskFolder}--002-left-branch`)
      );
    });

    test("merges right branch into task", async () => {
      const result = await mergeSubtaskIntoTask(
        repo.path,
        taskFolder,
        "003-right-branch"
      );
      expect(result.success).toBe(true);

      const taskPath = join(repo.path, ".worktrees", taskFolder);
      const leftFeature = await Bun.file(
        join(taskPath, "left-feature.txt")
      ).exists();
      const rightFeature = await Bun.file(
        join(taskPath, "right-feature.txt")
      ).exists();
      expect(leftFeature).toBe(true);
      expect(rightFeature).toBe(true);

      await deleteWorktree(
        repo.path,
        join(repo.path, ".worktrees", `${taskFolder}--003-right-branch`)
      );
    });

    test("final subtask has all changes from both branches", async () => {
      const slug = "004-final-integration";
      const worktreePath = await createSubtaskWorktree(
        repo.path,
        taskFolder,
        slug
      );

      const base = await Bun.file(join(worktreePath, "base.txt")).exists();
      const left = await Bun.file(
        join(worktreePath, "left-feature.txt")
      ).exists();
      const right = await Bun.file(
        join(worktreePath, "right-feature.txt")
      ).exists();

      expect(base).toBe(true);
      expect(left).toBe(true);
      expect(right).toBe(true);

      await Bun.write(join(worktreePath, "final.txt"), "Diamond complete");
      await Bun.$`git -C ${worktreePath} add .`.quiet();
      await Bun.$`git -C ${worktreePath} commit -m "Complete diamond"`.quiet();

      const result = await mergeSubtaskIntoTask(repo.path, taskFolder, slug);
      expect(result.success).toBe(true);

      await deleteWorktree(repo.path, worktreePath);
    });

    test("task worktree has complete diamond result", async () => {
      const taskPath = join(repo.path, ".worktrees", taskFolder);

      const files = [
        "base.txt",
        "left-feature.txt",
        "right-feature.txt",
        "final.txt"
      ];
      for (const file of files) {
        const exists = await Bun.file(join(taskPath, file)).exists();
        expect(exists).toBe(true);
      }

      await deleteWorktree(repo.path, taskPath);
    });
  });

  describe("Error Handling and Edge Cases", () => {
    let repo: TestRepo;

    beforeEach(async () => {
      repo = await createTestRepo();
    });

    afterEach(async () => {
      await cleanupTestRepo(repo);
    });

    test("handles merge conflict gracefully", async () => {
      const taskFolder = "conflict-task";
      await Bun.$`mkdir -p ${repo.devsfactoryDir}/${taskFolder}`.quiet();
      await Bun.write(
        join(repo.devsfactoryDir, taskFolder, "task.md"),
        "# Conflict task"
      );
      await Bun.$`git -C ${repo.path} add .`.quiet();
      await Bun.$`git -C ${repo.path} commit -m "Add conflict task"`.quiet();

      const taskPath = await createTaskWorktree(repo.path, taskFolder);
      const subtaskPath = await createSubtaskWorktree(
        repo.path,
        taskFolder,
        "conflict-subtask"
      );

      await Bun.write(join(taskPath, "conflict.txt"), "Task content");
      await Bun.$`git -C ${taskPath} add .`.quiet();
      await Bun.$`git -C ${taskPath} commit -m "Task change"`.quiet();

      await Bun.write(join(subtaskPath, "conflict.txt"), "Subtask content");
      await Bun.$`git -C ${subtaskPath} add .`.quiet();
      await Bun.$`git -C ${subtaskPath} commit -m "Subtask change"`.quiet();

      const result = await mergeSubtaskIntoTask(
        repo.path,
        taskFolder,
        "conflict-subtask"
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test("recreates worktree for existing branch", async () => {
      const taskFolder = "recreate-task";
      await Bun.$`mkdir -p ${repo.devsfactoryDir}/${taskFolder}`.quiet();
      await Bun.write(
        join(repo.devsfactoryDir, taskFolder, "task.md"),
        "# Recreate task"
      );
      await Bun.$`git -C ${repo.path} add .`.quiet();
      await Bun.$`git -C ${repo.path} commit -m "Add recreate task"`.quiet();

      const firstPath = await createTaskWorktree(repo.path, taskFolder);

      await Bun.write(join(firstPath, "work.txt"), "Some work");
      await Bun.$`git -C ${firstPath} add .`.quiet();
      await Bun.$`git -C ${firstPath} commit -m "Add work"`.quiet();

      await deleteWorktree(repo.path, firstPath);

      const secondPath = await createTaskWorktree(repo.path, taskFolder);
      expect(secondPath).toBe(firstPath);

      const workExists = await Bun.file(join(secondPath, "work.txt")).exists();
      expect(workExists).toBe(true);
    });

    test("handles non-existent worktree deletion gracefully", async () => {
      const fakePath = join(repo.path, ".worktrees", "does-not-exist");

      await expect(
        deleteWorktree(repo.path, fakePath)
      ).resolves.toBeUndefined();
    });

    test("lists only valid worktrees", async () => {
      const taskFolder = "list-test";
      await Bun.$`mkdir -p ${repo.devsfactoryDir}/${taskFolder}`.quiet();
      await Bun.write(
        join(repo.devsfactoryDir, taskFolder, "task.md"),
        "# List test task"
      );
      await Bun.$`git -C ${repo.path} add .`.quiet();
      await Bun.$`git -C ${repo.path} commit -m "Add list test task"`.quiet();

      await createTaskWorktree(repo.path, taskFolder);
      await createSubtaskWorktree(repo.path, taskFolder, "sub1");
      await createSubtaskWorktree(repo.path, taskFolder, "sub2");

      const worktrees = await listWorktrees(repo.path);

      expect(worktrees).toContain(repo.path);
      expect(worktrees).toContain(join(repo.path, ".worktrees", taskFolder));
      expect(worktrees).toContain(
        join(repo.path, ".worktrees", `${taskFolder}--sub1`)
      );
      expect(worktrees).toContain(
        join(repo.path, ".worktrees", `${taskFolder}--sub2`)
      );
      expect(worktrees).toHaveLength(4);
    });
  });

  describe("Subtask Parser Integration", () => {
    let repo: TestRepo;
    let taskFolder: string;

    beforeAll(async () => {
      repo = await createTestRepo();
      taskFolder = await copyFixture("sample-task", repo);
    });

    afterAll(async () => {
      await cleanupTestRepo(repo);
    });

    test("lists subtasks from fixture", async () => {
      const subtasks = await listSubtasks(taskFolder, repo.devsfactoryDir);

      expect(subtasks).toHaveLength(3);
      expect(subtasks[0]!.number).toBe(1);
      expect(subtasks[1]!.number).toBe(2);
      expect(subtasks[2]!.number).toBe(3);
    });

    test("identifies ready subtasks based on dependencies", async () => {
      const ready = await getReadySubtasks(taskFolder, repo.devsfactoryDir);

      expect(ready).toHaveLength(1);
      expect(ready[0]!.slug).toBe("setup-base");
    });

    test("parses subtask dependencies correctly", async () => {
      const subtasks = await listSubtasks(taskFolder, repo.devsfactoryDir);

      const sub1 = subtasks.find((s) => s.number === 1)!;
      const sub2 = subtasks.find((s) => s.number === 2)!;
      const sub3 = subtasks.find((s) => s.number === 3)!;

      expect(sub1.frontmatter.dependencies).toEqual([]);
      expect(sub2.frontmatter.dependencies).toEqual([1]);
      expect(sub3.frontmatter.dependencies).toEqual([1, 2]);
    });
  });

  describe("Full Workflow Simulation", () => {
    let repo: TestRepo;
    let taskFolder: string;

    beforeAll(async () => {
      repo = await createTestRepo();
      taskFolder = await copyFixture("sample-task", repo);
    });

    afterAll(async () => {
      await cleanupTestRepo(repo);
    });

    test("simulates complete task execution workflow", async () => {
      // 1. Create task worktree
      const taskPath = await createTaskWorktree(repo.path, taskFolder);
      expect(await getCurrentBranch(taskPath)).toBe(`task/${taskFolder}`);

      // 2. Get ready subtasks (only 001 should be ready initially)
      const ready = await getReadySubtasks(taskFolder, repo.devsfactoryDir);
      expect(ready).toHaveLength(1);
      expect(ready[0]!.number).toBe(1);

      // 3. Process subtask 001
      const sub1Path = await createSubtaskWorktree(
        repo.path,
        taskFolder,
        ready[0]!.slug
      );
      await Bun.write(join(sub1Path, "sub1-work.txt"), "Subtask 1 complete");
      await Bun.$`git -C ${sub1Path} add . && git -C ${sub1Path} commit -m "Complete subtask 1"`.quiet();

      let mergeResult = await mergeSubtaskIntoTask(
        repo.path,
        taskFolder,
        ready[0]!.slug
      );
      expect(mergeResult.success).toBe(true);
      await deleteWorktree(repo.path, sub1Path);

      // 4. Simulate marking subtask 001 as DONE and check ready subtasks
      // (In real workflow, status would be updated. Here we manually verify the next would be 002)

      // 5. Process subtask 002 (depends on 001)
      const sub2Path = await createSubtaskWorktree(
        repo.path,
        taskFolder,
        "add-feature"
      );
      const sub1WorkExists = await Bun.file(
        join(sub2Path, "sub1-work.txt")
      ).exists();
      expect(sub1WorkExists).toBe(true);

      await Bun.write(join(sub2Path, "sub2-work.txt"), "Subtask 2 complete");
      await Bun.$`git -C ${sub2Path} add . && git -C ${sub2Path} commit -m "Complete subtask 2"`.quiet();

      mergeResult = await mergeSubtaskIntoTask(
        repo.path,
        taskFolder,
        "add-feature"
      );
      expect(mergeResult.success).toBe(true);
      await deleteWorktree(repo.path, sub2Path);

      // 6. Process subtask 003 (depends on 001 and 002)
      const sub3Path = await createSubtaskWorktree(
        repo.path,
        taskFolder,
        "integrate-feature"
      );
      expect(await Bun.file(join(sub3Path, "sub1-work.txt")).exists()).toBe(
        true
      );
      expect(await Bun.file(join(sub3Path, "sub2-work.txt")).exists()).toBe(
        true
      );

      await Bun.write(join(sub3Path, "sub3-work.txt"), "Subtask 3 complete");
      await Bun.$`git -C ${sub3Path} add . && git -C ${sub3Path} commit -m "Complete subtask 3"`.quiet();

      mergeResult = await mergeSubtaskIntoTask(
        repo.path,
        taskFolder,
        "integrate-feature"
      );
      expect(mergeResult.success).toBe(true);
      await deleteWorktree(repo.path, sub3Path);

      // 7. Verify task worktree has all work
      const allFiles = ["sub1-work.txt", "sub2-work.txt", "sub3-work.txt"];
      for (const file of allFiles) {
        expect(await Bun.file(join(taskPath, file)).exists()).toBe(true);
      }

      // 8. Cleanup task worktree
      await deleteWorktree(repo.path, taskPath);

      const remainingWorktrees = await listWorktrees(repo.path);
      expect(remainingWorktrees).toHaveLength(1);
      expect(remainingWorktrees[0]).toBe(repo.path);
    });
  });
});
