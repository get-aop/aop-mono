import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { getLogger } from "../infra/logger";

const log = getLogger("git");

interface ShellError extends Error {
  stderr?: Buffer;
  stdout?: Buffer;
  exitCode?: number;
}

export interface MergeResult {
  success: boolean;
  commitSha?: string;
  error?: string;
  hasConflict?: boolean;
}

export const isGitRepo = async (cwd: string): Promise<boolean> => {
  try {
    const result = await Bun.$`git -C ${cwd} rev-parse --show-toplevel`.quiet();
    const topLevel = result.text().trim();
    const normalizedCwd = await realpath(cwd);
    const normalizedTopLevel = await realpath(topLevel);
    return normalizedCwd === normalizedTopLevel;
  } catch {
    return false;
  }
};

export const getMainBranch = async (cwd: string): Promise<string> => {
  // Try to get from symbolic-ref first (for repos with remotes)
  try {
    const result =
      await Bun.$`git -C ${cwd} symbolic-ref refs/remotes/origin/HEAD`.quiet();
    const output = result.text().trim();
    // Parse "refs/remotes/origin/main" -> "main"
    const match = output.match(/refs\/remotes\/origin\/(.+)/);
    if (match) return match[1]!;
  } catch {
    // Fallback: check if main or master exists
  }

  // Check if 'main' branch exists
  try {
    await Bun.$`git -C ${cwd} rev-parse --verify main`.quiet();
    return "main";
  } catch {
    // Continue to check master
  }

  // Check if 'master' branch exists
  try {
    await Bun.$`git -C ${cwd} rev-parse --verify master`.quiet();
    return "master";
  } catch {
    throw new Error("Could not determine main branch");
  }
};

export const createTaskWorktree = async (
  repoRoot: string,
  taskFolder: string,
  worktreesDir?: string,
  customBranch?: string
): Promise<string> => {
  const branchName = customBranch ?? `task/${taskFolder}`;
  const worktreePath = worktreesDir
    ? join(worktreesDir, taskFolder)
    : join(repoRoot, ".worktrees", taskFolder);

  const worktrees = await listWorktrees(repoRoot);
  if (worktrees.includes(worktreePath)) {
    return worktreePath;
  }

  const branchConflict = await findBranchWorktreeConflict(repoRoot, branchName);
  if (branchConflict) {
    throw new Error(
      `Branch '${branchName}' is already checked out in worktree '${branchConflict}'. ` +
        `Remove that worktree first with: git worktree remove ${branchConflict}`
    );
  }

  // Check if branch already exists
  let branchExists = false;
  try {
    await Bun.$`git -C ${repoRoot} rev-parse --verify ${branchName}`.quiet();
    branchExists = true;
  } catch {
    // Branch doesn't exist
  }

  if (branchExists) {
    // Fetch latest changes from remote if available
    try {
      await Bun.$`git -C ${repoRoot} fetch origin ${branchName}:${branchName}`.quiet();
    } catch {
      // Branch might not exist on remote, or no remote configured - continue with local state
    }
    // Branch exists, create worktree without -b flag
    await Bun.$`git -C ${repoRoot} worktree add ${worktreePath} ${branchName}`.quiet();
  } else {
    // Create new branch with worktree
    await Bun.$`git -C ${repoRoot} worktree add -b ${branchName} ${worktreePath}`.quiet();
  }

  return worktreePath;
};

export const createSubtaskWorktree = async (
  repoRoot: string,
  taskFolder: string,
  subtaskSlug: string,
  worktreesDir?: string,
  customTaskBranch?: string
): Promise<string> => {
  const taskBranch = customTaskBranch ?? `task/${taskFolder}`;
  const subtaskBranch = customTaskBranch
    ? `${customTaskBranch}--${subtaskSlug}`
    : `task/${taskFolder}--${subtaskSlug}`;
  const worktreePath = worktreesDir
    ? join(worktreesDir, `${taskFolder}--${subtaskSlug}`)
    : join(repoRoot, ".worktrees", `${taskFolder}--${subtaskSlug}`);

  return ensureWorktree({
    cwd: repoRoot,
    worktreePath,
    branchName: subtaskBranch,
    sourceBranch: taskBranch
  });
};

export const mergeSubtaskIntoTask = async (
  repoRoot: string,
  taskFolder: string,
  subtaskSlug: string,
  worktreesDir?: string,
  customTaskBranch?: string
): Promise<MergeResult> => {
  const taskWorktreePath = worktreesDir
    ? join(worktreesDir, taskFolder)
    : join(repoRoot, ".worktrees", taskFolder);
  const subtaskBranch = customTaskBranch
    ? `${customTaskBranch}--${subtaskSlug}`
    : `task/${taskFolder}--${subtaskSlug}`;

  log.info`mergeSubtaskIntoTask ${{
    repoRoot,
    taskFolder,
    subtaskSlug,
    taskWorktreePath,
    subtaskBranch
  }}`;

  try {
    log.debug`Running: git -C ${taskWorktreePath} merge ${subtaskBranch} --no-edit`;
    await Bun.$`git -C ${taskWorktreePath} merge ${subtaskBranch} --no-edit`.quiet();

    // Get the commit SHA
    const result =
      await Bun.$`git -C ${taskWorktreePath} rev-parse --short HEAD`.quiet();
    const commitSha = result.text().trim();

    log.info`Merge successful ${{ commitSha }}`;
    return { success: true, commitSha };
  } catch (error) {
    const shellError = error as ShellError;
    const errorMessage = shellError.message ?? String(error);
    const stderrOutput = shellError.stderr?.toString() ?? "";
    const stdoutOutput = shellError.stdout?.toString() ?? "";
    const fullOutput = `${errorMessage}\n${stderrOutput}\n${stdoutOutput}`;
    const hasConflict = /CONFLICT|Automatic merge failed|Merge conflict/i.test(
      fullOutput
    );

    log.error`Merge failed ${{ error: fullOutput.trim(), hasConflict }}`;

    // Don't abort if there's a conflict - we need the conflict markers for the solver
    if (!hasConflict) {
      try {
        await Bun.$`git -C ${taskWorktreePath} merge --abort`.quiet();
      } catch {
        // Ignore abort errors
      }
    }

    return { success: false, error: fullOutput.trim(), hasConflict };
  }
};

