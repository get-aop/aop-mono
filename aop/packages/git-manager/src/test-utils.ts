import { rm } from "node:fs/promises";

export const TEST_BASE_DIR = "/tmp/git-manager-test";

export interface TestRepoOptions {
  withInitialCommit?: boolean;
}

export const createTestRepo = async (options: TestRepoOptions = {}): Promise<string> => {
  const { withInitialCommit = true } = options;
  const repoPath = `${TEST_BASE_DIR}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await Bun.$`mkdir -p ${repoPath}`.quiet();
  await Bun.$`git init -b main`.cwd(repoPath).quiet();
  await Bun.$`git config user.email "test@test.com"`.cwd(repoPath).quiet();
  await Bun.$`git config user.name "Test"`.cwd(repoPath).quiet();

  if (withInitialCommit) {
    await Bun.$`touch README.md`.cwd(repoPath).quiet();
    await Bun.$`git add .`.cwd(repoPath).quiet();
    await Bun.$`git commit -m "Initial commit"`.cwd(repoPath).quiet();
  }

  return repoPath;
};

export const cleanupTestRepos = async (): Promise<void> => {
  await rm(TEST_BASE_DIR, { recursive: true, force: true });
};

export const commitPendingChanges = async (
  repoPath: string,
  message = "Auto-commit pending changes",
): Promise<void> => {
  const status = await Bun.$`git status --porcelain`.cwd(repoPath).quiet().nothrow();
  if (status.stdout.toString().trim().length > 0) {
    await Bun.$`git add -A`.cwd(repoPath).quiet();
    await Bun.$`git commit -m ${message}`.cwd(repoPath).quiet();
  }
};
