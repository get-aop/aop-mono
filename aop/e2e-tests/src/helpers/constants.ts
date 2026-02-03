import { dirname, resolve } from "node:path";
import { DEFAULT_PID_FILE } from "@aop/cli/daemon";

export const E2E_TEST_BASE_DIR = resolve(dirname(import.meta.path), "../../tmp/aop-e2e-test");
export const FIXTURES_DIR = resolve(dirname(import.meta.path), "../../fixtures");
export const AOP_BIN = resolve(dirname(import.meta.path), "../../../apps/cli/src/main.ts");
export const TEST_REPO_PREFIX = "test-e2e";

export { DEFAULT_PID_FILE };

export const SERVER_URL = process.env.AOP_SERVER_URL ?? "http://localhost:3000";
export const API_KEY = process.env.AOP_API_KEY ?? "aop_test_key_dev";

export const getAopEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
});
