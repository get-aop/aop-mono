import type { GitExecutor } from "./git-executor.ts";

/**
 * Branch existence checks and validation operations.
 */
export class BranchOps {
  constructor(private readonly executor: GitExecutor) {}

  async exists(branch: string): Promise<boolean> {
    try {
      await this.executor.exec(["rev-parse", "--verify", `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  async getCommit(ref: string): Promise<string> {
    return this.executor.exec(["rev-parse", ref]);
  }

  async create(branch: string, startPoint: string): Promise<void> {
    await this.executor.exec(["checkout", "-b", branch, startPoint]);
  }

  async delete(branch: string): Promise<void> {
    await this.executor.exec(["branch", "-D", branch]);
  }

  async checkout(ref: string): Promise<void> {
    await this.executor.exec(["checkout", ref]);
  }

  async checkoutPrevious(): Promise<void> {
    await this.executor.exec(["checkout", "-"]);
  }

  async listLocal(): Promise<{ branches: string[]; current: string }> {
    const output = await this.executor.exec(["branch", "--format=%(refname:short)"]);
    const branches = output
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean);

    const currentResult = await this.executor.execRaw(["branch", "--show-current"]);
    const current = currentResult.exitCode === 0 ? currentResult.stdout : (branches[0] ?? "main");

    return { branches, current };
  }

  async getDefaultBranch(): Promise<string> {
    // Try to get the default branch from origin
    const remoteResult = await this.executor.execRaw(["symbolic-ref", "refs/remotes/origin/HEAD"]);
    if (remoteResult.exitCode === 0) {
      return remoteResult.stdout.replace("refs/remotes/origin/", "");
    }

    // Fallback: check if main or master exists locally
    if (await this.exists("main")) return "main";
    if (await this.exists("master")) return "master";

    // Last resort: use current branch
    const currentBranch = await this.executor.exec(["branch", "--show-current"]);
    return currentBranch || "main";
  }
}
