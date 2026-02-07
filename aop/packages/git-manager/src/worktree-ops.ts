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

  async create(taskId: string, baseBranch: string): Promise<WorktreeInfo> {
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
    await this.executor.exec(["worktree", "add", "-b", taskId, worktreePath, baseBranch]);
    await this.metadata.save(taskId, { baseBranch, baseCommit });

    logger.info("Created worktree {taskId} at {path}", { taskId, path: worktreePath });

    return { path: worktreePath, branch: taskId, baseBranch, baseCommit };
  }

  async remove(taskId: string): Promise<void> {
    validateTaskId(taskId);

    if (!(await this.exists(taskId))) {
      throw new WorktreeNotFoundError(taskId);
    }

    const worktreePath = `${this.worktreesDir}/${taskId}`;
    if (await this.hasUncommittedChanges(worktreePath)) {
      throw new DirtyWorktreeError(taskId);
    }

    await this.executor.exec(["worktree", "remove", worktreePath]);
    await this.executor.exec(["branch", "-D", taskId]);
    await this.metadata.delete(taskId);

    logger.info("Removed worktree {taskId}", { taskId });
  }

  async forceRemove(taskId: string): Promise<void> {
    validateTaskId(taskId);

    if (!(await this.exists(taskId))) {
      return;
    }

    const worktreePath = `${this.worktreesDir}/${taskId}`;
    await this.executor.exec(["worktree", "remove", "--force", worktreePath]);
    await this.executor.execRaw(["branch", "-D", taskId]);
    await this.metadata.delete(taskId);

    logger.info("Force-removed worktree {taskId}", { taskId });
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

  private async ensureWorktreesDir(): Promise<void> {
    const result = await Bun.$`test -d ${this.worktreesDir}`.quiet().nothrow();
    if (result.exitCode !== 0) {
      await Bun.$`mkdir -p ${this.worktreesDir}`.quiet();
      logger.debug("Created worktrees directory");
    }
  }
}
