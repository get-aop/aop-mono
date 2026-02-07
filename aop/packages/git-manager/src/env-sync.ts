import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { getLogger } from "@aop/infra";
import type { GitExecutor } from "./git-executor.ts";

const logger = getLogger("aop", "env-sync");

export const discoverEnvFiles = async (executor: GitExecutor): Promise<string[]> => {
  const envGlobs = [".env*", "**/.env*"];
  const [tracked, untracked] = await Promise.all([
    executor.execRaw(["ls-files", "--cached", ...envGlobs]),
    executor.execRaw(["ls-files", "--others", "--exclude-standard", ...envGlobs]),
  ]);

  const files = new Set<string>();
  parseGitOutput(tracked, files);
  parseGitOutput(untracked, files);
  return [...files].sort();
};

export const syncEnvFiles = async (
  executor: GitExecutor,
  repoPath: string,
  worktreePath: string,
): Promise<void> => {
  const envFiles = await discoverEnvFiles(executor);
  if (envFiles.length === 0) return;

  for (const relativePath of envFiles) {
    const target = join(worktreePath, relativePath);
    if (existsSync(target)) {
      logger.debug("Skipping {path} — already exists in worktree", { path: relativePath });
      continue;
    }

    const targetDir = dirname(target);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    const source = join(repoPath, relativePath);
    symlinkSync(source, target);
    logger.debug("Symlinked {path} into worktree", { path: relativePath });
  }

  logger.info("Synced {count} env files into worktree", { count: envFiles.length });
};

const parseGitOutput = (result: { exitCode: number; stdout: string }, into: Set<string>): void => {
  if (result.exitCode !== 0 || !result.stdout) return;
  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) into.add(trimmed);
  }
};
