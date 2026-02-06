import { access, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface DirectoryListingData {
  path: string;
  directories: string[];
  parent: string | null;
  isGitRepo: boolean;
}

export type ListDirectoriesResult =
  | { success: true; data: DirectoryListingData }
  | { success: false; error: ListDirectoriesError };

export type ListDirectoriesError =
  | { code: "NOT_FOUND"; path: string }
  | { code: "NOT_A_DIRECTORY"; path: string }
  | { code: "PERMISSION_DENIED"; path: string };

export interface ListDirectoriesOptions {
  hidden?: boolean;
}

export const listDirectories = async (
  dirPath?: string,
  options: ListDirectoriesOptions = {},
): Promise<ListDirectoriesResult> => {
  const targetPath = dirPath ?? os.homedir();
  const includeHidden = options.hidden ?? false;

  try {
    const stats = await stat(targetPath);

    if (!stats.isDirectory()) {
      return {
        success: false,
        error: { code: "NOT_A_DIRECTORY", path: targetPath },
      };
    }

    const entries = await readdir(targetPath, { withFileTypes: true });

    const directories = entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => includeHidden || !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();

    const parent = targetPath === "/" ? null : path.dirname(targetPath);

    const gitPath = path.join(targetPath, ".git");
    let isGitRepo = false;
    try {
      await access(gitPath);
      const gitStats = await stat(gitPath);
      isGitRepo = gitStats.isDirectory();
    } catch {
      isGitRepo = false;
    }

    return {
      success: true,
      data: { path: targetPath, directories, parent, isGitRepo },
    };
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;

    if (nodeErr.code === "ENOENT") {
      return {
        success: false,
        error: { code: "NOT_FOUND", path: targetPath },
      };
    }

    if (nodeErr.code === "EACCES") {
      return {
        success: false,
        error: { code: "PERMISSION_DENIED", path: targetPath },
      };
    }

    throw err;
  }
};
