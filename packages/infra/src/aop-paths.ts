import { homedir } from "node:os";
import { join } from "node:path";

const getAopHome = (): string => process.env.AOP_HOME ?? join(homedir(), ".aop");

export const aopPaths = {
  home: () => getAopHome(),
  db: () => join(getAopHome(), "aop.sqlite"),
  logs: () => join(getAopHome(), "logs"),
  linearTokens: () => join(getAopHome(), "secrets", "linear-tokens.enc"),
  repoDir: (repoId: string) => join(getAopHome(), "repos", repoId),
  relativeTaskDocs: () => join("docs", "tasks"),
  worktrees: (repoId: string) => join(getAopHome(), "worktrees", repoId),
  worktree: (repoId: string, taskId: string) => join(getAopHome(), "worktrees", repoId, taskId),
  worktreeMetadata: (repoId: string) => join(getAopHome(), "worktrees", repoId, ".metadata"),
};
