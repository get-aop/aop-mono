import { getLogger } from "@aop/infra";
import type { BranchOps } from "./branch-ops.ts";
import {
  BranchNotFoundError,
  DirtyWorktreeError,
  WorktreeExistsError,
  WorktreeNotFoundError,
} from "./errors.ts";
import type { GitExecutor } from "./git-executor.ts";
import type { MetadataStore } from "./metadata.ts";
import type { WorktreeInfo } from "./types.ts";
import { validateTaskId } from "./validation.ts";

const logger = getLogger("worktree-ops");

/**
 * Worktree create/remove lifecycle operations.
 */
export class WorktreeOps {
  constructor(
    private readonly worktreesDir: string,
    private readonly executor: GitExecutor,
    private readonly branchOps: BranchOps,
    private readonly metadata: MetadataStore,
  ) {}

  async create(taskId: string, baseBranch: string, branchName = taskId): Promise<WorktreeInfo> {
    validateTaskId(taskId);

    if (!(await this.branchOps.exists(baseBranch))) {
      throw new BranchNotFoundError(baseBranch);
    }

    const worktreePath = `${this.worktreesDir}/${taskId}`;
    if (await this.exists(taskId)) {
      throw new WorktreeExistsError(taskId);
    }

    await this.ensureWorktreesDir();

    const baseCommit = await this.branchOps.getCommit(baseBranch);
    await this.executor.exec(["worktree", "add", "-b", branchName, worktreePath, baseBranch]);
    await this.metadata.save(taskId, { branch: branchName, baseBranch, baseCommit });

    logger.info("Created worktree {taskId} at {path}", { taskId, path: worktreePath });

    return { path: worktreePath, branch: branchName, baseBranch, baseCommit };
  }

  async remove(taskId: string): Promise<void> {
    validateTaskId(taskId);

    if (!(await this.exists(taskId))) {
      throw new WorktreeNotFoundError(taskId);
    }

    const worktreePath = `${this.worktreesDir}/${taskId}`;
    const metadata = await this.metadata.get(taskId);
    if (await this.hasUncommittedChanges(worktreePath)) {
      throw new DirtyWorktreeError(taskId);
    }

    await this.executor.exec(["worktree", "remove", worktreePath]);
    await this.executor.exec(["branch", "-D", metadata.branch]);
    await this.metadata.delete(taskId);

    logger.info("Removed worktree {taskId}", { taskId });
  }

  async forceRemove(taskId: string): Promise<void> {
    validateTaskId(taskId);

    if (!(await this.exists(taskId))) {
      return;
    }

    const worktreePath = `${this.worktreesDir}/${taskId}`;
    const metadata = await this.metadata.get(taskId).catch(() => null);
    await this.executor.exec(["worktree", "remove", "--force", worktreePath]);
    if (metadata) {
      await this.executor.execRaw(["branch", "-D", metadata.branch]);
    }
    await this.metadata.delete(taskId);

    logger.info("Force-removed worktree {taskId}", { taskId });
  }

  async handoff(taskId: string, commitMessage: string): Promise<{ branch: string; commitSha: string | null }> {
    validateTaskId(taskId);

    if (!(await this.exists(taskId))) {
      throw new WorktreeNotFoundError(taskId);
    }

    const worktreePath = `${this.worktreesDir}/${taskId}`;
    const metadata = await this.metadata.get(taskId);
    const commitSha = await this.commitPendingChanges(worktreePath, commitMessage);

    await this.removeHandedOffWorktree(worktreePath);
    await this.checkoutHandedOffBranch(metadata.branch);
    await this.metadata.delete(taskId);

    logger.info("Handed off worktree {taskId} as branch {branch}", {
      taskId,
      branch: metadata.branch,
    });

    return { branch: metadata.branch, commitSha };
  }

  async exists(taskId: string): Promise<boolean> {
    const worktreePath = `${this.worktreesDir}/${taskId}`;
    const result = await Bun.$`test -d ${worktreePath}`.quiet().nothrow();
    return result.exitCode === 0;
  }

  private async hasUncommittedChanges(worktreePath: string): Promise<boolean> {
    const result = await Bun.$`git status --porcelain`.cwd(worktreePath).quiet().nothrow();
    return result.stdout.toString().trim().length > 0;
  }

  private async commitPendingChanges(
    worktreePath: string,
    commitMessage: string,
  ): Promise<string | null> {
    const status = await this.executor.execRaw(["status", "--porcelain"], worktreePath);
    if (!status.stdout.trim()) {
      return null;
    }

    await this.executor.exec(["add", "-A"], worktreePath);
    await this.executor.exec(["commit", "-m", commitMessage], worktreePath);
    return this.executor.exec(["rev-parse", "HEAD"], worktreePath);
  }

  private async ensureWorktreesDir(): Promise<void> {
    const result = await Bun.$`test -d ${this.worktreesDir}`.quiet().nothrow();
    if (result.exitCode !== 0) {
      await Bun.$`mkdir -p ${this.worktreesDir}`.quiet();
      logger.debug("Created worktrees directory");
    }
  }

  private async removeHandedOffWorktree(worktreePath: string): Promise<void> {
    const result = await this.executor.execRaw(["worktree", "remove", worktreePath]);
    if (result.exitCode === 0) {
      return;
    }

    logger.warn("Clean worktree removal failed during handoff; retrying with --force", {
      worktreePath,
      error: result.stderr,
    });

    const forced = await this.executor.execRaw(["worktree", "remove", "--force", worktreePath]);
    if (forced.exitCode !== 0) {
      throw new Error(`git worktree remove --force failed: ${forced.stderr}`);
    }
  }

  private async checkoutHandedOffBranch(branch: string): Promise<void> {
    const result = await this.executor.execRaw(["checkout", branch]);
    if (result.exitCode !== 0) {
      throw new Error(`git checkout ${branch} failed: ${result.stderr}`);
    }
  }
}
