const TEST_BASE_DIR = "/tmp/handlers-test";

export const getTestBaseDir = () => TEST_BASE_DIR;

export const createGitRepo = async (): Promise<string> => {
  const repoPath = `${TEST_BASE_DIR}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await Bun.$`mkdir -p ${repoPath}`.quiet();
  await Bun.$`git init -b main`.cwd(repoPath).quiet();
  await Bun.$`git config user.email "test@test.com"`.cwd(repoPath).quiet();
  await Bun.$`git config user.name "Test"`.cwd(repoPath).quiet();
  await Bun.$`touch README.md`.cwd(repoPath).quiet();
  await Bun.$`git add .`.cwd(repoPath).quiet();
  await Bun.$`git commit -m "Initial commit"`.cwd(repoPath).quiet();
  return repoPath;
};

export const createChangePath = async (repoPath: string, changePath: string): Promise<string> => {
  const fullPath = `${repoPath}/${changePath}`;
  await Bun.$`mkdir -p ${fullPath}`.quiet();
  return fullPath;
};

export const commitPendingChanges = async (path: string): Promise<void> => {
  const status = await Bun.$`git status --porcelain`.cwd(path).quiet().nothrow();
  if (status.stdout.toString().trim().length > 0) {
    await Bun.$`git add -A`.cwd(path).quiet();
    await Bun.$`git commit -m "Auto-commit"`.cwd(path).quiet();
  }
};

export const cleanupTestDir = async (): Promise<void> => {
  const { rm } = await import("node:fs/promises");
  await rm(TEST_BASE_DIR, { recursive: true, force: true });
};
