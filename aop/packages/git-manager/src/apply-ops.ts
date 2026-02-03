import { getLogger } from "@aop/infra";
import {
  ApplyConflictError,
  DirtyWorkingDirectoryError,
  NoChangesError,
  WorktreeNotFoundError,
} from "./errors.ts";
import type { MetadataStore } from "./metadata.ts";
import type { ApplyResult } from "./types.ts";
import { validateTaskId } from "./validation.ts";

const logger = getLogger("aop", "apply-ops");

export class ApplyOps {
  constructor(
    private readonly repoPath: string,
    private readonly worktreesDir: string,
    private readonly metadata: MetadataStore,
    private readonly worktreeExists: (taskId: string) => Promise<boolean>,
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

    const affectedFiles = await this.applyDiff(diff);

    logger.info("Applied worktree {taskId} to main repo ({count} files)", {
      taskId,
      count: affectedFiles.length,
    });

    return { affectedFiles };
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

  private async applyDiff(diff: string): Promise<string[]> {
    const diffBuffer = Buffer.from(diff);
    const result = await Bun.$`git apply --check < ${diffBuffer}`
      .cwd(this.repoPath)
      .quiet()
      .nothrow();

    if (result.exitCode !== 0) {
      const conflictingFiles = this.parseConflictingFiles(result.stderr.toString());
      throw new ApplyConflictError(conflictingFiles);
    }

    await Bun.$`git apply < ${diffBuffer}`.cwd(this.repoPath).quiet();

    const affectedFiles = this.parseAffectedFiles(diff);
    return affectedFiles;
  }

  private parseConflictingFiles(stderr: string): string[] {
    const files: string[] = [];
    const lines = stderr.split("\n");
    for (const line of lines) {
      const match = line.match(/error: patch failed: ([^:]+):/);
      if (match?.[1]) {
        files.push(match[1]);
      }
    }
    return files.length > 0 ? files : ["unknown"];
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