export const deleteWorktree = async (
  cwd: string,
  worktreePath: string
): Promise<void> => {
  log.info`deleteWorktree ${{ cwd, worktreePath }}`;

  // First try git worktree remove
  try {
    await Bun.$`git -C ${cwd} worktree remove ${worktreePath} --force`.quiet();
    log.info`Worktree deleted successfully`;
    return;
  } catch (error) {
    log.warn`git worktree remove failed, trying fallback ${{
      error: error instanceof Error ? error.message : String(error)
    }}`;
  }

  // Fallback: remove directory and prune
  try {
    await Bun.$`rm -rf ${worktreePath}`.quiet();
    await Bun.$`git -C ${cwd} worktree prune`.quiet();
    log.info`Worktree deleted via fallback (rm + prune)`;
  } catch (error) {
    log.error`Worktree deletion failed completely ${{
      error: error instanceof Error ? error.message : String(error)
    }}`;
  }
};

export const listWorktrees = async (cwd: string): Promise<string[]> => {
  const result = await Bun.$`git -C ${cwd} worktree list --porcelain`.quiet();
  const output = result.text();

  const paths: string[] = [];
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      paths.push(line.substring("worktree ".length));
    }
  }

  return paths;
};

export const checkWorktreeExists = async (
  cwd: string,
  worktreePath: string
): Promise<boolean> => {
  const worktrees = await listWorktrees(cwd);
  return worktrees.includes(worktreePath);
};

export const checkBranchExists = async (
  cwd: string,
  branchName: string
): Promise<boolean> => {
  const result = await Bun.$`git -C ${cwd} branch --list ${branchName}`.quiet();
  return result.text().trim().length > 0;
};

export interface EnsureWorktreeOptions {
  cwd: string;
  worktreePath: string;
  branchName: string;
  sourceBranch: string;
}

export const ensureWorktree = async (
  options: EnsureWorktreeOptions
): Promise<string> => {
  const { cwd, worktreePath, branchName, sourceBranch } = options;

  const worktreeExists = await checkWorktreeExists(cwd, worktreePath);
  const branchExists = await checkBranchExists(cwd, branchName);

  if (worktreeExists && branchExists) {
    return worktreePath;
  }

  if (!worktreeExists && !branchExists) {
    // Check if source branch exists, if not fall back to HEAD
    const sourceBranchExists = await checkBranchExists(cwd, sourceBranch);
    const actualSourceBranch = sourceBranchExists ? sourceBranch : "HEAD";
    await Bun.$`git -C ${cwd} worktree add -b ${branchName} ${worktreePath} ${actualSourceBranch}`.quiet();
    return worktreePath;
  }

  if (branchExists && !worktreeExists) {
    throw new Error(
      `Branch '${branchName}' exists but worktree is missing. Manual cleanup required.`
    );
  }

  throw new Error(
    `Worktree exists at '${worktreePath}' but branch '${branchName}' is missing. Manual cleanup required.`
  );
};

export const getCurrentBranch = async (
  worktreePath: string
): Promise<string> => {
  const result =
    await Bun.$`git -C ${worktreePath} branch --show-current`.quiet();
  return result.text().trim();
};

export interface MigrateWorktreeResult {
  success: boolean;
  branchName: string;
  error?: string;
}

export const migrateWorktree = async (
  repoRoot: string,
  worktreePath: string
): Promise<MigrateWorktreeResult> => {
  log.info`migrateWorktree ${{ repoRoot, worktreePath }}`;

  try {
    // Get the branch name from the worktree before removing it
    const branchName = await getCurrentBranch(worktreePath);

    // Push the branch to remote to ensure work is preserved
    try {
      await Bun.$`git -C ${worktreePath} push -u origin ${branchName}`.quiet();
      log.info`Pushed branch ${branchName} to remote`;
    } catch (error) {
      log.warn`Failed to push to remote (may not have remote configured) ${{
        error: error instanceof Error ? error.message : String(error)
      }}`;
    }

    // Remove the worktree but keep the branch
    await deleteWorktree(repoRoot, worktreePath);

    log.info`Worktree migrated successfully, branch ${branchName} is available in main repo`;
    return { success: true, branchName };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error`Worktree migration failed ${{ error: errorMessage }}`;
    return { success: false, branchName: "", error: errorMessage };
  }
};

const findBranchWorktreeConflict = async (
  cwd: string,
  branchName: string
): Promise<string | null> => {
  try {
    const result = await Bun.$`git -C ${cwd} worktree list --porcelain`.quiet();
    const output = result.text();
    if (!output.includes(`branch refs/heads/${branchName}`)) {
      return null;
    }

    const lines = output.split("\n");
    let currentWorktreePath = "";
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        currentWorktreePath = line.substring("worktree ".length);
      }
      if (line === `branch refs/heads/${branchName}`) {
        return currentWorktreePath;
      }
    }
  } catch {
    // Git command failed, no conflict detected
  }
  return null;
};
