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
  cwd: string,
  taskFolder: string
): Promise<string> => {
  const branchName = `task/${taskFolder}`;
  const worktreePath = join(cwd, ".worktrees", taskFolder);

  const worktrees = await listWorktrees(cwd);
  if (worktrees.includes(worktreePath)) {
    return worktreePath;
  }

  const branchConflict = await findBranchWorktreeConflict(cwd, branchName);
  if (branchConflict) {
    throw new Error(
      `Branch '${branchName}' is already checked out in worktree '${branchConflict}'. ` +
        `Remove that worktree first with: git worktree remove ${branchConflict}`
    );
  }

  // Check if branch already exists
  let branchExists = false;
  try {
    await Bun.$`git -C ${cwd} rev-parse --verify ${branchName}`.quiet();
    branchExists = true;
  } catch {
    // Branch doesn't exist
  }

  if (branchExists) {
    // Fetch latest changes from remote if available
    try {
      await Bun.$`git -C ${cwd} fetch origin ${branchName}:${branchName}`.quiet();
    } catch {
      // Branch might not exist on remote, or no remote configured - continue with local state
    }
    // Branch exists, create worktree without -b flag
    await Bun.$`git -C ${cwd} worktree add ${worktreePath} ${branchName}`.quiet();
  } else {
    // Create new branch with worktree
    await Bun.$`git -C ${cwd} worktree add -b ${branchName} ${worktreePath}`.quiet();
  }

  return worktreePath;
};

export const createSubtaskWorktree = async (
  cwd: string,
  taskFolder: string,
  subtaskSlug: string
): Promise<string> => {
  const taskBranch = `task/${taskFolder}`;
  // Use -- separator to avoid git ref conflicts (can't have task/foo and task/foo/bar)
  const subtaskBranch = `task/${taskFolder}--${subtaskSlug}`;
  const worktreePath = join(cwd, ".worktrees", `${taskFolder}--${subtaskSlug}`);

  await Bun.$`git -C ${cwd} worktree add -b ${subtaskBranch} ${worktreePath} ${taskBranch}`.quiet();

  return worktreePath;
};

export const mergeSubtaskIntoTask = async (
  cwd: string,
  taskFolder: string,
  subtaskSlug: string
): Promise<MergeResult> => {
  const taskWorktreePath = join(cwd, ".worktrees", taskFolder);
  const subtaskBranch = `task/${taskFolder}--${subtaskSlug}`;

  log.info`mergeSubtaskIntoTask ${{
    cwd,
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
  try {
    await Bun.$`git -C ${cwd} worktree remove ${worktreePath} --force`.quiet();
    log.info`Worktree deleted successfully`;
  } catch (error) {
    log.warn`Worktree deletion failed (may not exist) ${{
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

export const getCurrentBranch = async (
  worktreePath: string
): Promise<string> => {
  const result =
    await Bun.$`git -C ${worktreePath} branch --show-current`.quiet();
  return result.text().trim();
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
