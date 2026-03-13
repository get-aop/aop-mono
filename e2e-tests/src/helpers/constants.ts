import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const E2E_TEST_BASE_DIR = resolve(dirname(import.meta.path), "../../tmp/aop-e2e-test");
export const WORKTREES_DIR = resolve(dirname(import.meta.path), "../../../.worktrees");
export const FIXTURES_DIR = resolve(dirname(import.meta.path), "../../fixtures");
export const AOP_BIN = resolve(dirname(import.meta.path), "../../../apps/cli/src/main.ts");
export const LOCAL_SERVER_BIN = resolve(
  dirname(import.meta.path),
  "../../../apps/local-server/src/run.ts",
);
export const TEST_REPO_PREFIX = "test-e2e";

export const DEFAULT_LOCAL_SERVER_PORT = 25150;
export const DEFAULT_LOCAL_SERVER_URL = "http://localhost:25150";
export const DEFAULT_PID_FILE = join(homedir(), ".aop", "aop.pid");

export const E2E_TEST_HOME_DIR = join(homedir(), ".aop", "e2e-tests");
export const LOCAL_SERVER_PORT_RANGE = { min: 25900, max: 25999 };
export const DASHBOARD_DIST_PATH = resolve(
  dirname(import.meta.path),
  "../../../apps/dashboard/dist",
);
export const DASHBOARD_DEV_BIN = resolve(
  dirname(import.meta.path),
  "../../../apps/dashboard/dev.ts",
);
export const DASHBOARD_DEV_CWD = resolve(dirname(import.meta.path), "../../../apps/dashboard");
export const DASHBOARD_PORT_RANGE = { min: 25700, max: 25799 };

export const getAopEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
});

export interface TestAopHome {
  path: string;
  cleanup: () => void;
}

export const createTestAopHome = (testName: string): TestAopHome => {
  const baseDir = join(homedir(), ".aop", "aop-test-e2e");
  mkdirSync(baseDir, { recursive: true });
  const tempDir = mkdtempSync(join(baseDir, `${testName}-`));
  return {
    path: tempDir,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
};
