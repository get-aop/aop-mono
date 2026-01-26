import { join } from "node:path";

export interface MergeResult {
  success: boolean;
  commitSha?: string;
  error?: string;
}

export const isGitRepo = async (cwd: string): Promise<boolean> => {
  try {
    await Bun.$`git -C ${cwd} rev-parse --git-dir`.quiet();
    return true;
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

  try {
    await Bun.$`git -C ${taskWorktreePath} merge ${subtaskBranch} --no-edit`.quiet();

    // Get the commit SHA
    const result =
      await Bun.$`git -C ${taskWorktreePath} rev-parse --short HEAD`.quiet();
    const commitSha = result.text().trim();

    return { success: true, commitSha };
  } catch (error) {
    // Abort the merge to clean up
    try {
      await Bun.$`git -C ${taskWorktreePath} merge --abort`.quiet();
    } catch {
      // Ignore abort errors
    }

    const message =
      error instanceof Error ? error.message : "Unknown merge error";
    return { success: false, error: message };
  }
};

export const deleteWorktree = async (
  cwd: string,
  worktreePath: string
): Promise<void> => {
  try {
    await Bun.$`git -C ${cwd} worktree remove ${worktreePath} --force`.quiet();
  } catch {
    // Worktree might not exist, that's okay
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
