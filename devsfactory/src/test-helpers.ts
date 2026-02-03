import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import ksuid from "ksuid";
import { runWithGlobalDir } from "./core/global-bootstrap";
import { closeDatabase, resetDatabaseInstance } from "./core/sqlite/database";

const TEST_RUNS_DIR = join(import.meta.dir, "..", "test-runs");

export const cleanupTestDir = async (testDir: string): Promise<void> => {
  if (!testDir.startsWith(TEST_RUNS_DIR)) {
    throw new Error(
      `Test directory ${testDir} is not a subdirectory of ${TEST_RUNS_DIR}`
    );
  }
  await rm(testDir, { recursive: true, force: true });
};

export const createTestDir = async (prefix: string): Promise<string> => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = ksuid.randomSync().string;
  const dirName = `${prefix}-${timestamp}-${random}`;
  const testDir = join(TEST_RUNS_DIR, dirName);
  await mkdir(testDir, { recursive: true });
  return testDir;
};

export const createTestGitRepo = async (prefix: string): Promise<string> => {
  const testDir = await createTestDir(prefix);
  await Bun.$`git init -b main ${testDir}`.quiet();
  await Bun.$`git -C ${testDir} config user.email "test@test.com"`.quiet();
  await Bun.$`git -C ${testDir} config user.name "Test User"`.quiet();
  await Bun.$`touch ${testDir}/README.md`.quiet();
  await Bun.$`git -C ${testDir} add .`.quiet();
  await Bun.$`git -C ${testDir} commit -m "Initial commit"`.quiet();
  return testDir;
};

export interface IsolatedGlobalDirContext {
  globalDir: string;
  cleanup: () => Promise<void>;
  run: <T>(fn: () => T | Promise<T>) => T | Promise<T>;
}

export const createIsolatedGlobalDir = async (
  prefix: string
): Promise<IsolatedGlobalDirContext> => {
  const testDir = await createTestDir(prefix);
  const globalDir = join(testDir, ".aop");
  await mkdir(join(globalDir, "projects"), { recursive: true });
  await mkdir(join(globalDir, "tasks"), { recursive: true });
  await mkdir(join(globalDir, "brainstorm"), { recursive: true });
  await mkdir(join(globalDir, "worktrees"), { recursive: true });

  return {
    globalDir,
    cleanup: async () => {
      await cleanupTestDir(testDir);
    },
    run: async <T>(fn: () => T | Promise<T>) =>
      runWithGlobalDir(globalDir, async () => {
        resetDatabaseInstance();
        try {
          return await fn();
        } finally {
          closeDatabase();
          resetDatabaseInstance();
        }
      })
  };
};
