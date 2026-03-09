import { getLogger } from "@aop/infra";
import type { BranchOps } from "./branch-ops.ts";
import {
  BranchExistsError,
  GitConflictError,
  NoCommitsError,
  WorktreeNotFoundError,
} from "./errors.ts";
import type { GitExecutor } from "./git-executor.ts";
import type { MetadataStore } from "./metadata.ts";
import type { SquashResult } from "./types.ts";
import { validateTaskId } from "./validation.ts";

const logger = getLogger("merge-ops");

/**
 * Squash merge, conflict detection, and abort cleanup operations.
 */
export class MergeOps {
  constructor(
    private readonly executor: GitExecutor,
    private readonly branchOps: BranchOps,
    private readonly metadata: MetadataStore,
    private readonly worktreeExists: (taskId: string) => Promise<boolean>,
  ) {}

  async squashMerge(taskId: string, targetBranch: string, message: string): Promise<SquashResult> {
    validateTaskId(taskId);

    if (!(await this.worktreeExists(taskId))) {
      throw new WorktreeNotFoundError(taskId);
    }

    if (await this.branchOps.exists(targetBranch)) {
      throw new BranchExistsError(targetBranch);
    }

    const meta = await this.metadata.get(taskId);

    if (!(await this.hasCommitsBeyondBase(taskId, meta.baseCommit))) {
      throw new NoCommitsError(taskId);
    }

    const currentBaseBranchCommit = await this.branchOps.getCommit(meta.baseBranch);
    await this.branchOps.create(targetBranch, currentBaseBranchCommit);

    try {
      const mergeResult = await this.executor.execRaw(["merge", "--squash", taskId]);

      if (mergeResult.exitCode !== 0) {
        const conflictFiles = await this.getConflictingFiles();
        if (conflictFiles.length > 0) {
          await this.abortMerge();
          await this.branchOps.checkoutPrevious();
          await this.branchOps.delete(targetBranch);
          throw new GitConflictError(conflictFiles);
        }
        throw new Error(`Squash merge failed: ${mergeResult.stderr}`);
      }

      await this.executor.exec(["commit", "-m", message]);
      const commitSha = await this.branchOps.getCommit("HEAD");
      await this.branchOps.checkoutPrevious();

      logger.info("Squash merged {taskId} into {targetBranch}", { taskId, targetBranch });

      return { targetBranch, commitSha };
    } catch (error) {
      try {
        await this.abortMerge();
        await this.branchOps.checkoutPrevious();
        await this.branchOps.delete(targetBranch);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  private async hasCommitsBeyondBase(taskId: string, baseCommit: string): Promise<boolean> {
    const headCommit = await this.branchOps.getCommit(taskId);
    return headCommit !== baseCommit;
  }

  private async getConflictingFiles(): Promise<string[]> {
    const result = await this.executor.execRaw(["diff", "--name-only", "--diff-filter=U"]);
    return result.stdout ? result.stdout.split("\n").filter(Boolean) : [];
  }

  private async abortMerge(): Promise<void> {
    await this.executor.execRaw(["merge", "--abort"]);
    await this.executor.execRaw(["reset", "--hard", "HEAD"]);
  }
}
