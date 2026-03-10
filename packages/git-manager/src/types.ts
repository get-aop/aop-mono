export interface GitManagerOptions {
  repoPath: string;
  repoId: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
}

export interface HandoffResult {
  branch: string;
  commitSha: string | null;
}

export interface SquashResult {
  targetBranch: string;
  commitSha: string;
}
