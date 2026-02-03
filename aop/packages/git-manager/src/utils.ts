import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Traverses up from startPath to find the nearest directory containing a .git folder.
 * Returns the path to the git repository root, or null if not found.
 */
export const findRepoRoot = (startPath: string): string | null => {
  let current = startPath;
  while (current !== "/") {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    current = dirname(current);
  }
  return null;
};

export const getRemoteOrigin = async (repoPath: string): Promise<string | null> => {
  try {
    const proc = Bun.spawn(["git", "remote", "get-url", "origin"], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      return null;
    }
    return output.trim() || null;
  } catch {
    return null;
  }
};
