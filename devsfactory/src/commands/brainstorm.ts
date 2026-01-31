import { mkdir } from "node:fs/promises";
import { resolvePaths, resolvePathsForProject } from "../core/path-resolver";
import type { OperationMode, ResolvedPaths } from "../types";

export interface BrainstormArgs {
  projectName?: string;
  help?: boolean;
  error?: string;
}

export interface BrainstormResult {
  success: boolean;
  projectName?: string;
  brainstormDir?: string;
  mode?: OperationMode;
  error?: string;
}

export const parseBrainstormArgs = (args: string[]): BrainstormArgs => {
  let projectName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }

    if (arg.startsWith("-")) {
      return { error: `Unknown option: ${arg}` };
    }

    if (!projectName) {
      projectName = arg;
    }
  }

  return { projectName };
};

export const runBrainstormCommand = async (
  projectName?: string
): Promise<BrainstormResult> => {
  let paths: ResolvedPaths | null;

  if (projectName) {
    paths = await resolvePathsForProject(projectName);
    if (!paths) {
      return {
        success: false,
        error: `Project '${projectName}' not found. Run 'aop projects' to see registered projects.`
      };
    }
  } else {
    paths = await resolvePaths();
    if (!paths) {
      return {
        success: false,
        error:
          "No project context found. Run 'aop init' to register this repository, or specify a project name."
      };
    }
  }

  await mkdir(paths.brainstormDir, { recursive: true });

  return {
    success: true,
    projectName: paths.projectName,
    brainstormDir: paths.brainstormDir,
    mode: paths.mode
  };
};
