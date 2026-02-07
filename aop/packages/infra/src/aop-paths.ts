import { homedir } from "node:os";
import { join } from "node:path";

const AOP_HOME = join(homedir(), ".aop");

export const aopPaths = {
  home: () => AOP_HOME,
  db: () => join(AOP_HOME, "aop.sqlite"),
  logs: () => join(AOP_HOME, "logs"),
  repoDir: (repoId: string) => join(AOP_HOME, "repos", repoId),
  relativeOpenspec: () => "openspec",
  relativeOpenspecChanges: () => join("openspec", "changes"),
  openspec: (repoId: string) => join(AOP_HOME, "repos", repoId, "openspec"),
  openspecChanges: (repoId: string) => join(AOP_HOME, "repos", repoId, "openspec", "changes"),
  worktrees: (repoId: string) => join(AOP_HOME, "repos", repoId, "worktrees"),
  worktree: (repoId: string, taskId: string) =>
    join(AOP_HOME, "repos", repoId, "worktrees", taskId),
  worktreeMetadata: (repoId: string) => join(AOP_HOME, "repos", repoId, "worktrees", ".metadata"),
};
