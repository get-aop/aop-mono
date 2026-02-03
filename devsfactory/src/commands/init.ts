import { realpath, statfs } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { ensureGlobalDir, getGlobalDir } from "../core/global-bootstrap";
import { registerProject } from "../core/sqlite/project-store";

export interface InitArgs {
  path?: string;
  help?: boolean;
  error?: string;
}

export interface InitResult {
  success: boolean;
  projectName?: string;
  projectPath?: string;
  message?: string;
  error?: string;
}

export const parseInitArgs = (args: string[]): InitArgs => {
  let path: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }

    if (arg.startsWith("-")) {
      return { error: `Unknown option: ${arg}` };
    }

    if (!path) {
      path = arg;
    }
  }

  return { path };
};

const extractProjectNameFromRemote = (remoteUrl: string): string => {
  let path: string;

  if (remoteUrl.startsWith("git@")) {
    const colonIndex = remoteUrl.indexOf(":");
    path = remoteUrl.slice(colonIndex + 1);
  } else {
    const url = new URL(remoteUrl);
    path = url.pathname.slice(1);
  }

  if (path.endsWith(".git")) {
    path = path.slice(0, -4);
  }

  return path.replace(/\//g, "-");
};

const getGitRoot = async (path: string): Promise<string | null> => {
  try {
    const result =
      await Bun.$`git -C ${path} rev-parse --show-toplevel`.quiet();
    return result.text().trim();
  } catch {
    return null;
  }
};

const getOriginRemote = async (path: string): Promise<string | null> => {
  try {
    const result = await Bun.$`git -C ${path} remote get-url origin`.quiet();
    return result.text().trim();
  } catch {
    return null;
  }
};

const checkFilesystemCompatibility = async (
  repoPath: string,
  worktreesDir: string
): Promise<boolean> => {
  try {
    const repoStat = await statfs(repoPath);
    const worktreesStat = await statfs(worktreesDir);
    return repoStat.type === worktreesStat.type;
  } catch {
    return true;
  }
};

export const runInitCommand = async (path?: string): Promise<InitResult> => {
  const targetPath = path ?? process.cwd();

  await ensureGlobalDir();

  try {
    const resolvedPath = await realpath(resolve(targetPath));
    const gitRoot = await getGitRoot(resolvedPath);

    if (!gitRoot) {
      throw new Error(`Path '${targetPath}' is not inside a git repository`);
    }

    const worktreesDir = join(getGlobalDir(), "worktrees");
    const filesystemsCompatible = await checkFilesystemCompatibility(
      gitRoot,
      worktreesDir
    );

    if (!filesystemsCompatible) {
      throw new Error(
        `Filesystem incompatibility: '${gitRoot}' and '${worktreesDir}' are on different filesystem types. ` +
          `Git worktrees may not work correctly across different filesystems.`
      );
    }

    const remote = await getOriginRemote(gitRoot);
    const projectName = remote
      ? extractProjectNameFromRemote(remote)
      : basename(gitRoot);

    const project = registerProject({
      name: projectName,
      path: gitRoot,
      gitRemote: remote
    });

    return {
      success: true,
      projectName: project.name,
      projectPath: project.path,
      message: `✓ Registered project '${project.name}' at ${project.path}`
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("already registered")) {
      return {
        success: false,
        error: errorMessage
      };
    }

    if (errorMessage.includes("not inside a git repository")) {
      return {
        success: false,
        error: `${errorMessage}\n  Hint: Run 'git init' first to initialize a git repository.`
      };
    }

    if (errorMessage.includes("Filesystem incompatibility")) {
      return {
        success: false,
        error: `${errorMessage}\n  Hint: The repository and ~/.aop/worktrees must be on the same filesystem for git worktrees to work.`
      };
    }

    return {
      success: false,
      error: errorMessage
    };
  }
};
