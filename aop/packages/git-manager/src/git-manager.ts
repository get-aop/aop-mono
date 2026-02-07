import { aopPaths, getLogger } from "@aop/infra";
import { ApplyOps } from "./apply-ops.ts";
import { BranchOps } from "./branch-ops.ts";
import { syncEnvFiles } from "./env-sync.ts";
import { NotAGitRepositoryError } from "./errors.ts";
import { GitExecutor } from "./git-executor.ts";
import { MergeOps } from "./merge-ops.ts";
import { MetadataStore } from "./metadata.ts";
import type { ApplyResult, GitManagerOptions, SquashResult, WorktreeInfo } from "./types.ts";
import { WorktreeOps } from "./worktree-ops.ts";

const logger = getLogger("aop", "git-manager");

export class GitManager {
  private readonly executor: GitExecutor;
  private readonly branchOps: BranchOps;
  private readonly metadata: MetadataStore;
  private readonly worktreeOps: WorktreeOps;
  private readonly mergeOps: MergeOps;
  private readonly applyOps: ApplyOps;
  private readonly repoPath: string;

  constructor(options: GitManagerOptions) {
    this.repoPath = options.repoPath;
    const worktreesDir = aopPaths.worktrees(options.repoId);

    this.executor = new GitExecutor(this.repoPath);
    this.branchOps = new BranchOps(this.executor);
    this.metadata = new MetadataStore(worktreesDir);
    this.worktreeOps = new WorktreeOps(worktreesDir, this.executor, this.branchOps, this.metadata);
    this.mergeOps = new MergeOps(this.executor, this.branchOps, this.metadata, (taskId) =>
      this.worktreeOps.exists(taskId),
    );
    this.applyOps = new ApplyOps(this.repoPath, worktreesDir, this.metadata, (taskId) =>
      this.worktreeOps.exists(taskId),
    );
  }

  async init(): Promise<void> {
    const result = await this.executor.execRaw(["rev-parse", "--git-dir"]);
    if (result.exitCode !== 0) {
      throw new NotAGitRepositoryError(this.repoPath);
    }
    logger.debug("GitManager initialized for {path}", { path: this.repoPath });
  }

  async createWorktree(taskId: string, baseBranch: string): Promise<WorktreeInfo> {
    const info = await this.worktreeOps.create(taskId, baseBranch);
    await syncEnvFiles(this.executor, this.repoPath, info.path);
    return info;
  }

  async squashMerge(taskId: string, targetBranch: string, message: string): Promise<SquashResult> {
    return this.mergeOps.squashMerge(taskId, targetBranch, message);
  }

  async removeWorktree(taskId: string): Promise<void> {
    return this.worktreeOps.remove(taskId);
  }

  async applyWorktree(taskId: string): Promise<ApplyResult> {
    return this.applyOps.applyWorktree(taskId);
  }

  async getDefaultBranch(): Promise<string> {
    return this.branchOps.getDefaultBranch();
  }
}
