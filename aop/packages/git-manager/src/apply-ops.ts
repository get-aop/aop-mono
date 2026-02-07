import { getLogger } from "@aop/infra";
import { DirtyWorkingDirectoryError, NoChangesError, WorktreeNotFoundError } from "./errors.ts";
import type { GitExecutor } from "./git-executor.ts";
import type { MetadataStore } from "./metadata.ts";
import type { ApplyResult } from "./types.ts";
import { validateTaskId } from "./validation.ts";

const logger = getLogger("apply-ops");

const extractField = (block: string, prefix: string): string | undefined => {
  const line = block.split("\n").find((l) => l.startsWith(prefix));
  return line?.slice(prefix.length);
};

const parseWorktreeList = (output: string): Map<string, string> => {
  const branchToPath = new Map<string, string>();

  for (const block of output.split("\n\n")) {
    const path = extractField(block, "worktree ");
    const branch = extractField(block, "branch refs/heads/");
    if (branch && path) {
      branchToPath.set(branch, path);
    }
  }

  return branchToPath;
};

export class ApplyOps {
  constructor(
    private readonly repoPath: string,
    private readonly worktreesDir: string,
    private readonly metadata: MetadataStore,
    private readonly worktreeExists: (taskId: string) => Promise<boolean>,
    private readonly executor: GitExecutor,
  ) {}

  async applyWorktree(taskId: string): Promise<ApplyResult> {
    validateTaskId(taskId);

    if (!(await this.worktreeExists(taskId))) {
      throw new WorktreeNotFoundError(taskId);
    }

    if (await this.hasUncommittedChangesInMain()) {
      throw new DirtyWorkingDirectoryError();
    }

    const worktreePath = `${this.worktreesDir}/${taskId}`;
    const worktreeMeta = await this.metadata.get(taskId);
    const diff = await this.getDiff(worktreePath, worktreeMeta.baseCommit);

    if (!diff.trim()) {
      throw new NoChangesError(taskId);
    }

    const result = await this.applyDiff(diff, this.repoPath);

    logger.info("Applied worktree {taskId} to main repo ({count} files)", {
      taskId,
      count: result.affectedFiles.length,
    });

    return result;
  }

  async applyWorktreeToTarget(taskId: string, targetBranch: string): Promise<ApplyResult> {
    validateTaskId(taskId);

    if (!(await this.worktreeExists(taskId))) {
      throw new WorktreeNotFoundError(taskId);
    }

    const targetPath = await this.resolveTargetBranch(targetBranch);

    const worktreePath = `${this.worktreesDir}/${taskId}`;
    const worktreeBranch = await this.executor.exec(["branch", "--show-current"], worktreePath);
    const mergeBase = await this.executor.exec(["merge-base", targetBranch, worktreeBranch]);
    const diff = await this.getDiff(worktreePath, mergeBase);

    if (!diff.trim()) {
      throw new NoChangesError(taskId);
    }

    const result = await this.applyDiff(diff, targetPath);

    logger.info("Applied worktree {taskId} to {targetBranch} at {targetPath} ({count} files)", {
      taskId,
      targetBranch,
      targetPath,
      count: result.affectedFiles.length,
    });

    return result;
  }

  private async resolveTargetBranch(targetBranch: string): Promise<string> {
    const branchExists = await this.executor.execRaw([
      "rev-parse",
      "--verify",
      `refs/heads/${targetBranch}`,
    ]);

    if (branchExists.exitCode !== 0) {
      return this.checkoutNewBranch(targetBranch);
    }

    const checkedOutPath = await this.findBranchCheckoutPath(targetBranch);
    if (checkedOutPath) {
      return checkedOutPath;
    }

    return this.checkoutExistingBranch(targetBranch);
  }

  private async checkoutNewBranch(branch: string): Promise<string> {
    if (await this.hasUncommittedChangesInMain()) {
      throw new DirtyWorkingDirectoryError();
    }
    await this.executor.exec(["checkout", "-b", branch]);
    return this.repoPath;
  }

  private async checkoutExistingBranch(branch: string): Promise<string> {
    if (await this.hasUncommittedChangesInMain()) {
      throw new DirtyWorkingDirectoryError();
    }
    await this.executor.exec(["checkout", branch]);
    return this.repoPath;
  }

  private async findBranchCheckoutPath(targetBranch: string): Promise<string | null> {
    const output = await this.executor.exec(["worktree", "list", "--porcelain"]);
    const branchToPath = parseWorktreeList(output);
    return branchToPath.get(targetBranch) ?? null;
  }

  private async hasUncommittedChangesInMain(): Promise<boolean> {
    const result = await Bun.$`git status --porcelain`.cwd(this.repoPath).quiet().nothrow();
    return result.stdout.toString().trim().length > 0;
  }

  private async getDiff(worktreePath: string, baseCommit: string): Promise<string> {
    // Stage all changes (including new files) so they appear in the diff
    await Bun.$`git add -A`.cwd(worktreePath).quiet().nothrow();

    // Diff staged changes against baseCommit
    const result = await Bun.$`git diff --cached ${baseCommit}`.cwd(worktreePath).quiet().nothrow();
    if (result.exitCode !== 0) {
      throw new Error(`Failed to generate diff: ${result.stderr.toString()}`);
    }
    return result.stdout.toString();
  }

  private async applyDiff(diff: string, targetPath: string): Promise<ApplyResult> {
    const diffBuffer = Buffer.from(diff);
    const affectedFiles = this.parseAffectedFiles(diff);

    const cleanApply = await Bun.$`git apply --check < ${diffBuffer}`
      .cwd(targetPath)
      .quiet()
      .nothrow();
    if (cleanApply.exitCode === 0) {
      await Bun.$`git apply < ${diffBuffer}`.cwd(targetPath).quiet();
      return { affectedFiles, conflictingFiles: [] };
    }

    // Fall back to 3-way merge: applies clean hunks and creates conflict markers
    await Bun.$`git apply --3way < ${diffBuffer}`.cwd(targetPath).quiet().nothrow();
    const conflictingFiles = this.parseConflictingFiles(cleanApply.stderr.toString());

    return { affectedFiles, conflictingFiles };
  }

  private parseConflictingFiles(stderr: string): string[] {
    const files = new Set<string>();
    for (const line of stderr.split("\n")) {
      const patchFailed = line.match(/error: patch failed: ([^:]+):/);
      if (patchFailed?.[1]) {
        files.add(patchFailed[1]);
        continue;
      }
      const alreadyExists = line.match(/error: (.+): already exists in working directory/);
      if (alreadyExists?.[1]) {
        files.add(alreadyExists[1]);
      }
    }
    return Array.from(files);
  }

  private parseAffectedFiles(diff: string): string[] {
    const files = new Set<string>();
    const lines = diff.split("\n");
    for (const line of lines) {
      const match = line.match(/^diff --git a\/(.+) b\//);
      if (match?.[1]) {
        files.add(match[1]);
      }
    }
    return Array.from(files);
  }
}
