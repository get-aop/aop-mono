export interface GitManagerOptions {
  repoPath: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
}

export interface SquashResult {
  targetBranch: string;
  commitSha: string;
}

export interface ApplyResult {
  affectedFiles: string[];
}
