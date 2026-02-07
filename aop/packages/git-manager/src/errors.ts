export class GitConflictError extends Error {
  constructor(public readonly conflictingFiles: string[]) {
    super(`Merge conflict in files: ${conflictingFiles.join(", ")}`);
    this.name = "GitConflictError";
  }
}

export class WorktreeExistsError extends Error {
  constructor(public readonly taskId: string) {
    super(`Worktree already exists for task: ${taskId}`);
    this.name = "WorktreeExistsError";
  }
}

export class BranchNotFoundError extends Error {
  constructor(public readonly branch: string) {
    super(`Branch not found: ${branch}`);
    this.name = "BranchNotFoundError";
  }
}

export class BranchExistsError extends Error {
  constructor(public readonly branch: string) {
    super(`Branch already exists: ${branch}`);
    this.name = "BranchExistsError";
  }
}

export class NoCommitsError extends Error {
  constructor(public readonly taskId: string) {
    super(`No commits beyond base in worktree: ${taskId}`);
    this.name = "NoCommitsError";
  }
}

export class DirtyWorktreeError extends Error {
  constructor(public readonly taskId: string) {
    super(`Worktree has uncommitted changes: ${taskId}`);
    this.name = "DirtyWorktreeError";
  }
}

export class WorktreeNotFoundError extends Error {
  constructor(public readonly taskId: string) {
    super(`Worktree not found for task: ${taskId}`);
    this.name = "WorktreeNotFoundError";
  }
}

export class NotAGitRepositoryError extends Error {
  constructor(public readonly path: string) {
    super(`Not a git repository: ${path}`);
    this.name = "NotAGitRepositoryError";
  }
}

export class DirtyWorkingDirectoryError extends Error {
  constructor() {
    super("Main repository has uncommitted changes. Commit or stash them first.");
    this.name = "DirtyWorkingDirectoryError";
  }
}

export class NoChangesError extends Error {
  constructor(public readonly taskId: string) {
    super(`Worktree has no changes to apply: ${taskId}`);
    this.name = "NoChangesError";
  }
}
