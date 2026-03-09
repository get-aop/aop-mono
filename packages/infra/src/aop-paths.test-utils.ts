import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Sets AOP_HOME to a temp directory for test isolation.
 * Returns a cleanup function that restores the original value and removes the temp dir.
 */
export const useTestAopHome = (): (() => void) => {
  const original = process.env.AOP_HOME;
  const baseDir = join(homedir(), ".aop", "aop-test");
  mkdirSync(baseDir, { recursive: true });
  const tempDir = mkdtempSync(join(baseDir, "home-"));
  process.env.AOP_HOME = tempDir;

  return () => {
    if (original !== undefined) {
      process.env.AOP_HOME = original;
    } else {
      delete process.env.AOP_HOME;
    }
    rmSync(tempDir, { recursive: true, force: true });
  };
};
