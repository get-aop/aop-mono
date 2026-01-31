import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanupTestDir, createTestDir } from "../test-helpers";
import {
  checkBranchExists,
  checkWorktreeExists,
  createSubtaskWorktree,
  createTaskWorktree,
  deleteWorktree,
  ensureWorktree,
  getCurrentBranch,
  getMainBranch,
  isGitRepo,
  listWorktrees,
  mergeSubtaskIntoTask
} from "./git";

describe("Git Worktree Manager", () => {
  let tempDir: string;
  let gitRepoDir: string;
  let nonGitDir: string;

  beforeAll(async () => {
    // Create temp directories for testing
    tempDir = await createTestDir("git");
    gitRepoDir = join(tempDir, "git-repo");
    nonGitDir = join(tempDir, "non-git");

    // Create directories
    await Bun.$`mkdir -p ${gitRepoDir}`;
    await Bun.$`mkdir -p ${nonGitDir}`;

    // Initialize git repo with main branch
    await Bun.$`git init -b main ${gitRepoDir}`;
    await Bun.$`git -C ${gitRepoDir} config user.email "test@test.com"`;
    await Bun.$`git -C ${gitRepoDir} config user.name "Test User"`;

    // Create initial commit
    await Bun.$`touch ${gitRepoDir}/README.md`;
    await Bun.$`git -C ${gitRepoDir} add .`;
    await Bun.$`git -C ${gitRepoDir} commit -m "Initial commit"`;
  });

  afterAll(async () => {
    await cleanupTestDir(tempDir);
  });

  describe("isGitRepo", () => {
    test("returns true for a git repository", async () => {
      const result = await isGitRepo(gitRepoDir);
      expect(result).toBe(true);
    });

    test("returns false for a non-git directory", async () => {
      const result = await isGitRepo(nonGitDir);
      expect(result).toBe(false);
    });

    test("returns false for a non-existent directory", async () => {
      const result = await isGitRepo(join(tempDir, "does-not-exist"));
      expect(result).toBe(false);
    });
  });

  describe("getMainBranch", () => {
    test("returns main branch name", async () => {
      const branch = await getMainBranch(gitRepoDir);
      expect(branch).toBe("main");
    });
  });

  describe("createTaskWorktree", () => {
    test("creates worktree and returns path", async () => {
      const taskFolder = "20260125143022-test-task";
      const worktreePath = await createTaskWorktree(gitRepoDir, taskFolder);

      expect(worktreePath).toBe(join(gitRepoDir, ".worktrees", taskFolder));

      // Verify worktree exists
      const worktrees = await listWorktrees(gitRepoDir);
      expect(worktrees).toContain(worktreePath);

      // Verify branch was created
      const branch = await getCurrentBranch(worktreePath);
      expect(branch).toBe(`task/${taskFolder}`);
    });

    test("handles case where branch already exists", async () => {
      const taskFolder = "20260125143023-existing-branch";

      // Create the worktree first time
      await createTaskWorktree(gitRepoDir, taskFolder);

      // Delete the worktree but keep the branch
      const worktreePath = join(gitRepoDir, ".worktrees", taskFolder);
      await deleteWorktree(gitRepoDir, worktreePath);

      // Should handle existing branch gracefully
      const path = await createTaskWorktree(gitRepoDir, taskFolder);
      expect(path).toBe(join(gitRepoDir, ".worktrees", taskFolder));
    });

    test("throws error when branch is checked out in another worktree", async () => {
      const taskFolder = "20260125143029-branch-conflict";
      const branchName = `task/${taskFolder}`;
      const otherWorktreePath = join(
        gitRepoDir,
        ".worktrees",
        "other-worktree"
      );

      // Create the branch and a worktree at a different path
      await Bun.$`git -C ${gitRepoDir} worktree add -b ${branchName} ${otherWorktreePath}`.quiet();

      // Trying to create a task worktree should fail because the branch is already checked out
      await expect(createTaskWorktree(gitRepoDir, taskFolder)).rejects.toThrow(
        /Branch 'task\/20260125143029-branch-conflict' is already checked out in worktree/
      );

      // Cleanup
      await deleteWorktree(gitRepoDir, otherWorktreePath);
    });

    test("fetches remote changes when branch exists and was updated remotely", async () => {
      const taskFolder = "20260125143028-remote-update";
      const branchName = `task/${taskFolder}`;

      // Set up a bare "remote" repo
      const remoteDir = join(tempDir, "remote-repo");
      await Bun.$`git clone --bare ${gitRepoDir} ${remoteDir}`.quiet();

      // Add remote to our repo
      await Bun.$`git -C ${gitRepoDir} remote add test-remote ${remoteDir}`.quiet();

      // Create worktree and push branch to remote
      const worktreePath = await createTaskWorktree(gitRepoDir, taskFolder);
      await Bun.$`touch ${worktreePath}/initial-file.txt`;
      await Bun.$`git -C ${worktreePath} add .`;
      await Bun.$`git -C ${worktreePath} commit -m "Initial worktree commit"`;
      await Bun.$`git -C ${worktreePath} push test-remote ${branchName}`.quiet();

      // Get the initial commit SHA
      const initialSha = (
        await Bun.$`git -C ${worktreePath} rev-parse HEAD`.quiet()
      )
        .text()
        .trim();

      // Delete the worktree (keep local branch)
      await deleteWorktree(gitRepoDir, worktreePath);

      // Simulate remote update: clone the remote elsewhere, make changes, push
      const collaboratorDir = join(tempDir, "collaborator-clone");
      await Bun.$`git clone ${remoteDir} ${collaboratorDir}`.quiet();
      await Bun.$`git -C ${collaboratorDir} config user.email "collaborator@test.com"`;
      await Bun.$`git -C ${collaboratorDir} config user.name "Collaborator"`;
      await Bun.$`git -C ${collaboratorDir} checkout ${branchName}`.quiet();
      await Bun.$`touch ${collaboratorDir}/remote-change.txt`;
      await Bun.$`git -C ${collaboratorDir} add .`;
      await Bun.$`git -C ${collaboratorDir} commit -m "Remote collaborator change"`;
      await Bun.$`git -C ${collaboratorDir} push origin ${branchName}`.quiet();

      // Get the new remote commit SHA
      const remoteSha = (
        await Bun.$`git -C ${collaboratorDir} rev-parse HEAD`.quiet()
      )
        .text()
        .trim();

      // Verify the remote has a newer commit
      expect(remoteSha).not.toBe(initialSha);

      // Now recreate the worktree - it should fetch and have the remote changes
      // First, configure fetch to use our test-remote as origin for this branch
      await Bun.$`git -C ${gitRepoDir} config branch.${branchName}.remote test-remote`.quiet();
      await Bun.$`git -C ${gitRepoDir} config branch.${branchName}.merge refs/heads/${branchName}`.quiet();

      // Rename test-remote to origin temporarily for the fetch to work
      await Bun.$`git -C ${gitRepoDir} remote rename test-remote origin`.quiet();

      const newWorktreePath = await createTaskWorktree(gitRepoDir, taskFolder);

      // Get the commit SHA in the new worktree
      const newSha = (
        await Bun.$`git -C ${newWorktreePath} rev-parse HEAD`.quiet()
      )
        .text()
        .trim();

      // Should have the remote changes
      expect(newSha).toBe(remoteSha);

      // Verify the remote file exists
      const remoteFileExists = await Bun.file(
        join(newWorktreePath, "remote-change.txt")
      ).exists();
      expect(remoteFileExists).toBe(true);

      // Cleanup: rename remote back
      await Bun.$`git -C ${gitRepoDir} remote rename origin test-remote`.quiet();
    });
  });

  describe("createSubtaskWorktree", () => {
    test("creates subtask worktree branched from task branch", async () => {
      const taskFolder = "20260125143024-parent-task";
      const subtaskSlug = "001-first-subtask";

      // First create parent task worktree
      await createTaskWorktree(gitRepoDir, taskFolder);

      // Create subtask worktree
      const worktreePath = await createSubtaskWorktree(
        gitRepoDir,
        taskFolder,
        subtaskSlug
      );

      expect(worktreePath).toBe(
        join(gitRepoDir, ".worktrees", `${taskFolder}--${subtaskSlug}`)
      );

      // Verify branch is correct (uses -- separator to avoid git ref conflicts)
      const branch = await getCurrentBranch(worktreePath);
      expect(branch).toBe(`task/${taskFolder}--${subtaskSlug}`);
    });
  });

  describe("mergeSubtaskIntoTask", () => {
    test("merges subtask branch into task branch on clean merge", async () => {
      const taskFolder = "20260125143025-merge-test";
      const subtaskSlug = "001-mergeable-subtask";

      // Create task worktree
      const taskWorktreePath = await createTaskWorktree(gitRepoDir, taskFolder);

      // Create subtask worktree
      const subtaskWorktreePath = await createSubtaskWorktree(
        gitRepoDir,
        taskFolder,
        subtaskSlug
      );

      // Make a change in the subtask worktree
      await Bun.$`touch ${subtaskWorktreePath}/new-file.txt`;
      await Bun.$`git -C ${subtaskWorktreePath} add .`;
      await Bun.$`git -C ${subtaskWorktreePath} commit -m "Add new file"`;

      // Merge subtask into task
      const result = await mergeSubtaskIntoTask(
        gitRepoDir,
        taskFolder,
        subtaskSlug
      );

      expect(result.success).toBe(true);
      expect(result.commitSha).toBeDefined();
      expect(result.commitSha).toMatch(/^[a-f0-9]{7,40}$/);

      // Verify file exists in task worktree
      const fileExists = await Bun.file(
        join(taskWorktreePath, "new-file.txt")
      ).exists();
      expect(fileExists).toBe(true);
    });

    test("returns error on merge conflict", async () => {
      const taskFolder = "20260125143026-conflict-test";
      const subtaskSlug = "001-conflicting-subtask";

      // Create task worktree
      const taskWorktreePath = await createTaskWorktree(gitRepoDir, taskFolder);

      // Create subtask worktree
      const subtaskWorktreePath = await createSubtaskWorktree(
        gitRepoDir,
        taskFolder,
        subtaskSlug
      );

      // Make conflicting changes
      await Bun.$`echo "task content" > ${taskWorktreePath}/conflict.txt`;
      await Bun.$`git -C ${taskWorktreePath} add .`;
      await Bun.$`git -C ${taskWorktreePath} commit -m "Task change"`;

      await Bun.$`echo "subtask content" > ${subtaskWorktreePath}/conflict.txt`;
      await Bun.$`git -C ${subtaskWorktreePath} add .`;
      await Bun.$`git -C ${subtaskWorktreePath} commit -m "Subtask change"`;

      // Try to merge
      const result = await mergeSubtaskIntoTask(
        gitRepoDir,
        taskFolder,
        subtaskSlug
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("deleteWorktree", () => {
    test("removes worktree", async () => {
      const taskFolder = "20260125143027-delete-test";

      // Create worktree
      const worktreePath = await createTaskWorktree(gitRepoDir, taskFolder);

      // Verify it exists
      let worktrees = await listWorktrees(gitRepoDir);
      expect(worktrees).toContain(worktreePath);

      // Delete it
      await deleteWorktree(gitRepoDir, worktreePath);

      // Verify it's gone
      worktrees = await listWorktrees(gitRepoDir);
      expect(worktrees).not.toContain(worktreePath);
    });

    test("handles non-existent worktree gracefully", async () => {
      const nonExistentPath = join(gitRepoDir, ".worktrees", "does-not-exist");

      // Should not throw
      await expect(
        deleteWorktree(gitRepoDir, nonExistentPath)
      ).resolves.toBeUndefined();
    });
  });

  describe("listWorktrees", () => {
    test("returns array of worktree paths", async () => {
      const worktrees = await listWorktrees(gitRepoDir);

      expect(Array.isArray(worktrees)).toBe(true);
      // Should include at least the main worktree
      expect(worktrees.length).toBeGreaterThan(0);
    });
  });

  describe("getCurrentBranch", () => {
    test("returns current branch name", async () => {
      const branch = await getCurrentBranch(gitRepoDir);
      expect(branch).toBe("main");
    });
  });

  describe("checkWorktreeExists", () => {
    test("returns true when worktree exists", async () => {
      const taskFolder = "20260127-check-worktree-exists";
      const worktreePath = await createTaskWorktree(gitRepoDir, taskFolder);

      const exists = await checkWorktreeExists(gitRepoDir, worktreePath);
      expect(exists).toBe(true);
    });

    test("returns false when worktree does not exist", async () => {
      const nonExistentPath = join(
        gitRepoDir,
        ".worktrees",
        "non-existent-worktree"
      );
      const exists = await checkWorktreeExists(gitRepoDir, nonExistentPath);
      expect(exists).toBe(false);
    });
  });

  describe("checkBranchExists", () => {
    test("returns true when branch exists", async () => {
      const branchName = "test-branch-exists";
      await Bun.$`git -C ${gitRepoDir} branch ${branchName}`.quiet();

      const exists = await checkBranchExists(gitRepoDir, branchName);
      expect(exists).toBe(true);

      await Bun.$`git -C ${gitRepoDir} branch -d ${branchName}`.quiet();
    });

    test("returns false when branch does not exist", async () => {
      const exists = await checkBranchExists(gitRepoDir, "non-existent-branch");
      expect(exists).toBe(false);
    });
  });

  describe("ensureWorktree", () => {
    test("creates fresh worktree when neither exists", async () => {
      const branchName = "test-ensure-fresh";
      const worktreePath = join(gitRepoDir, ".worktrees", "ensure-fresh");

      const result = await ensureWorktree({
        cwd: gitRepoDir,
        worktreePath,
        branchName,
        sourceBranch: "main"
      });

      expect(result).toBe(worktreePath);

      const worktreeExists = await checkWorktreeExists(
        gitRepoDir,
        worktreePath
      );
      expect(worktreeExists).toBe(true);

      const branchExists = await checkBranchExists(gitRepoDir, branchName);
      expect(branchExists).toBe(true);

      await deleteWorktree(gitRepoDir, worktreePath);
    });

    test("reuses existing when both worktree and branch exist", async () => {
      const branchName = "test-ensure-reuse";
      const worktreePath = join(gitRepoDir, ".worktrees", "ensure-reuse");

      await ensureWorktree({
        cwd: gitRepoDir,
        worktreePath,
        branchName,
        sourceBranch: "main"
      });

      const result = await ensureWorktree({
        cwd: gitRepoDir,
        worktreePath,
        branchName,
        sourceBranch: "main"
      });

      expect(result).toBe(worktreePath);

      await deleteWorktree(gitRepoDir, worktreePath);
    });

    test("throws error when branch exists but worktree is missing", async () => {
      const branchName = "test-ensure-branch-only";
      await Bun.$`git -C ${gitRepoDir} branch ${branchName}`.quiet();

      const worktreePath = join(gitRepoDir, ".worktrees", "ensure-branch-only");

      await expect(
        ensureWorktree({
          cwd: gitRepoDir,
          worktreePath,
          branchName,
          sourceBranch: "main"
        })
      ).rejects.toThrow(/Branch.*exists but worktree is missing/);

      await Bun.$`git -C ${gitRepoDir} branch -d ${branchName}`.quiet();
    });

    test("throws error when worktree exists but branch is missing", async () => {
      const branchName = "test-ensure-worktree-only";
      const worktreePath = join(
        gitRepoDir,
        ".worktrees",
        "ensure-worktree-only"
      );

      await Bun.$`git -C ${gitRepoDir} worktree add -b ${branchName} ${worktreePath}`.quiet();
      await Bun.$`git -C ${worktreePath} checkout --detach`.quiet();
      await Bun.$`git -C ${gitRepoDir} branch -d ${branchName}`.quiet();

      await expect(
        ensureWorktree({
          cwd: gitRepoDir,
          worktreePath,
          branchName,
          sourceBranch: "main"
        })
      ).rejects.toThrow(/Worktree exists.*but branch.*is missing/);

      await Bun.$`git -C ${gitRepoDir} worktree remove ${worktreePath} --force`.quiet();
    });
  });

  describe("createSubtaskWorktree idempotency", () => {
    test("returns same path when called twice (idempotent)", async () => {
      const taskFolder = "20260127-idempotent-subtask";
      const subtaskSlug = "001-idempotent-test";

      await createTaskWorktree(gitRepoDir, taskFolder);

      const firstPath = await createSubtaskWorktree(
        gitRepoDir,
        taskFolder,
        subtaskSlug
      );
      const secondPath = await createSubtaskWorktree(
        gitRepoDir,
        taskFolder,
        subtaskSlug
      );

      expect(firstPath).toBe(secondPath);
    });
  });

  describe("configurable worktreesDir (global mode)", () => {
    let customWorktreesDir: string;

    beforeAll(async () => {
      customWorktreesDir = join(tempDir, "custom-worktrees");
      await Bun.$`mkdir -p ${customWorktreesDir}`;
    });

    describe("createTaskWorktree with worktreesDir", () => {
      test("creates worktree in custom directory when worktreesDir provided", async () => {
        const taskFolder = "20260129-custom-dir-task";
        const worktreePath = await createTaskWorktree(
          gitRepoDir,
          taskFolder,
          customWorktreesDir
        );

        expect(worktreePath).toBe(join(customWorktreesDir, taskFolder));

        const worktrees = await listWorktrees(gitRepoDir);
        expect(worktrees).toContain(worktreePath);

        const branch = await getCurrentBranch(worktreePath);
        expect(branch).toBe(`task/${taskFolder}`);
      });

      test("uses default .worktrees when worktreesDir not provided", async () => {
        const taskFolder = "20260129-default-dir-task";
        const worktreePath = await createTaskWorktree(gitRepoDir, taskFolder);

        expect(worktreePath).toBe(join(gitRepoDir, ".worktrees", taskFolder));
      });
    });

    describe("createSubtaskWorktree with worktreesDir", () => {
      test("creates subtask worktree in custom directory when worktreesDir provided", async () => {
        const taskFolder = "20260129-custom-subtask-parent";
        const subtaskSlug = "001-custom-subtask";

        await createTaskWorktree(gitRepoDir, taskFolder, customWorktreesDir);

        const worktreePath = await createSubtaskWorktree(
          gitRepoDir,
          taskFolder,
          subtaskSlug,
          customWorktreesDir
        );

        expect(worktreePath).toBe(
          join(customWorktreesDir, `${taskFolder}--${subtaskSlug}`)
        );

        const worktrees = await listWorktrees(gitRepoDir);
        expect(worktrees).toContain(worktreePath);

        const branch = await getCurrentBranch(worktreePath);
        expect(branch).toBe(`task/${taskFolder}--${subtaskSlug}`);
      });

      test("uses default .worktrees when worktreesDir not provided", async () => {
        const taskFolder = "20260129-default-subtask-parent";
        const subtaskSlug = "001-default-subtask";

        await createTaskWorktree(gitRepoDir, taskFolder);

        const worktreePath = await createSubtaskWorktree(
          gitRepoDir,
          taskFolder,
          subtaskSlug
        );

        expect(worktreePath).toBe(
          join(gitRepoDir, ".worktrees", `${taskFolder}--${subtaskSlug}`)
        );
      });
    });

    describe("mergeSubtaskIntoTask with worktreesDir", () => {
      test("merges subtask using custom worktree directory", async () => {
        const taskFolder = "20260129-custom-merge-test";
        const subtaskSlug = "001-custom-mergeable";

        const taskWorktreePath = await createTaskWorktree(
          gitRepoDir,
          taskFolder,
          customWorktreesDir
        );

        const subtaskWorktreePath = await createSubtaskWorktree(
          gitRepoDir,
          taskFolder,
          subtaskSlug,
          customWorktreesDir
        );

        await Bun.$`touch ${subtaskWorktreePath}/custom-merge-file.txt`;
        await Bun.$`git -C ${subtaskWorktreePath} add .`;
        await Bun.$`git -C ${subtaskWorktreePath} commit -m "Add custom merge file"`;

        const result = await mergeSubtaskIntoTask(
          gitRepoDir,
          taskFolder,
          subtaskSlug,
          customWorktreesDir
        );

        expect(result.success).toBe(true);
        expect(result.commitSha).toBeDefined();

        const fileExists = await Bun.file(
          join(taskWorktreePath, "custom-merge-file.txt")
        ).exists();
        expect(fileExists).toBe(true);
      });

      test("uses default .worktrees when worktreesDir not provided", async () => {
        const taskFolder = "20260129-default-merge-test";
        const subtaskSlug = "001-default-mergeable";

        const taskWorktreePath = await createTaskWorktree(
          gitRepoDir,
          taskFolder
        );

        const subtaskWorktreePath = await createSubtaskWorktree(
          gitRepoDir,
          taskFolder,
          subtaskSlug
        );

        await Bun.$`touch ${subtaskWorktreePath}/default-merge-file.txt`;
        await Bun.$`git -C ${subtaskWorktreePath} add .`;
        await Bun.$`git -C ${subtaskWorktreePath} commit -m "Add default merge file"`;

        const result = await mergeSubtaskIntoTask(
          gitRepoDir,
          taskFolder,
          subtaskSlug
        );

        expect(result.success).toBe(true);

        const fileExists = await Bun.file(
          join(taskWorktreePath, "default-merge-file.txt")
        ).exists();
        expect(fileExists).toBe(true);
      });
    });
  });
});
