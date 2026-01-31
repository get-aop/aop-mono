import { ensureGlobalDir } from "../core/global-bootstrap";
import { registerProject } from "../core/project-registry";

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

export const runInitCommand = async (path?: string): Promise<InitResult> => {
  const targetPath = path ?? process.cwd();

  await ensureGlobalDir();

  try {
    const project = await registerProject(targetPath);

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
