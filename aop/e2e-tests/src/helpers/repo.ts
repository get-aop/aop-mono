import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { E2E_TEST_BASE_DIR, FIXTURES_DIR, TEST_REPO_PREFIX, WORKTREES_DIR } from "./constants";
import { runAopCommand } from "./daemon";

export interface TempRepoResult {
  path: string;
  name: string;
  cleanup: () => Promise<void>;
}

export const setupE2ETestDir = async (): Promise<void> => {
  await mkdir(E2E_TEST_BASE_DIR, { recursive: true });
};

export const createTempRepo = async (testName: string): Promise<TempRepoResult> => {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 6);
  const name = `${TEST_REPO_PREFIX}-${testName}-${timestamp}-${randomSuffix}`;
  const repoPath = join(E2E_TEST_BASE_DIR, name);

  await mkdir(repoPath, { recursive: true });
  await Bun.$`git init -b main`.cwd(repoPath).quiet();
  await Bun.$`git config user.email "e2e-test@aop.dev"`.cwd(repoPath).quiet();
  await Bun.$`git config user.name "E2E Test"`.cwd(repoPath).quiet();

  await Bun.write(join(repoPath, "README.md"), `# ${name}\n\nE2E test repository.\n`);
  await Bun.$`git add .`.cwd(repoPath).quiet();
  await Bun.$`git commit -m "Initial commit"`.cwd(repoPath).quiet();

  return {
    path: repoPath,
    name,
    cleanup: async () => {
      await runAopCommand(["repo:remove", repoPath, "--force"]);
      await rm(repoPath, { recursive: true, force: true });
    },
  };
};

export const copyFixture = async (fixtureName: string, repoPath: string): Promise<string> => {
  const sourcePath = join(FIXTURES_DIR, fixtureName);
  const targetPath = join(repoPath, "openspec", "changes", fixtureName);

  await mkdir(dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { recursive: true });

  return targetPath;
};

export const ensureChangesDir = async (repoPath: string): Promise<string> => {
  const changesDir = join(repoPath, "openspec", "changes");
  await mkdir(changesDir, { recursive: true });
  return changesDir;
};

export const cleanupTestRepos = async (): Promise<void> => {
  await rm(E2E_TEST_BASE_DIR, { recursive: true, force: true });
};

export interface TempWorktreeResult {
  path: string;
  name: string;
  branch: string;
}

export const createTempWorktree = async (testName: string): Promise<TempWorktreeResult> => {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 6);
  const name = `e2e-${testName}-${timestamp}-${randomSuffix}`;
  const worktreePath = join(WORKTREES_DIR, name);

  await mkdir(WORKTREES_DIR, { recursive: true });

  const branchResult = await Bun.$`git rev-parse --abbrev-ref HEAD`.quiet();
  const currentBranch = branchResult.stdout.toString().trim();

  const newBranch = `e2e/${name}`;
  await Bun.$`git worktree add -b ${newBranch} ${worktreePath} ${currentBranch}`.quiet();

  return {
    path: worktreePath,
    name,
    branch: newBranch,
  };
};
