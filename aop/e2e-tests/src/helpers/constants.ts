import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { AOP_PORTS, AOP_URLS } from "@aop/common";

export const E2E_TEST_BASE_DIR = resolve(dirname(import.meta.path), "../../tmp/aop-e2e-test");
export const WORKTREES_DIR = resolve(dirname(import.meta.path), "../../../.worktrees");
export const FIXTURES_DIR = resolve(dirname(import.meta.path), "../../fixtures");
export const AOP_BIN = resolve(dirname(import.meta.path), "../../../apps/cli/src/main.ts");
export const LOCAL_SERVER_BIN = resolve(
  dirname(import.meta.path),
  "../../../apps/local-server/src/run.ts",
);
export const TEST_REPO_PREFIX = "test-e2e";

export const DEFAULT_LOCAL_SERVER_PORT = AOP_PORTS.LOCAL_SERVER;
export const DEFAULT_LOCAL_SERVER_URL = AOP_URLS.LOCAL_SERVER;
export const DEFAULT_PID_FILE = join(homedir(), ".aop", "aop.pid");

export const SERVER_URL = AOP_URLS.SERVER;
export const API_KEY = "aop_test_key_dev";

export const getAopEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
});
